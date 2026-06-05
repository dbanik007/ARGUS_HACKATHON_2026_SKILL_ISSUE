'use strict';
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { getConfigs } = require('./agentConfigs');

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

  'Financial': `You are the CFO in a corporate boardroom tender evaluation.
Evaluate budget viability, profit margins, and financial risk. Standard dev cost: $12,000–15,000/dev/month.
If budget cannot cover staffing plus margin, say so clearly. Respond in 2-4 concise sentences.`,

  'Board of Directors': `You are the Chairman of the Board of Directors delivering the FINAL binding verdict.
Review every agent's position and issue a clear, authoritative decision.
Your response MUST end with exactly one verdict tag on its own line:
[VERDICT: GO]
[VERDICT: NEGOTIATE]
[VERDICT: NO-GO]
GO = approved as-is. NEGOTIATE = viable but needs revised terms. NO-GO = rejected.
Respond in 3-5 sentences, then the verdict tag.`
};

// ─── Smart fallback responses (context-aware, used when Gemini quota is exceeded) ─

const buildFallback = (agentName, session, employees, debateHistory) => {
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

  // Identify best candidates with richer signals
  const ranked = availableDevs
    .map(e => {
      let score = 0;
      const exp = e.years_experience || 0;
      score += Math.min(exp * 2, 16); // up to 16 pts for 8+ yrs
      if (e.hipaa_certified && isHealthcare) score += 10;
      const pastDomains = (e.past_projects || []).map(p =>
        typeof p === 'string' ? '' : (p.domain || '').toLowerCase()
      );
      if (pastDomains.some(d => d.includes(industry.split(' ')[0]))) score += 8;
      const leaveRisk = (e.upcoming_leaves || []).some(l => (l.duration_days || 0) >= 14);
      if (leaveRisk) score -= 6;
      const workload = e.current_project_count || 0;
      score -= workload * 5;
      return { ...e, score, leaveRisk };
    })
    .sort((a, b) => b.score - a.score);

  const nominees = ranked.slice(0, neededDevs);
  const nomineeNames = nominees
    .map(e => `${e.name} (${e.role}, ${e.years_experience ? e.years_experience + ' yrs exp' : 'exp unknown'}${e.leaveRisk ? ', ⚠ leave overlap' : ''})`)
    .join(', ');

  const map = {
    'Account Executive': {
      1: `The opportunity from ${client} for "${project}" is exactly the strategic account we've been targeting in the ${session.industry} sector. Their proposed $${budget.toLocaleString()} investment over ${months} months aligns well with our current go-to-market focus. I'm confident in our ability to deliver and strongly advocate for a GO — we cannot afford to let this slip to a competitor.`,
      2: `I hear the concerns raised by Finance, Legal, and Architecture — and I'm already in dialogue with ${client} to address them. I propose a revised budget of $${Math.round(budget * 1.22).toLocaleString()} with a phased delivery model: Phase 1 at ${Math.ceil(months * 0.6)} months for MVP, Phase 2 for full rollout. This structure de-risks delivery while securing the engagement. Can the team approve this revised framework?`
    },
    'Resource': {
      1: availableDevs.length >= neededDevs
        ? `Bench review complete for "${project}" (${session.industry} vertical, ${months}-month window). I recommend the following ${neededDevs}-person team: ${nomineeNames}. ${isHealthcare ? `${hipaaDevs.length} HIPAA-certified developers are included, satisfying compliance staffing requirements.` : 'Domain alignment and experience levels are confirmed.'} ${nominees.some(e => e.leaveRisk) ? `Note: one or more nominees have leave windows exceeding 2 weeks during the project — backup coverage should be planned.` : 'No disruptive leave conflicts identified within this timeline.'}`
        : `Bench review for "${project}" reveals a staffing gap. We need ${neededDevs} developers but only ${availableDevs.length} are fully available. Best available candidates: ${nominees.length > 0 ? nomineeNames : 'none cleared'}. I recommend extending the timeline to ${Math.ceil(months * 1.3)} months or sub-contracting ${neededDevs - availableDevs.length} role(s). This must be resolved before we commit.`,
      2: `Following the Account Executive's revised phased proposal, I've re-examined staffing under a reduced Phase 1 team of ${Math.max(2, neededDevs - 1)}. With current bench capacity and the adjusted scope, we can proceed. Leave impacts are manageable within a phased structure. I'm prepared to approve staffing for the revised plan.`
    },
    'Technical Architect': {
      1: viable
        ? `Technical review of "${project}" is complete. The proposed team brings relevant experience — ${nominees.length > 0 ? `${nominees[0].name} (${nominees[0].years_experience} yrs) can anchor architectural decisions` : 'a senior technical lead is available'}. The ${months}-month timeline is achievable with a structured sprint cadence; I recommend a 2-week discovery sprint upfront. ${nominees.some(e => e.leaveRisk) ? 'A leave coverage plan must be defined for staff with mid-project absences.' : 'No continuity risks from planned absences.'} Technical risk: LOW.`
        : `"${project}" raises delivery concerns. The ${months}-month window is aggressive for a project of this complexity, and ${neededDevs > availableDevs.length ? 'bench capacity is insufficient to staff it correctly' : 'experience levels on the proposed team may not sustain architecture ownership at this pace'}. I estimate a realistic timeline of ${Math.ceil(months * 1.3)}–${Math.ceil(months * 1.5)} months. I'm flagging this as HIGH delivery risk at current parameters.`,
      2: `Under the Account Executive's phased model, technical risk drops significantly. Phase 1 as a focused MVP is architecturally sound — core modules first, integrations deferred. I can approve the revised structure provided a formal architecture checkpoint occurs at Phase 1 close and leave coverage is documented for key resources.`
    },
    'Legal': {
      1: isHealthcare
        ? `"${project}" operates in a HIPAA-regulated environment. All assigned developers must hold active HIPAA certification, and a signed Business Associate Agreement (BAA) from ${client} is required before any data access. ${hipaaDevs.length > 0 ? `We have ${hipaaDevs.length} certified developer(s) available (${hipaaDevs.map(d => d.name).join(', ')}), so compliance staffing is achievable, but contractual protections must be in place before go-live.` : 'None of our available staff are currently HIPAA-certified — this is a blocking compliance risk.'}`
        : isFinance
        ? `"${project}" triggers PCI-DSS Level 1 and SOC 2 Type II obligations as a Financial Services engagement. All infrastructure must be certified and code subject to independent security audits before production. I recommend building compliance costs (~$15,000) into the contract and including a liability cap clause. Legal can approve subject to these conditions.`
        : `Legal review of "${project}" is complete. Standard commercial IP terms apply — no elevated regulatory exposure detected. I recommend including a robust change-order process, IP ownership clauses, and a data-processing addendum. No compliance blockers identified; cleared for GO from a legal standpoint.`,
      2: `The Account Executive's revised proposal adequately addresses my primary concerns. Subject to: (1) BAA signed before data ingestion, (2) all certified resources formally assigned in the SOW, and (3) a compliance audit milestone in the delivery plan — Legal will withdraw its objection and approve the revised engagement.`
    },
    'Financial': {
      1: viable
        ? `Financial analysis complete for "${project}". Staffing ${neededDevs} developers at standard bench rates for ${months} months projects a total cost of approximately $${estimatedCost.toLocaleString()}, against the proposed budget of $${budget.toLocaleString()}. This yields a projected gross margin of ${margin}% — within our acceptable range. I support proceeding.`
        : `The financial case for "${project}" is currently untenable. Staffing ${neededDevs} qualified developers for ${months} months at standard rates totals $${estimatedCost.toLocaleString()}, which exceeds ${client}'s proposed budget of $${budget.toLocaleString()} by $${(estimatedCost - budget).toLocaleString()}. We cannot absorb a negative-margin engagement. I am flagging this as a financial blocker and recommending renegotiation.`,
      2: `If the Account Executive can secure a revised budget of $${Math.round(budget * 1.22).toLocaleString()} from ${client}, the margin recovers to approximately ${Math.round((((budget * 1.22) - estimatedCost) / (budget * 1.22)) * 100)}% — acceptable under our standard risk parameters. Provided the client amendment is signed before mobilization, I will withdraw my financial objection.`
    },
    'Risk Analyst': {
      1: viable
        ? `Risk assessment for "${project}" is complete. Primary risks: scope creep in ${session.industry} environments (~35% probability), ${nominees.some(e => e.leaveRisk) ? 'mid-project leave gaps for key staff (flag for contingency coverage)' : 'key-person dependency on lead resources'}, and ${isHealthcare ? 'HIPAA audit delays' : isFinance ? 'PCI-DSS certification timeline' : 'third-party API integration delays'}. Overall risk tier: MEDIUM. Recommended mitigations: weekly risk register reviews, a 10% contingency buffer, and formal leave-coverage assignments.`
        : `Risk assessment for "${project}" raises a RED FLAG. Under-resourced budget, tight timeline, and ${isHealthcare ? 'HIPAA obligations' : isFinance ? 'PCI-DSS requirements' : 'complex integration requirements'} create a HIGH delivery risk profile. Probability of on-time, on-budget delivery at current parameters: ~40%. I strongly recommend renegotiating terms before commitment.`,
      2: `Under the revised phased model, the risk profile improves from HIGH to MEDIUM. Phase-gated delivery reduces exposure materially. Provided risk checkpoints are embedded at each phase boundary, contingency is contractually reserved at 10%, and leave-coverage plans are documented, I can revise my rating to ACCEPTABLE.`
    },
    'Operations Manager': {
      1: `Operations review of "${project}" is complete. A ${months}-month engagement requires ${isHealthcare ? 'a HIPAA-aware Agile framework with biweekly compliance checkpoints' : 'a standard Agile sprint cadence with 2-week sprints'}. ${availableDevs.length >= neededDevs ? `Team onboarding can begin within 5–7 business days given current bench availability.` : `With current availability, onboarding will take 3–4 weeks, compressing the delivery window.`} ${nominees.some(e => e.leaveRisk) ? 'A leave-coverage roster must be published before sprint 1 to avoid mid-sprint disruptions.' : ''} I recommend a formal kickoff workshop and project charter sign-off before sprint 1.`,
      2: `The phased delivery structure proposed is operationally sound. Phase 1 MVP with a focused core team reduces coordination overhead significantly. I'll implement a RAID log from Day 1 and establish weekly stakeholder reporting to ${client}. Operations can support the revised plan.`
    },
    'Board of Directors': {
      1: viable && (!isHealthcare || hipaaDevs.length > 0)
        ? `The Board has reviewed all departmental assessments for the "${project}" tender submitted by ${client}. Sales, Resource, Technical Architecture, Legal, and Finance have all validated project parameters within their respective remits. Risk exposure is within tolerance and strategic fit is confirmed. The Board issues its official verdict.\n[VERDICT: GO]`
        : `The Board has reviewed all departmental assessments for "${project}". While the strategic opportunity is acknowledged, ${viable ? 'compliance and delivery' : 'financial viability and delivery'} concerns raised by multiple departments require formal resolution before commitment. The Board directs Sales to re-engage ${client} with revised terms. The Board issues a conditional ruling.\n[VERDICT: NEGOTIATE]`,
      2: `The Board has considered the revised proposal for "${project}". The counter-offer addresses the core financial and compliance concerns, and the phased delivery model reduces technical risk to an acceptable level. Subject to execution of the formal amendment and compliance sign-offs, the Board approves advancing this engagement.\n[VERDICT: NEGOTIATE]`,
      3: `The Board has completed a full two-round review of "${project}" with ${client}. The renegotiation produced a viable revised framework satisfying Financial, Legal, and Technical requirements. Conditional approval is granted, pending execution of the revised SOW and compliance documentation. The Board issues its final ruling.\n[VERDICT: NEGOTIATE]`
    }
  };

  const agentResponses = map[agentName];
  if (!agentResponses) return `Assessment of "${project}" complete. My evaluation has been submitted to the boardroom record.`;
  return agentResponses[round] || agentResponses[1];
};

