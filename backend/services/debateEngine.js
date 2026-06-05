'use strict';
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { getConfigsForUser, DEFAULT_CONFIGS } = require('./agentConfigs');

// Token-bucket rate limiter — shared across all evaluations in this process.
// Tracks real request timestamps so back-to-back evaluations don't burst past the limit.
const geminiRateLimiter = {
  timestamps: [],
  MAX_PER_MINUTE: 10, // conservative buffer under the 15 RPM free-tier limit

  async throttle() {
    const now = Date.now();
    const windowStart = now - 60_000;
    this.timestamps = this.timestamps.filter(t => t > windowStart);

    if (this.timestamps.length >= this.MAX_PER_MINUTE) {
      const waitMs = this.timestamps[0] + 60_000 - now + 500;
      console.log(`[RateLimit] ${this.timestamps.length} requests in last 60s — waiting ${Math.round(waitMs / 1000)}s before next call`);
      await new Promise(r => setTimeout(r, waitMs));
      this.timestamps = this.timestamps.filter(t => t > Date.now() - 60_000);
    }

    this.timestamps.push(Date.now());
  }
};

// JSON fallback when DB is unavailable
const getEmployeesJSON = () => {
  try {
    const dataPath = path.join(__dirname, '../data/dummy_employees.json');
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (err) {
    return [];
  }
};

// Years of experience from a date string or Date
const calcYearsExp = (doj) => {
  if (!doj) return null;
  const joined = new Date(doj);
  const now = new Date();
  const years = (now - joined) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(0, parseFloat(years.toFixed(1)));
};

// Human-readable leave summary for context prompt
const fmtLeave = (l) => {
  const start = l.start_date instanceof Date
    ? l.start_date.toISOString().split('T')[0]
    : String(l.start_date).split('T')[0];
  const end = l.end_date instanceof Date
    ? l.end_date.toISOString().split('T')[0]
    : String(l.end_date).split('T')[0];
  const days = l.duration_days || Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
  return `${start} → ${end} (${days}d, ${l.leave_type || 'planned'})`;
};

// Live DB query — employees enriched with experience, workload, upcoming leaves, past project domains
const getEmployeesFromDB = async (pool, projectTimelineMonths) => {
  if (!pool) return getEmployeesJSON();

  const lookAheadDays = Math.max(90, (projectTimelineMonths || 6) * 30);
  const lookAheadDate = new Date();
  lookAheadDate.setDate(lookAheadDate.getDate() + lookAheadDays);

  try {
    const result = await pool.query(`
      SELECT
        e.id, e.name, e.designation, e.date_of_joining,
        COALESCE(ARRAY_AGG(DISTINCT ts.name) FILTER (WHERE ts.name IS NOT NULL), '{}') AS tech_stacks,
        COALESCE(
          JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'name', p_cur.name,
            'domain', COALESCE(p_cur.domain, 'General'),
            'complexity', COALESCE(p_cur.complexity, 'medium')
          )) FILTER (WHERE ep_cur.project_type = 'current' AND p_cur.name IS NOT NULL),
          '[]'
        ) AS current_projects,
        COALESCE(
          JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'name', p_past.name,
            'domain', COALESCE(p_past.domain, 'General'),
            'complexity', COALESCE(p_past.complexity, 'medium')
          )) FILTER (WHERE ep_past.project_type = 'past' AND p_past.name IS NOT NULL),
          '[]'
        ) AS past_projects
      FROM employees e
      LEFT JOIN employee_techstacks ets  ON ets.employee_id = e.id
      LEFT JOIN techstacks ts            ON ts.id = ets.techstack_id
      LEFT JOIN employee_projects ep_cur ON ep_cur.employee_id = e.id AND ep_cur.project_type = 'current'
      LEFT JOIN projects p_cur           ON p_cur.id = ep_cur.project_id
      LEFT JOIN employee_projects ep_past ON ep_past.employee_id = e.id AND ep_past.project_type = 'past'
      LEFT JOIN projects p_past          ON p_past.id = ep_past.project_id
      GROUP BY e.id, e.name, e.designation, e.date_of_joining
      ORDER BY e.name
    `);

    if (result.rows.length === 0) return getEmployeesJSON();

    // Batch-fetch upcoming approved leaves for all employees
    const empIds = result.rows.map(r => r.id);
    let leavesByEmp = {};
    try {
      const leaveRes = await pool.query(`
        SELECT employee_id, start_date, end_date, leave_type, status,
               (end_date - start_date + 1) AS duration_days
        FROM employee_leaves
        WHERE employee_id = ANY($1)
          AND status IN ('approved', 'pending')
          AND end_date >= CURRENT_DATE
          AND start_date <= $2
        ORDER BY start_date
      `, [empIds, lookAheadDate.toISOString().split('T')[0]]);

      leaveRes.rows.forEach(l => {
        if (!leavesByEmp[l.employee_id]) leavesByEmp[l.employee_id] = [];
        leavesByEmp[l.employee_id].push(l);
      });
    } catch (leaveErr) {
      console.warn('[DB] Leaves fetch skipped (table may not exist yet):', leaveErr.message);
    }

    return result.rows.map(row => {
      const currentProjects = Array.isArray(row.current_projects) ? row.current_projects : [];
      const pastProjects    = Array.isArray(row.past_projects)    ? row.past_projects    : [];
      const upcomingLeaves  = leavesByEmp[row.id] || [];
      const techStacks      = row.tech_stacks || [];
      const yearsExp        = calcYearsExp(row.date_of_joining);

      return {
        id:                   row.id,
        name:                 row.name,
        designation:          row.designation,
        role:                 row.designation,
        date_of_joining:      row.date_of_joining,
        years_experience:     yearsExp,
        tech_stacks:          techStacks,
        current_projects:     currentProjects,
        current_project_count: currentProjects.length,
        past_projects:        pastProjects,
        upcoming_leaves:      upcomingLeaves,
        available:            currentProjects.length === 0,
        hipaa_certified:      techStacks.some(s => /hipaa/i.test(s)),
      };
    });
  } catch (err) {
    console.warn('[DB] Employee fetch failed, using JSON fallback:', err.message);
    return getEmployeesJSON();
  }
};

// ─── Agent system prompts ────────────────────────────────────────────────────

const AGENT_PERSONAS = {
  'Account Executive': `You are the Account Executive (Sales Representative) in a high-stakes corporate boardroom tender evaluation.
Champion this project — advocate strongly for a GO. Be persuasive, strategic, and opportunity-focused.
Reference specific details: client name, budget, timeline, and industry. Respond in 2-4 concise sentences.`,

  'Resource': `You are the Resource Manager in a corporate boardroom tender evaluation.
Your job is to assess WHICH specific employees are best suited for this project and whether the team can be assembled without delivery risk.

For each candidate you nominate, explicitly evaluate:
- Workload: how many active projects they are currently on (0 = fully available, 1 = partial capacity, 2+ = high risk of overload).
- Upcoming leaves: any approved or pending leave windows that fall within the project timeline — flag any that cover more than 2 consecutive weeks as a staffing risk.
- Domain alignment: whether their past project domains match the tender's industry vertical (a Healthcare specialist is preferred for a Healthcare tender).
- Years of experience: senior staff (5+ years) should anchor complex or high-stakes projects.
- HIPAA / compliance certifications if the industry requires it.

Nominate specific employees by name, explain your reasoning, and flag any gaps or risks you cannot cover from current bench capacity.
Respond in 3-5 concise sentences.`,

  'Technical Architect': `You are the Senior Technical Architect in a corporate boardroom tender evaluation.
Your job is to assess technical delivery risk based on the team composition AND the project requirements.

When evaluating the proposed team, consider:
- Tech stack depth: do nominated staff actually hold the required skills, and at what experience level? Senior engineers (5+ years) own architectural decisions; junior staff need oversight.
- Domain experience: past project domains signal real-world context. A developer who has delivered Healthcare or FinTech projects understands the non-functional requirements implicitly.
- Leave impact: if a key technical lead is on extended leave mid-project, flag the continuity risk — who will own architecture decisions in their absence?
- Timeline realism: cross-reference estimated team size, their experience levels, and the project timeline to assess whether on-time delivery is credible.

Flag any delivery blockers or architecture red flags. Assign a technical risk tier (LOW / MEDIUM / HIGH). Respond in 3-5 concise sentences.`,

  'Risk Analyst': `You are the Risk Analyst in a corporate boardroom tender evaluation.
Identify and quantify delivery risks, reputational exposure, vendor dependency risks, and strategic risks for this project.
Assign a risk tier (LOW / MEDIUM / HIGH / CRITICAL) and recommend mitigation strategies.
Respond in 2-4 concise sentences.`,

  'Operations Manager': `You are the Operations Manager in a corporate boardroom tender evaluation.
Evaluate project execution feasibility: delivery methodology, sprint velocity, team onboarding lead time, and operational overhead.
Flag any execution gaps or process risks that could cause project delays. Respond in 2-4 concise sentences.`,

  'Legal': `You are the Legal Compliance Officer in a corporate boardroom tender evaluation.
Identify regulatory obligations: HIPAA for Healthcare, PCI-DSS for Finance, GDPR, SOC2, contractual risks.
Explicitly flag compliance gaps that could block or delay the project. Respond in 2-4 concise sentences.`,

  'Financial': `You are the CFO and the Account Executive (Sales Representative) in a corporate boardroom tender evaluation.
Combine both roles: evaluate budget viability, profit margins, and financial risk (as CFO), but also act as a sales advocate (as Account Executive) to find ways to make the project viable (e.g., proposing creative commercial models, revised budgets, or phased terms to secure a GO).
Standard dev cost: $12,000–15,000/dev/month. If budget is tight, propose how to adjust scope or pricing to achieve a positive margin. Respond in 2-4 concise sentences.`,

  'Board of Directors': `You are the Chairman of the Board of Directors delivering the FINAL binding verdict.
Review every agent's position and issue a clear, authoritative decision.
Your response MUST end with exactly one verdict tag on its own line:
[VERDICT: GO]
[VERDICT: NEGOTIATE]
[VERDICT: NO-GO]
GO = approved as-is. NEGOTIATE = viable but needs revised terms. NO-GO = rejected.
Respond in 3-5 sentences, then the verdict tag.`
};

// ─── Smart fallback responses (context-aware, honours slider configs) ────────

const buildFallback = (agentName, session, roster, employees, debateHistory, agentConfigs, searchResults = []) => {
  const agentConfig = (agentConfigs || {})[agentName] || DEFAULT_CONFIGS[agentName] || {};
  const budget = Number(session.budget);
  const months = parseInt(session.timeline_months);
  const industry = (session.industry || '').toLowerCase();
  const client = session.client_name;
  const project = session.tender_name;

  const availableDevs = employees.filter(e => e.available);
  const hipaaDevs = employees.filter(e => e.hipaa_certified && e.available);
  const neededDevs = Math.max(2, Math.ceil(budget / (months * 14000)));
  const estimatedCost = neededDevs * months * 13000;
  const viable = budget >= estimatedCost * 0.9;
  const margin = viable ? Math.round(((budget - estimatedCost) / budget) * 100) : 0;

  const isHealthcare = industry.includes('health') || industry.includes('medical');
  const isFinance = industry.includes('financ') || industry.includes('bank');

  const round = debateHistory.length > 0
    ? Math.max(...debateHistory.map(m => m.negotiation_round))
    : 1;

  // Slider values for this specific agent
  const slider1 = agentConfig.slider1 ?? 50;
  const slider2 = agentConfig.slider2 ?? 50;

  const aeAggressive = slider1 >= 70;
  const aeCautious   = slider1 <= 30;
  const boardHighRisk = slider2 >= 70;
  const boardLowRisk  = slider2 <= 30;
  const financialViable = budget >= estimatedCost * (1.0 - (slider1 / 250));
  const legalStrict = slider1 <= 30;

  // Detect unconditional rejection-intent in custom directives.
  // Conditional directives (if/unless/when) are skipped — only Gemini can evaluate those.
  const directiveBlocksApproval = (() => {
    const d = agentConfig.customDirectives || '';
    if (!d) return false;
    const hasCondition = /\b(if|unless|when|only if|except|provided that|in case|where|whenever)\b/i.test(d);
    if (hasCondition) return false;
    return /\b(do not|don't|never|must not|cannot|block|reject|refuse|no-go|disapprove)\b.{0,40}\b(approve|proceed|accept|go|endorse|support|recommend)\b/i.test(d);
  })();

  // Reputation check from web search results
  const negativeKeywords = ['lawsuit', 'sue', 'scam', 'fraud', 'settle', 'fine', 'investigate', 'complaint', 'court', 'guilty', 'prosecut', 'legal battle', 'dispute', 'controversy', 'negative'];
  const negativeResults = (searchResults || []).filter(r => {
    const text = (r.title + ' ' + r.snippet).toLowerCase();
    return negativeKeywords.some(kw => text.includes(kw));
  });
  const hasNegativeReputation = negativeResults.length > 0;

  // Rank available developers by experience, domain match, leave risk, and workload
  const ranked = availableDevs
    .map(e => {
      let score = 0;
      const exp = e.years_experience || 0;
      score += Math.min(exp * 2, 16);
      if (e.hipaa_certified && isHealthcare) score += 10;
      const pastDomains = (e.past_projects || []).map(p =>
        typeof p === 'string' ? '' : (p.domain || '').toLowerCase()
      );
      if (pastDomains.some(d => d.includes(industry.split(' ')[0]))) score += 8;
      const leaveRisk = (e.upcoming_leaves || []).some(l => (l.duration_days || 0) >= 14);
      if (leaveRisk) score -= 6;
      score -= (e.current_project_count || 0) * 5;
      return { ...e, score, leaveRisk };
    })
    .sort((a, b) => b.score - a.score);

  const nominees = ranked.slice(0, neededDevs);
  const nomineeNames = nominees
    .map(e => `${e.name} (${e.role}, ${e.years_experience ? e.years_experience + ' yrs exp' : 'exp unknown'}${e.leaveRisk ? ', ⚠ leave overlap' : ''})`)
    .join(', ');

  const map = {
    'Account Executive': {
      1: directiveBlocksApproval
        ? `I've reviewed the "${project}" opportunity from ${client}, but under my current operational directives I am unable to advocate for approval of this engagement. I am flagging this project as blocked at the sales stage pending a directive review. I recommend the board defer this tender.`
        : aeAggressive
        ? `This is a MUST-WIN engagement — the "${project}" account from ${client} is exactly the strategic foothold we need in the ${session.industry} vertical. Their $${budget.toLocaleString()} investment over ${months} months is a direct pipeline priority for this quarter. I am pushing hard for an unconditional GO; losing this to a competitor is not an option.`
        : aeCautious
        ? `The "${project}" opportunity from ${client} is worth careful consideration, though I want to ensure our team can genuinely deliver before committing. The proposed $${budget.toLocaleString()} budget over ${months} months merits a measured GO pending full team and compliance sign-off. I support advancing cautiously.`
        : `The opportunity from ${client} for "${project}" is exactly the strategic account we've been targeting in the ${session.industry} sector. Their proposed $${budget.toLocaleString()} investment over ${months} months aligns well with our current go-to-market focus. I'm confident in our ability to deliver and strongly advocate for a GO — we cannot afford to let this slip to a competitor.`,
      2: directiveBlocksApproval
        ? `My operational directives prevent me from proposing revised terms on this engagement. I cannot submit a counter-offer and must maintain my objection to proceeding.`
        : `I hear the concerns raised by Finance, Legal, and Architecture — and I'm already in dialogue with ${client} to address them. I propose a revised budget of $${Math.round(budget * 1.22).toLocaleString()} with a phased delivery model: Phase 1 at ${Math.ceil(months * 0.6)} months for MVP, Phase 2 for full rollout. This structure de-risks delivery while securing the engagement. Can the team approve this revised framework?`
    },
    'Resource': {
      1: directiveBlocksApproval
        ? `Under current operational directives, I am required to flag this engagement as unapproved from a resource perspective regardless of bench availability. Staffing cannot be allocated to "${project}" at this time.`
        : availableDevs.length >= neededDevs
        ? `Bench review complete for "${project}" (${session.industry} vertical, ${months}-month window). I recommend the following ${neededDevs}-person team: ${nomineeNames}. ${isHealthcare ? `${hipaaDevs.length} HIPAA-certified developers are included, satisfying compliance staffing requirements.` : 'Domain alignment and experience levels are confirmed.'} ${nominees.some(e => e.leaveRisk) ? `Note: one or more nominees have leave windows exceeding 2 weeks — backup coverage should be planned.` : 'No disruptive leave conflicts identified within this timeline.'}`
        : `Bench review for "${project}" reveals a staffing gap. We need ${neededDevs} developers but only ${availableDevs.length} are fully available. Best available candidates: ${nominees.length > 0 ? nomineeNames : 'none cleared'}. I recommend extending the timeline to ${Math.ceil(months * 1.3)} months or sub-contracting ${neededDevs - availableDevs.length} role(s). This must be resolved before we commit.`,
      2: `Following the ${roster.includes('Account Executive') ? 'Account Executive' : 'Financial Analyst'}'s revised phased proposal, I've re-examined staffing under a reduced Phase 1 team of ${Math.max(2, neededDevs - 1)}. With current bench capacity and the adjusted scope, we can proceed. Leave impacts are manageable within a phased structure. I'm prepared to approve staffing for the revised plan.`
    },
    'Technical Architect': {
      1: directiveBlocksApproval
        ? `My current directives require me to withhold technical sign-off on "${project}". I am flagging this as technically unapproved pending a policy review, regardless of feasibility assessment.`
        : viable
        ? `Technical review of "${project}" is complete. The proposed team brings relevant experience — ${nominees.length > 0 ? `${nominees[0].name} (${nominees[0].years_experience} yrs) can anchor architectural decisions` : 'a senior technical lead is available'}. The ${months}-month timeline is achievable with a structured sprint cadence; I recommend a 2-week discovery sprint upfront. ${nominees.some(e => e.leaveRisk) ? 'A leave coverage plan must be defined for staff with mid-project absences.' : 'No continuity risks from planned absences.'} Technical risk: LOW.`
        : `"${project}" raises delivery concerns. The ${months}-month window is aggressive for a project of this complexity, and ${neededDevs > availableDevs.length ? 'bench capacity is insufficient to staff it correctly' : 'experience levels on the proposed team may not sustain architecture ownership at this pace'}. I estimate a realistic timeline of ${Math.ceil(months * 1.3)}–${Math.ceil(months * 1.5)} months. I'm flagging this as HIGH delivery risk at current parameters.`,
      2: `Under the ${roster.includes('Account Executive') ? "Account Executive's" : "Financial Analyst's"} phased model, technical risk drops significantly. Phase 1 as a focused MVP is architecturally sound — core modules first, integrations deferred. I can approve the revised structure provided a formal architecture checkpoint occurs at Phase 1 close and leave coverage is documented for key resources.`
    },
    'Legal': {
      1: directiveBlocksApproval
        ? `Under active operational directives, Legal is required to withhold approval for "${project}". I am issuing a formal compliance block on this engagement regardless of regulatory standing.`
        : hasNegativeReputation
        ? `I must flag a critical reputational and legal concern for "${project}". A background check on ${client} revealed negative search results or active legal disputes: "${negativeResults[0].title} — ${negativeResults[0].snippet.slice(0, 120)}...". Proceeding presents high litigation and brand damage risk. I am placing a strict conditional hold until a full due diligence audit is completed.`
        : isHealthcare
        ? legalStrict
          ? `"${project}" operates in a HIPAA-regulated environment — compliance here is absolute and non-negotiable. A signed Business Associate Agreement (BAA) and full certification audit of all assigned developers are mandatory before any data access. ${hipaaDevs.length > 0 ? `We have ${hipaaDevs.length} certified developers available, but I will require formal documentation before approving.` : `Currently no available developers are HIPAA-certified — this is a hard blocker. We cannot proceed until this is resolved.`}`
          : `"${project}" operates in a HIPAA-regulated environment — this is non-negotiable. All developers assigned must hold active HIPAA certification, and we require a signed Business Associate Agreement (BAA) from ${client} prior to any data access. ${hipaaDevs.length > 0 ? `We have ${hipaaDevs.length} certified developers available (${hipaaDevs.map(d => d.name).join(', ')}), so compliance is achievable, but contractual protections must be in place before go-live.` : `Currently, none of our available bench developers are HIPAA-certified — this is a blocking compliance risk that must be resolved.`}`
        : isFinance
        ? `"${project}" triggers PCI-DSS Level 1 and SOC 2 Type II obligations as a Financial Services engagement. All infrastructure must be certified and all code subject to independent security audits before production deployment. I recommend building compliance costs (~$15,000) into the contract and including a liability cap clause. Legal can approve subject to these contractual conditions.`
        : `Legal review of "${project}" is complete. Standard commercial IP terms apply — no elevated regulatory exposure detected. I recommend including a robust change-order process, IP ownership clauses, and a data-processing addendum. No compliance blockers identified. Cleared for GO from a legal standpoint.`,
      2: hasNegativeReputation
        ? `While ${roster.includes('Account Executive') ? 'the Account Executive' : 'the Financial Analyst'} has proposed revised terms, the reputational risk regarding ${client}'s legal dispute ("${negativeResults[0].title}") remains unresolved. Legal will only approve this tender on the condition of a formal indemnity clause protecting us against any third-party liability and a full escrow payment structure. Until then, my stance remains Conditional.`
        : `${roster.includes('Account Executive') ? "The Account Executive's" : "The Financial Analyst's"} revised proposal adequately addresses my primary concerns. Subject to the following conditions: (1) BAA signed before data ingestion, (2) all certified resources formally assigned in the SOW, and (3) a compliance audit milestone included in the delivery plan — Legal will withdraw its objection and approve the revised engagement.`
    },
    'Financial': {
      1: directiveBlocksApproval
        ? `Under current directives, Financial is required to flag "${project}" as unapproved. I cannot endorse this engagement regardless of the margin analysis.`
        : financialViable
        ? `Financial analysis complete for "${project}". Staffing ${neededDevs} developers at standard bench rates for ${months} months projects a total cost of approximately $${estimatedCost.toLocaleString()}, against the proposed budget of $${budget.toLocaleString()}. This yields a projected gross margin of ${margin}% — within our acceptable range. I support proceeding.`
        : `The financial case for "${project}" is untenable. Staffing ${neededDevs} developers for ${months} months at standard rates totals $${estimatedCost.toLocaleString()}, which exceeds ${client}'s budget of $${budget.toLocaleString()} by $${(estimatedCost - budget).toLocaleString()}. However, to secure this strategic account, I propose we renegotiate for a revised budget of $${Math.round(budget * 1.22).toLocaleString()} or adopt a phased MVP delivery model to manage our delivery cost.`,
      2: `I propose a revised budget of $${Math.round(budget * 1.22).toLocaleString()} from ${client} with a phased delivery model: Phase 1 as MVP, Phase 2 for full rollout. This structure recovers our margin to approximately ${Math.round((((budget * 1.22) - estimatedCost) / (budget * 1.22)) * 100)}% and resolves the initial financial risk.`
    },
    'Risk Analyst': {
      1: directiveBlocksApproval
        ? `Operational directives require me to treat "${project}" as a NO-GO risk regardless of quantitative assessment. I am formally flagging this engagement as blocked under current policy.`
        : viable
        ? `Risk assessment for "${project}" is complete. Primary risks: scope creep in ${session.industry} environments (~35% probability), ${nominees.some(e => e.leaveRisk) ? 'mid-project leave gaps for key staff (flag for contingency coverage)' : 'key-person dependency on lead resources'}, and ${isHealthcare ? 'HIPAA audit delays' : isFinance ? 'PCI-DSS certification timeline' : 'third-party API integration delays'}. Overall risk tier: MEDIUM. Recommended mitigations: weekly risk register reviews, a 10% contingency buffer, and formal leave-coverage assignments.`
        : `Risk assessment for "${project}" raises a RED FLAG. Under-resourced budget, tight timeline, and ${isHealthcare ? 'HIPAA obligations' : isFinance ? 'PCI-DSS requirements' : 'complex integration requirements'} create a HIGH delivery risk profile. Probability of on-time, on-budget delivery at current parameters: ~40%. I strongly recommend renegotiating terms before commitment.`,
      2: `Under the revised phased model proposed by the ${roster.includes('Account Executive') ? 'Account Executive' : 'Financial Analyst'}, the risk profile improves from HIGH to MEDIUM. Phase-gated delivery reduces exposure materially. Provided risk checkpoints are embedded at each phase boundary, contingency is contractually reserved at 10%, and leave-coverage plans are documented, I can revise my rating to ACCEPTABLE.`
    },
    'Operations Manager': {
      1: directiveBlocksApproval
        ? `Operational directives prevent me from endorsing "${project}" at this time. I am withholding operational sign-off pending a policy directive review.`
        : `Operations review of "${project}" is complete. A ${months}-month project of this scale requires ${isHealthcare ? 'a HIPAA-aware Agile framework with biweekly compliance checkpoints' : 'a standard Agile sprint cadence with 2-week sprints'}. ${availableDevs.length >= neededDevs ? `Team onboarding can begin within 5–7 business days given current bench availability.` : `With current availability, onboarding will take 3–4 weeks, compressing the delivery window.`} ${nominees.some(e => e.leaveRisk) ? 'A leave-coverage roster must be published before sprint 1 to avoid mid-sprint disruptions.' : ''} I recommend a formal kickoff workshop and a project charter sign-off before sprint 1.`,
      2: `The phased delivery structure proposed is operationally sound. Phase 1 MVP with a focused core team reduces coordination overhead significantly. I'll implement a structured RAID log from Day 1 and establish weekly stakeholder reporting to ${client}. Operations can support the revised plan.`
    },
    'Board of Directors': {
      1: directiveBlocksApproval
        ? `The Board has reviewed the "${project}" tender from ${client}. Standing operational directives require the Board to withhold approval on this engagement. The Board issues its binding ruling.\n[VERDICT: NO-GO]`
        : (boardHighRisk || viable) && (!isHealthcare || hipaaDevs.length > 0) && !boardLowRisk
        ? `The Board has reviewed all departmental assessments for the "${project}" tender submitted by ${client}. All departments — ${roster.includes('Account Executive') ? 'Sales' : 'Sales/Finance'}, Resource, Technical Architecture, Legal, and Finance — have validated the project parameters within their respective remits. Risk exposure is within tolerance and strategic fit is confirmed. The Board issues its official verdict.\n[VERDICT: GO]`
        : `The Board has reviewed all departmental assessments for "${project}". While the strategic opportunity is acknowledged, ${viable ? 'compliance and delivery' : 'financial viability and delivery'} concerns raised by multiple departments require formal resolution before commitment can be made. The Board directs ${roster.includes('Account Executive') ? 'Sales' : 'the Financial Analyst'} to re-engage ${client} with revised terms addressing the flagged objections. The Board issues a conditional ruling.\n[VERDICT: NEGOTIATE]`,
      2: `The Board has considered the revised proposal presented during renegotiation for the "${project}" tender. The ${roster.includes('Account Executive') ? "Account Executive's" : "Financial Analyst's"} counter-offer addresses the core financial and compliance concerns, and the phased delivery model reduces technical risk to an acceptable level. Subject to execution of the formal amendment and compliance sign-offs, the Board approves advancing this engagement.\n[VERDICT: NEGOTIATE]`,
      3: `The Board has completed a full two-round review of the "${project}" tender with ${client}. The renegotiation produced a viable revised framework satisfying Financial, Legal, and Technical requirements. Conditional approval is granted, pending execution of the revised SOW and compliance documentation. The Board issues its final ruling.\n[VERDICT: NEGOTIATE]`
    }
  };

  const agentResponses = map[agentName];
  if (!agentResponses) return `Assessment of "${project}" complete. My evaluation has been submitted to the boardroom record.`;
  return agentResponses[round] || agentResponses[1];
};

// ─── Gemini call with retry-then-fallback ────────────────────────────────────

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const callGemini = async (agentName, contextPrompt, session, roster, employees, debateHistory, agentConfigs, searchResults = []) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const agentConfig = (agentConfigs || {})[agentName] || DEFAULT_CONFIGS[agentName] || {};

  let systemInstruction = AGENT_PERSONAS[agentName];

  if (agentConfig.customDirectives) {
    systemInstruction += `\n\nCUSTOM OPERATIONAL DIRECTIVES:\n${agentConfig.customDirectives}`;
  }

  if (agentName === 'Account Executive') {
    systemInstruction += `\nSales aggressiveness (0=very cautious advocate, 100=maximum aggressive push): ${agentConfig.slider1}%.`;
    systemInstruction += `\nRisk tolerance (0=only risk-free deals, 100=high risk tolerance): ${agentConfig.slider2}%.`;
  } else if (agentName === 'Legal') {
    systemInstruction += `\nRegulatory interpretation (0=strict literal adherence, 100=interpretative flexibility): ${agentConfig.slider1}%.`;
    systemInstruction += `\nCompliance tolerance (0=absolute zero tolerance for gaps, 100=edge cases acceptable): ${agentConfig.slider2}%.`;
  } else if (agentName === 'Resource') {
    systemInstruction += `\nEstimation style (0=conservative staffing estimates, 100=optimistic estimates): ${agentConfig.slider1}%.`;
    systemInstruction += `\nTechnology stance (0=proven tech only, 100=bleeding edge acceptable): ${agentConfig.slider2}%.`;
  } else if (agentName === 'Financial') {
    systemInstruction += `\nPricing stance (0=strict margin protection required, 100=aggressive pricing/lower margins acceptable): ${agentConfig.slider1}%.`;
    systemInstruction += `\nCost structure preference (0=fixed costs strongly preferred, 100=variable/leverage models acceptable): ${agentConfig.slider2}%.`;
  } else if (agentName === 'Technical Architect') {
    systemInstruction += `\nArchitecture stance (0=proven/battle-tested patterns only, 100=cutting-edge/experimental acceptable): ${agentConfig.slider1}%.`;
    systemInstruction += `\nTechnical scrutiny (0=pragmatic/lenient review, 100=strict/zero technical debt tolerance): ${agentConfig.slider2}%.`;
  } else if (agentName === 'Risk Analyst') {
    systemInstruction += `\nRisk sensitivity (0=conservative/flags everything, 100=lenient/high risk tolerance): ${agentConfig.slider1}%.`;
    systemInstruction += `\nMitigation requirement (0=full mitigation plan required before GO, 100=flag-and-proceed acceptable): ${agentConfig.slider2}%.`;
  } else if (agentName === 'Operations Manager') {
    systemInstruction += `\nProcess rigidity (0=strict governance/full waterfall oversight, 100=lean/agile/minimal process): ${agentConfig.slider1}%.`;
    systemInstruction += `\nOnboarding pace (0=slow methodical ramp-up, 100=fast aggressive onboarding): ${agentConfig.slider2}%.`;
  } else if (agentName === 'Board of Directors') {
    systemInstruction += `\nStrategic stance (0=fully defensive/conservative, 100=aggressive market capture): ${agentConfig.slider1}%.`;
    systemInstruction += `\nRisk appetite (0=minimise all exposure, 100=high beta/aggressive risk acceptable): ${agentConfig.slider2}%.`;
  }

  if (apiKey) {
    const PRIMARY_MODEL = 'gemini-2.5-flash';

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const modelOptions = { model: PRIMARY_MODEL, systemInstruction };
      if (agentName === 'Legal') {
        modelOptions.tools = [{ googleSearch: {} }];
      }
      const model = genAI.getGenerativeModel(modelOptions);
      const result = await model.generateContent(contextPrompt);
      return { text: result.response.text().trim(), source: 'gemini' };
    } catch (err) {
      const msg = err.message || '';
      const is429 = msg.includes('429') || msg.includes('Too Many Requests');
      const is503 = msg.includes('503') || msg.includes('Service Unavailable') || msg.includes('overloaded');
      const shouldRetry = is429 || is503;

      if (shouldRetry) {
        // Rate limits are project-wide — retry same model after API-suggested delay
        const retryMatch = msg.match(/"retryDelay":\s*"(\d+)s"/);
        const retryDelaySec = retryMatch ? parseInt(retryMatch[1]) : (is503 ? 8 : 20);
        const waitMs = Math.min(retryDelaySec, 90) * 1000 + 1000;

        console.log(`[Gemini] ${is429 ? 'Rate limited' : 'Service unavailable'} for ${agentName}. Retrying in ${Math.round(waitMs/1000)}s...`);
        await sleep(waitMs);
        await geminiRateLimiter.throttle();

        try {
          const genAI2 = new GoogleGenerativeAI(apiKey);
          const retry2Options = { model: PRIMARY_MODEL, systemInstruction };
          if (agentName === 'Legal') retry2Options.tools = [{ googleSearch: {} }];
          const model2 = genAI2.getGenerativeModel(retry2Options);
          const result2 = await model2.generateContent(contextPrompt);
          return { text: result2.response.text().trim(), source: 'gemini' };
        } catch (retryErr) {
          console.warn(`[Gemini] Retry failed for ${agentName} — switching to fallback. Reason: ${retryErr.message.slice(0, 80)}`);
        }
      } else {
        console.error(`[Gemini] Non-retryable error for ${agentName}:`, msg);
      }
    }
  }

  return { text: buildFallback(agentName, session, roster, employees, debateHistory, agentConfigs, searchResults), source: 'fallback' };
};