// ─── Gemini call with retry-then-fallback ────────────────────────────────────

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const callGemini = async (agentName, contextPrompt, session, employees, debateHistory) => {
  const apiKey = process.env.GEMINI_API_KEY;

  const configs = getConfigs();
  const agentConfig = configs[agentName] || {};
  let systemInstruction = AGENT_PERSONAS[agentName];

  if (agentConfig.customDirectives) {
    systemInstruction += `\n\nCUSTOM OPERATIONAL DIRECTIVES:\n${agentConfig.customDirectives}`;
  }

  if (agentName === 'Account Executive') {
    systemInstruction += `\nCaution Level: ${agentConfig.slider1}%. Aggressiveness Level: ${agentConfig.slider2}%.`;
  } else if (agentName === 'Legal') {
    systemInstruction += `\nStrict Adherence: ${agentConfig.slider1}%. Zero Tolerance: ${agentConfig.slider2}%.`;
  } else if (agentName === 'Resource') {
    systemInstruction += `\nConservative Estimation: ${agentConfig.slider1}%. Proven Tech Preference: ${agentConfig.slider2}%.`;
  } else if (agentName === 'Financial') {
    systemInstruction += `\nMargin Protection: ${agentConfig.slider1}%. Fixed Costs Preference: ${agentConfig.slider2}%.`;
  } else if (agentName === 'Board of Directors') {
    systemInstruction += `\nDefensive Strategy: ${agentConfig.slider1}%. Minimize Exposure: ${agentConfig.slider2}%.`;
  }

  if (apiKey) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: systemInstruction
      });
      const result = await model.generateContent(contextPrompt);
      return { text: result.response.text().trim(), source: 'gemini' };
    } catch (err) {
      const is429 = err.message && (err.message.includes('429') || err.message.includes('Too Many Requests'));

      if (is429) {
        const retryMatch = err.message.match(/"retryDelay":\s*"(\d+)s"/);
        const retryDelaySec = retryMatch ? parseInt(retryMatch[1]) : 0;

        if (retryDelaySec > 0 && retryDelaySec <= 60) {
          console.log(`[Gemini] Rate limited for ${agentName}. Retrying in ${retryDelaySec}s...`);
          await sleep(retryDelaySec * 1000 + 500);

          try {
            const genAI2 = new GoogleGenerativeAI(apiKey);
            const model2 = genAI2.getGenerativeModel({
              model: 'gemini-2.0-flash',
              systemInstruction: systemInstruction
            });
            const result2 = await model2.generateContent(contextPrompt);
            return { text: result2.response.text().trim(), source: 'gemini' };
          } catch (retryErr) {
            console.warn(`[Gemini] Retry failed for ${agentName} — switching to fallback. Reason: ${retryErr.message.slice(0, 80)}`);
          }
        } else {
          console.warn(`[Gemini] Daily quota exhausted for ${agentName} — using fallback response.`);
        }
      } else {
        console.error(`[Gemini] Non-quota error for ${agentName}:`, err.message);
      }
    }
  }

  return { text: buildFallback(agentName, session, employees, debateHistory), source: 'fallback' };
};