// ─── Context prompt builder ──────────────────────────────────────────────────

// Workload label from active project count
const workloadLabel = (count) => {
  if (count === 0) return 'Fully available';
  if (count === 1) return 'Partial capacity (1 active project)';
  return `High load (${count} active projects)`;
};

const buildContext = (agentName, session, roster, employees, debateHistory, extraNote, missionBriefing, searchResults = []) => {
  const available = employees.filter(e => e.available);
  const engaged   = employees.filter(e => !e.available);
  const hipaaDevs = employees.filter(e => e.hipaa_certified && e.available);

  const fmtEmp = (e) => {
    const skills   = (e.tech_stacks || e.skills || []).join(', ') || 'N/A';
    const exp      = e.years_experience != null ? `${e.years_experience} yrs exp` : 'exp unknown';
    const workload = workloadLabel(e.current_project_count || (e.current_projects || []).length);

    // Past project domains
    const pastDomains = (e.past_projects || [])
      .map(p => typeof p === 'string' ? p : `${p.name} [${p.domain || 'General'}, ${p.complexity || 'medium'} complexity]`)
      .join('; ');

    // Upcoming leave windows
    const leaves = (e.upcoming_leaves || []);
    const leaveStr = leaves.length > 0
      ? `LEAVE: ${leaves.map(fmtLeave).join(' | ')}`
      : 'No upcoming leaves';

    let line = `  - ${e.name} | ${e.role || e.designation} | ${exp} | Skills: ${skills} | Workload: ${workload}`;
    if (pastDomains) line += ` | Past projects: ${pastDomains}`;
    line += ` | ${leaveStr}`;
    return line;
  };

  const allSkills = [...new Set(employees.flatMap(e => e.tech_stacks || e.skills || []))].sort();

  const historyText = debateHistory.length > 0
    ? debateHistory.map(m => `[${m.sender}] (Round ${m.negotiation_round}): ${m.message_text}`).join('\n\n')
    : 'You are opening the boardroom debate.';

  const budget = Number(session.budget);
  const months = parseInt(session.timeline_months);
  const estimatedDevs = Math.max(2, Math.ceil(budget / (months * 14000)));

  let searchSection = '';
  if (agentName === 'Legal' && searchResults && searchResults.length > 0) {
    searchSection = `\n\nWEB SEARCH RESULTS FOR "${session.client_name}" / "${session.tender_name}":\n` +
      searchResults.map((r, i) => `[Result ${i+1}] Title: ${r.title}\nSnippet: ${r.snippet}\nLink: ${r.link}`).join('\n\n') +
      `\n\nINSTRUCTION: Analyze the above web search results for any legal issues, lawsuits, fraud allegations, negative reputation, or active disputes involving "${session.client_name}". If there are negative findings, you MUST explicitly mention them and raise a warning / flag a compliance risk.`;
  }

  return `TENDER DETAILS:
- Project: ${session.tender_name}
- Client: ${session.client_name}
- Budget: $${budget.toLocaleString()}
- Timeline: ${months} months
- Industry: ${session.industry}
- Agents: ${roster.join(', ')}
- Estimated team size needed for this project: ~${estimatedDevs} developers (budget ÷ $14k/dev/month)
  IMPORTANT: Evaluate whether ${estimatedDevs} suitable developers are available — do NOT suggest staffing the entire bench.
${searchSection}

EMPLOYEE ROSTER (${employees.length} total):

AVAILABLE for new work (${available.length})${hipaaDevs.length ? ` — HIPAA-certified: ${hipaaDevs.length}` : ''}:
${available.length > 0 ? available.map(fmtEmp).join('\n') : '  (none available — all staff are currently engaged)'}

CURRENTLY ENGAGED on active projects (${engaged.length}):
${engaged.length > 0 ? engaged.map(fmtEmp).join('\n') : '  (none engaged)'}

Full tech stack coverage: ${allSkills.length > 0 ? allSkills.join(', ') : 'N/A'}

TRANSCRIPT:
${historyText}
${missionBriefing ? `\nMISSION BRIEFING FROM COMMAND: ${missionBriefing}` : ''}
${extraNote ? `\nNOTE: ${extraNote}` : ''}

Provide your assessment:`;
};