// ─── Context prompt builder ──────────────────────────────────────────────────

// Workload label from active project count
const workloadLabel = (count) => {
  if (count === 0) return 'Fully available';
  if (count === 1) return 'Partial capacity (1 active project)';
  return `High load (${count} active projects)`;
};

const buildContext = (session, roster, employees, debateHistory, extraNote, missionBriefing) => {
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

  return `TENDER DETAILS:
- Project: ${session.tender_name}
- Client: ${session.client_name}
- Budget: $${budget.toLocaleString()}
- Timeline: ${months} months
- Industry: ${session.industry}
- Agents: ${roster.join(', ')}
- Estimated team size: ~${estimatedDevs} developers (budget ÷ $14k/dev/month)
  IMPORTANT: Evaluate whether ${estimatedDevs} suitable developers are available — do NOT staff the entire bench.

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

const runDebateAsync = async (session, roster, emitter, pool, missionBriefing = null) => {
  const sessionId = session.id;
  const employees = await getEmployeesFromDB(pool, parseInt(session.timeline_months) || 6);
  const debateHistory = [];

  const emit = (event, data) => emitter.emit(`${event}:${sessionId}`, data);

  const runAgent = async (agentName, round, extraNote = '') => {
    emit('typing', { sender: agentName });

    const contextPrompt = buildContext(session, roster, employees, debateHistory, extraNote, missionBriefing);
    const { text: messageText } = await callGemini(agentName, contextPrompt, session, employees, debateHistory);

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
                    lower.includes('continuity risk') || lower.includes('experience gap');
      agentFlags['Technical Architect'] = techFlagged ? 'conditional' : 'approved';
    }

    let riskFlagged = false;
    if (roster.includes('Risk Analyst')) {
      const riskMsg = await runAgent('Risk Analyst', 1);
      const lower = riskMsg.toLowerCase();
      riskFlagged = lower.includes('high') || lower.includes('critical') ||
                    lower.includes('red flag') || lower.includes('strongly recommend') ||
                    lower.includes('renegotiat') || lower.includes('unacceptable');
      agentFlags['Risk Analyst'] = riskFlagged ? 'conditional' : 'approved';
    }

    let opsConcern = false;
    if (roster.includes('Operations Manager')) {
      const opsMsg = await runAgent('Operations Manager', 1);
      const lower = opsMsg.toLowerCase();
      opsConcern = lower.includes('cannot execute') || lower.includes('execution gap') ||
                   lower.includes('not executable') || lower.includes('operationally unsound');
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
                     lower.includes('no certified') || lower.includes('baa');
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
                       lower.includes('cannot cover') || lower.includes('renegotiat');
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

      if (roster.includes('Account Executive')) {
        await runAgent('Account Executive', 2,
          `Concerns raised: ${issues.join('; ')}. Propose a concrete counter-offer and revised terms.`);
        agentFlags['Account Executive'] = 'approved';
      }

      if (financeFlagged && roster.includes('Financial')) {
        await runAgent('Financial', 2,
          'Account Executive proposed revised terms. Does the counter-offer resolve the financial concern?');
        agentFlags['Financial'] = 'conditional';
      }

      if (legalFlagged && roster.includes('Legal')) {
        await runAgent('Legal', 2,
          'Account Executive proposed compliance remediation. Are these measures sufficient?');
        agentFlags['Legal'] = 'conditional';
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
    console.error(`Debate engine error (session ${sessionId}):`, err.message);
    emit('error', { error: err.message || 'Debate engine encountered an error' });
    if (pool) {
      pool.query('UPDATE evaluation_sessions SET final_verdict = $1 WHERE id = $2', ['ERROR', sessionId])
        .catch(() => {});
    }
  }
};

module.exports = { runDebateAsync };