// ─── Main debate orchestrator ────────────────────────────────────────────────

const searchDuckDuckGo = async (query) => {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    console.log(`[Search] Querying DuckDuckGo for: "${query}"`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const html = await response.text();
    const results = [];
    const parts = html.split('class="result results_links results_links_deep web-result');
    for (let i = 1; i < parts.length && results.length < 5; i++) {
      const part = parts[i];
      const titleMatch = part.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : '';
      const snippetMatch = part.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';
      const hrefMatch = part.match(/href="([^"]*)"/);
      let link = '';
      if (hrefMatch) {
        const rawHref = hrefMatch[1];
        if (rawHref.includes('uddg=')) {
          link = decodeURIComponent(rawHref.split('uddg=')[1].split('&')[0]);
        } else {
          link = 'https:' + rawHref;
        }
      }
      if (title || snippet) results.push({ title, snippet, link });
    }
    console.log(`[Search] Found ${results.length} web search results.`);
    return results;
  } catch (error) {
    console.warn(`[Search] Error performing web search: ${error.message}`);
    return [];
  }
};

const runDebateAsync = async (session, roster, emitter, pool, missionBriefing = null, userId = null, isCancelled = () => false) => {
  const sessionId = session.id;
  const employees = await getEmployeesFromDB(pool, parseInt(session.timeline_months) || 6);
  const agentConfigs = await getConfigsForUser(pool, userId);
  const debateHistory = [];

  let searchResults = [];
  if (roster.includes('Legal')) {
    const query = `${session.client_name} ${session.tender_name} lawsuit legal dispute reputation`;
    searchResults = await searchDuckDuckGo(query);
  }


  const emit = (event, data) => emitter.emit(`${event}:${sessionId}`, data);

  const runAgent = async (agentName, round, extraNote = '') => {
    if (isCancelled()) throw new Error('CANCELLED');

    emit('typing', { sender: agentName });

    await geminiRateLimiter.throttle();

    if (isCancelled()) throw new Error('CANCELLED');

    const contextPrompt = buildContext(agentName, session, roster, employees, debateHistory, extraNote, missionBriefing, searchResults);
    const { text: messageText } = await callGemini(agentName, contextPrompt, session, roster, employees, debateHistory, agentConfigs, searchResults);

    const msg = { sender: agentName, message_text: messageText, negotiation_round: round };
    debateHistory.push(msg);

    if (pool) {
      await pool.query(
        'INSERT INTO debate_messages (session_id, sender, message_text, negotiation_round) VALUES ($1, $2, $3, $4)',
        [sessionId, agentName, messageText, round]
      ).catch(e => console.error(`DB save error (${agentName}):`, e.message));
    }

    emit('message', msg);
    return messageText;
  };

  const agentFlags = {};

  try {
    // ── First: Store and emit User prompt/directives ────────────────────────
    const userBriefing = missionBriefing && missionBriefing.trim() 
      ? missionBriefing.trim() 
      : `Initiating boardroom evaluation for tender '${session.tender_name}' with client '${session.client_name}'.`;
    
    const initialUserMsg = { sender: 'User', message_text: userBriefing, negotiation_round: 0 };
    debateHistory.push(initialUserMsg);

    if (pool) {
      await pool.query(
        'INSERT INTO debate_messages (session_id, sender, message_text, negotiation_round) VALUES ($1, $2, $3, $4)',
        [sessionId, initialUserMsg.sender, initialUserMsg.message_text, initialUserMsg.negotiation_round]
      ).catch(e => console.error(`DB save error (User):`, e.message));
    }
    
    // Small delay to make sure client SSE listener is connected
    await new Promise(resolve => setTimeout(resolve, 500));
    emit('message', initialUserMsg);

    // ── Round 1: Initial presentations ──────────────────────────────────────
    if (roster.includes('Account Executive')) {
      await runAgent('Account Executive', 1);
      agentFlags['Account Executive'] = 'approved';
    }

    let resourceFlagged = false;
    if (roster.includes('Resource')) {
      const resourceMsg = await runAgent('Resource', 1);
      const rL = resourceMsg.toLowerCase();
      resourceFlagged = rL.includes('staffing gap') || rL.includes('none available') ||
                        rL.includes('no available') || rL.includes('shortfall') ||
                        rL.includes('cannot staff') || rL.includes('no developers') ||
                        rL.includes('0 developers') || rL.includes('not enough') ||
                        rL.includes('insufficient') || rL.includes('resolve before') ||
                        rL.includes('leave gap') || rL.includes('leave conflict');
      agentFlags['Resource'] = resourceFlagged ? 'flagged' : 'approved';
    }

    let techFlagged = false;
    if (roster.includes('Technical Architect')) {
      const techMsg = await runAgent('Technical Architect', 1);
      const lower = techMsg.toLowerCase();
      techFlagged = lower.includes('not feasible') || lower.includes('unrealistic') ||
                    lower.includes('blocker') || lower.includes('concern') ||
                    lower.includes('insufficient') || lower.includes('too short') ||
                    lower.includes('aggressive') || lower.includes('cannot') ||
                    lower.includes('flagging') || lower.includes('high delivery risk') ||
                    lower.includes('reject') || lower.includes('no-go') || lower.includes('decline') ||
                    lower.includes('continuity risk') || lower.includes('experience gap');
      agentFlags['Technical Architect'] = techFlagged ? 'conditional' : 'approved';
    }

    let riskFlagged = false;
    if (roster.includes('Risk Analyst')) {
      const riskMsg = await runAgent('Risk Analyst', 1);
      const lower = riskMsg.toLowerCase();
      riskFlagged = lower.includes('high') || lower.includes('critical') ||
                    lower.includes('red flag') || lower.includes('strongly recommend') ||
                    lower.includes('renegotiat') || lower.includes('unacceptable') ||
                    lower.includes('reject') || lower.includes('no-go') || lower.includes('decline');
      agentFlags['Risk Analyst'] = riskFlagged ? 'conditional' : 'approved';
    }

    let opsConcern = false;
    if (roster.includes('Operations Manager')) {
      const opsMsg = await runAgent('Operations Manager', 1);
      const lower = opsMsg.toLowerCase();
      opsConcern = lower.includes('cannot execute') || lower.includes('execution gap') ||
                   lower.includes('not executable') || lower.includes('operationally unsound') ||
                   lower.includes('reject') || lower.includes('no-go') || lower.includes('decline');
      agentFlags['Operations Manager'] = opsConcern ? 'conditional' : 'approved';
    }

    let legalFlagged = false;
    if (roster.includes('Legal')) {
      const legalMsg = await runAgent('Legal', 1);
      const lower = legalMsg.toLowerCase();
      legalFlagged = lower.includes('violation') || lower.includes('non-compliant') ||
                     lower.includes('cannot approve') || lower.includes('blocking') ||
                     lower.includes('flagging') || lower.includes('prohibit') ||
                     lower.includes('must') || lower.includes('warning') ||
                     lower.includes('no certified') || lower.includes('baa') ||
                     lower.includes('reject') || lower.includes('no-go') || lower.includes('decline') || lower.includes('do not accept') ||
                     lower.includes('reputation') || lower.includes('lawsuit') ||
                     lower.includes('legal battle') || lower.includes('scam') ||
                     lower.includes('court') || lower.includes('litigation') ||
                     lower.includes('due diligence');
      agentFlags['Legal'] = legalFlagged ? 'conditional' : 'approved';
    }

    let financeFlagged = false;
    if (roster.includes('Financial')) {
      const financeMsg = await runAgent('Financial', 1);
      const lower = financeMsg.toLowerCase();
      financeFlagged = lower.includes('negative') || lower.includes('deficit') ||
                       lower.includes('too low') || lower.includes('insufficient') ||
                       lower.includes('unviable') || lower.includes('untenable') ||
                       lower.includes('loss') || lower.includes('exceeds') ||
                       lower.includes('shortfall') || lower.includes('blocker') ||
                       lower.includes('cannot cover') || lower.includes('renegotiat') ||
                       lower.includes('reject') || lower.includes('no-go') || lower.includes('decline') || lower.includes('do not accept');
      agentFlags['Financial'] = financeFlagged ? 'flagged' : 'approved';
    }

    // ── Round 2: Renegotiation ───────────────────────────────────────────────
    const anyFlagged = financeFlagged || legalFlagged || techFlagged || riskFlagged || resourceFlagged;
    if (anyFlagged) {
      const issues = [];
      if (resourceFlagged) issues.push('Resource Manager flagged insufficient available staff or leave conflicts');
      if (financeFlagged)  issues.push('budget flagged as financially unviable');
      if (legalFlagged)    issues.push('unresolved regulatory compliance concerns');
      if (techFlagged)     issues.push('Technical Architect raised feasibility, experience, or continuity concerns');
      if (riskFlagged)     issues.push('Risk Analyst flagged HIGH or CRITICAL risk profile');

      const proposerName = roster.includes('Account Executive') ? 'Account Executive' : (roster.includes('Financial') ? 'Financial' : null);

      if (proposerName) {
        if (proposerName === 'Account Executive') {
          await runAgent('Account Executive', 2,
            `Concerns raised: ${issues.join('; ')}. Propose a concrete counter-offer and revised terms.`);
          agentFlags['Account Executive'] = 'approved'; // AE always advocates
        } else {
          await runAgent('Financial', 2,
            `Concerns raised: ${issues.join('; ')}. As Sales/AE advocate, propose a concrete counter-offer and revised terms.`);
          agentFlags['Financial'] = 'conditional'; // negotiated — conditions placed
        }
      }

      if (legalFlagged && roster.includes('Legal')) {
        const reactionContext = proposerName
          ? `${proposerName} proposed compliance remediation or revised terms. Are these measures sufficient?`
          : 'Re-evaluate our compliance stance. Are there any mitigating terms we can apply?';
        await runAgent('Legal', 2, reactionContext);
        agentFlags['Legal'] = 'conditional'; // conditions placed but not hard-blocked
      }

      if (proposerName === 'Account Executive' && financeFlagged && roster.includes('Financial')) {
        await runAgent('Financial', 2,
          'Account Executive proposed revised terms. Does the counter-offer resolve the financial concern?');
        agentFlags['Financial'] = 'conditional'; // negotiated — conditions placed
      }
    }

    // ── Final: Board of Directors verdict ───────────────────────────────────
    const boardRound = anyFlagged ? 3 : 2;
    const boardMsg = await runAgent('Board of Directors', boardRound,
      'All agents have presented. Deliver the final binding verdict.');

    let verdict = 'GO';
    if (boardMsg.includes('[VERDICT: NO-GO]') || /\bno.go\b/i.test(boardMsg)) verdict = 'NO-GO';
    else if (boardMsg.includes('[VERDICT: NEGOTIATE]') || /\bnegotiate\b/i.test(boardMsg)) verdict = 'NEGOTIATE';

    if (verdict === 'GO') {
      Object.keys(agentFlags).forEach(k => {
        if (agentFlags[k] === 'conditional') agentFlags[k] = 'approved';
      });
    }

    const currentBudget = parseFloat(session.budget);
    const finalBudget = verdict === 'NEGOTIATE' ? Math.round(currentBudget * 1.25) : currentBudget;

    let updatedSession = { ...session, final_verdict: verdict, final_budget: finalBudget };
    if (pool) {
      const result = await pool.query(
        'UPDATE evaluation_sessions SET final_verdict = $1, final_budget = $2 WHERE id = $3 RETURNING *',
        [verdict, finalBudget, sessionId]
      ).catch(e => { console.error('Failed to persist verdict:', e.message); return { rows: [] }; });

      if (result.rows.length > 0) updatedSession = result.rows[0];
    }

    emit('done', { ...updatedSession, agentFlags });

  } catch (err) {
    if (err.message === 'CANCELLED') {
      console.log(`[Debate] Session ${sessionId} stopped after cancellation.`);
      if (pool) {
        pool.query('UPDATE evaluation_sessions SET final_verdict = $1 WHERE id = $2', ['CANCELLED', sessionId])
          .catch(() => {});
      }
      return;
    }
    console.error(`Debate engine error (session ${sessionId}):`, err.message);
    emit('error', { error: err.message || 'Debate engine encountered an error' });
    if (pool) {
      pool.query('UPDATE evaluation_sessions SET final_verdict = $1 WHERE id = $2', ['ERROR', sessionId])
        .catch(() => {});
    }
  }
};

module.exports = { runDebateAsync };
