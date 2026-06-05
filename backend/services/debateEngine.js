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

// Live DB query — employees + tech stacks + current/future project assignments
const getEmployeesFromDB = async (pool) => {
  if (!pool) return getEmployeesJSON();
  try {
    const result = await pool.query(`
      SELECT
        e.id, e.name, e.designation,
        COALESCE(ARRAY_AGG(DISTINCT ts.name) FILTER (WHERE ts.name IS NOT NULL), '{}') AS tech_stacks,
        COALESCE(ARRAY_AGG(DISTINCT p.name) FILTER (WHERE ep.project_type = 'current'  AND p.name IS NOT NULL), '{}') AS current_projects,
        COALESCE(ARRAY_AGG(DISTINCT p.name) FILTER (WHERE ep.project_type = 'future'   AND p.name IS NOT NULL), '{}') AS future_projects
      FROM employees e
      LEFT JOIN employee_techstacks ets ON ets.employee_id = e.id
      LEFT JOIN techstacks ts           ON ts.id = ets.techstack_id
      LEFT JOIN employee_projects ep    ON ep.employee_id = e.id
      LEFT JOIN projects p              ON p.id = ep.project_id
      GROUP BY e.id, e.name, e.designation
      ORDER BY e.name
    `);

    if (result.rows.length === 0) return getEmployeesJSON();

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      designation: row.designation,
      role: row.designation,                    // compat with fallback helpers
      tech_stacks: row.tech_stacks || [],
      current_projects: row.current_projects || [],
      future_projects: row.future_projects || [],
      available: (row.current_projects || []).length === 0,
      hipaa_certified: (row.tech_stacks || []).some(s => /hipaa/i.test(s)),
    }));
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
Assess developer bench availability, skill coverage, HIPAA certifications, and staffing feasibility.
Be data-driven. Reference specific staff from the available list. Respond in 2-4 concise sentences.`,

  'Technical Architect': `You are the Senior Technical Architect in a corporate boardroom tender evaluation.
Assess technical feasibility, architecture complexity, stack requirements, integration risks, and timeline realism.
Flag any delivery blockers or architecture red flags. Respond in 2-4 concise sentences.`,

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

  const map = {
    'Account Executive': {
      1: `The opportunity from ${client} for "${project}" is exactly the strategic account we've been targeting in the ${session.industry} sector. Their proposed $${budget.toLocaleString()} investment over ${months} months aligns well with our current go-to-market focus. I'm confident in our ability to deliver and strongly advocate for a GO — we cannot afford to let this slip to a competitor.`,
      2: `I hear the concerns raised by Finance, Legal, and Architecture — and I'm already in dialogue with ${client} to address them. I propose a revised budget of $${Math.round(budget * 1.22).toLocaleString()} with a phased delivery model: Phase 1 at ${Math.ceil(months * 0.6)} months for MVP, Phase 2 for full rollout. This structure de-risks delivery while securing the engagement. Can the team approve this revised framework?`
    },
    'Resource': {
      1: availableDevs.length >= neededDevs
        ? `Bench review complete for "${project}". We have ${availableDevs.length} developers available, and I'm proposing an allocation of ${neededDevs}: ${availableDevs.slice(0, neededDevs).map(d => `${d.name} (${d.role})`).join(', ')}. ${isHealthcare ? `${hipaaDevs.length} are HIPAA-certified, which satisfies the healthcare compliance requirement.` : 'Staffing is cleared for immediate onboarding.'}`
        : `Bench review for "${project}" reveals a staffing gap. We need ${neededDevs} developers but only ${availableDevs.length} are currently available. I recommend either extending the timeline to ${Math.ceil(months * 1.3)} months or engaging a sub-contractor to fill the ${neededDevs - availableDevs.length} shortfall roles. This is a risk we must resolve before committing.`,
      2: `Following the Account Executive's revised proposal, I've re-examined our staffing model under the phased delivery structure. With Phase 1 scoped at a reduced team of ${Math.max(2, neededDevs - 1)}, we can proceed within current bench capacity. I'm prepared to approve staffing for the revised plan.`
    },
    'Technical Architect': {
      1: viable
        ? `Technical review of "${project}" is complete. The ${months}-month timeline is achievable with a well-structured sprint cadence — I recommend a 2-week discovery sprint upfront to finalize architecture blueprints. No exotic technology dependencies identified; standard ${isHealthcare ? 'HIPAA-compliant cloud architecture' : isFinance ? 'PCI-DSS certified infrastructure' : 'microservices stack'} applies. Technical risk is LOW.`
        : `"${project}" raises a technical delivery concern: the ${months}-month window is aggressive for a project of this complexity and scope. Based on typical ${session.industry} implementations, I estimate a realistic timeline of ${Math.ceil(months * 1.3)}–${Math.ceil(months * 1.5)} months or a significantly reduced MVP scope. I'm flagging this as a HIGH delivery risk at current parameters and recommend renegotiation.`,
      2: `Under the Account Executive's revised phased model, the technical risk drops significantly. Phase 1 as an MVP is architecturally sound — we focus on core modules and defer integrations to Phase 2. I can approve the revised delivery structure from a technical standpoint, provided we have a formal architecture review checkpoint at the end of Phase 1.`
    },
    'Legal': {
      1: isHealthcare
        ? `"${project}" operates in a HIPAA-regulated environment — this is non-negotiable. All developers assigned must hold active HIPAA certification, and we require a signed Business Associate Agreement (BAA) from ${client} prior to any data access. ${hipaaDevs.length > 0 ? `We have ${hipaaDevs.length} certified developers available (${hipaaDevs.map(d => d.name).join(', ')}), so compliance is achievable, but contractual protections must be in place before go-live.` : `Currently, none of our available bench developers are HIPAA-certified — this is a blocking compliance risk that must be resolved.`}`
        : isFinance
        ? `"${project}" triggers PCI-DSS Level 1 and SOC 2 Type II obligations as a Financial Services engagement. All infrastructure must be certified and all code subject to independent security audits before production deployment. I recommend building compliance costs (~$15,000) into the contract and including a liability cap clause. Legal can approve subject to these contractual conditions.`
        : `Legal review of "${project}" is complete. Standard commercial IP terms apply — no elevated regulatory exposure detected. I recommend including a robust change-order process, IP ownership clauses, and a data-processing addendum. No compliance blockers identified. Cleared for GO from a legal standpoint.`,
      2: `The Account Executive's revised proposal adequately addresses my primary concerns. Subject to the following conditions: (1) BAA signed before data ingestion, (2) all certified resources formally assigned in the SOW, and (3) a compliance audit milestone included in the delivery plan — Legal will withdraw its objection and approve the revised engagement.`
    },
    'Financial': {
      1: viable
        ? `Financial analysis complete for "${project}". Staffing ${neededDevs} developers at standard bench rates for ${months} months projects a total cost of approximately $${estimatedCost.toLocaleString()}, against the proposed budget of $${budget.toLocaleString()}. This yields a projected gross margin of ${margin}% — within our acceptable range. I support proceeding.`
        : `The financial case for "${project}" is currently untenable. Staffing ${neededDevs} qualified developers for ${months} months at standard rates totals $${estimatedCost.toLocaleString()}, which exceeds ${client}'s proposed budget of $${budget.toLocaleString()} by $${(estimatedCost - budget).toLocaleString()}. We cannot absorb a negative-margin engagement. I am flagging this as a financial blocker and recommending renegotiation.`,
      2: `If the Account Executive can secure a revised budget of $${Math.round(budget * 1.22).toLocaleString()} from ${client}, the margin recovers to approximately ${Math.round((((budget * 1.22) - estimatedCost) / (budget * 1.22)) * 100)}% — acceptable under our standard risk parameters. Provided the client amendment is signed before mobilization, I will withdraw my financial objection.`
    },
    'Risk Analyst': {
      1: viable
        ? `Risk assessment for "${project}" is complete. Primary risks identified: scope creep in ${session.industry} environments (~35% probability), key-person dependency on ${availableDevs[0] ? availableDevs[0].name : 'lead architect'}, and ${isHealthcare ? 'HIPAA audit delays' : isFinance ? 'PCI-DSS certification timeline' : 'third-party API integration delays'}. Overall risk tier: MEDIUM. Recommended mitigations: weekly risk register reviews, a 10% contingency buffer, and a formal escalation matrix.`
        : `Risk assessment for "${project}" raises a RED FLAG. The combination of an under-resourced budget, tight timeline, and ${isHealthcare ? 'HIPAA regulatory obligations' : isFinance ? 'PCI-DSS compliance requirements' : 'complex integration requirements'} creates a HIGH delivery risk profile. Probability of on-time, on-budget delivery at current parameters: approximately 40%. I strongly recommend renegotiating terms before commitment to reduce tail risk.`,
      2: `Under the revised phased delivery model proposed by the Account Executive, the risk profile improves materially. Phase-gated delivery reduces exposure from HIGH to MEDIUM. Provided risk checkpoints are embedded at each phase boundary and a contingency reserve of 10% is contractually allocated, I can revise my risk rating to ACCEPTABLE for the revised engagement structure.`
    },
    'Operations Manager': {
      1: `Operations review of "${project}" is complete. A ${months}-month project of this scale requires ${isHealthcare ? 'a HIPAA-aware Agile framework with biweekly compliance checkpoints' : 'a standard Agile sprint cadence with 2-week sprints'}. ${availableDevs.length >= neededDevs ? `Team onboarding can begin within 5–7 business days given current bench availability.` : `With current bench availability, onboarding will take 3–4 weeks, which compresses the delivery window.`} I recommend a formal kickoff workshop and a project charter sign-off before sprint 1.`,
      2: `The phased delivery structure proposed is operationally sound. Phase 1 MVP with a dedicated core team reduces coordination overhead significantly. I'll implement a structured RAID log (Risks, Assumptions, Issues, Dependencies) from Day 1 and establish weekly stakeholder reporting to ${client}. Operations can support the revised plan.`
    },
    'Board of Directors': {
      1: viable && (!isHealthcare || hipaaDevs.length > 0)
        ? `The Board has reviewed all departmental assessments for the "${project}" tender submitted by ${client}. All five departments — Sales, Resource, Technical Architecture, Legal, and Finance — have validated the project parameters within their respective remits. Risk exposure is within tolerance and strategic fit is confirmed. The Board issues its official verdict.\n[VERDICT: GO]`
        : `The Board has reviewed all departmental assessments for "${project}". While the strategic opportunity is acknowledged, ${viable ? 'compliance and delivery' : 'financial viability and delivery'} concerns raised by multiple departments require formal resolution before commitment can be made. The Board directs Sales to re-engage ${client} with revised terms addressing the flagged objections. The Board issues a conditional ruling.\n[VERDICT: NEGOTIATE]`,
      2: `The Board has considered the revised proposal presented during renegotiation for the "${project}" tender. The Account Executive's counter-offer addresses the core financial and compliance concerns, and the phased delivery model reduces technical risk to an acceptable level. Subject to execution of the formal amendment and compliance sign-offs, the Board approves advancing this engagement.\n[VERDICT: NEGOTIATE]`,
      3: `The Board has completed a full two-round review of the "${project}" tender with ${client}. The renegotiation round produced a viable revised framework that satisfies Financial, Legal, and Technical requirements. Conditional approval is granted, pending execution of the revised SOW and compliance documentation. The Board issues its final ruling.\n[VERDICT: NEGOTIATE]`
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

  // Also pass the slider values dynamically
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
        // Extract suggested retry delay from error message
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

  // Fallback: context-aware synthesized response
  return { text: buildFallback(agentName, session, employees, debateHistory), source: 'fallback' };
};

// ─── Context prompt builder ──────────────────────────────────────────────────

const buildContext = (session, roster, employees, debateHistory, extraNote, missionBriefing) => {
  const available = employees.filter(e => e.available);
  const engaged   = employees.filter(e => !e.available);
  const hipaaDevs = employees.filter(e => e.hipaa_certified && e.available);

  const fmtEmp = (e) => {
    const skills  = (e.tech_stacks || e.skills || []).join(', ') || 'N/A';
    const curr    = (e.current_projects || []).join(', ');
    const fut     = (e.future_projects  || []).join(', ');
    let line = `  - ${e.name} | ${e.role || e.designation} | Skills: ${skills}`;
    if (curr) line += ` | Active: ${curr}`;
    if (fut)  line += ` | Queued: ${fut}`;
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
- Estimated team size needed for this project: ~${estimatedDevs} developers (budget ÷ $14k/dev/month)
  IMPORTANT: Evaluate whether ${estimatedDevs} suitable developers are available — do NOT suggest staffing the entire bench.

EMPLOYEE ROSTER (${employees.length} total):
Available for new work (${available.length})${hipaaDevs.length ? ` — HIPAA-certified: ${hipaaDevs.length}` : ''}:
${available.length > 0 ? available.map(fmtEmp).join('\n') : '  (none available — all staff are currently engaged on active projects)'}

Currently engaged on active projects (${engaged.length}):
${engaged.length > 0 ? engaged.map(fmtEmp).join('\n') : '  (none engaged)'}

Tech stack coverage: ${allSkills.length > 0 ? allSkills.join(', ') : 'N/A'}

TRANSCRIPT:
${historyText}
${missionBriefing ? `\nMISSION BRIEFING FROM COMMAND: ${missionBriefing}` : ''}
${extraNote ? `\nNOTE: ${extraNote}` : ''}

Provide your assessment:`;
};

// ─── Main debate orchestrator ────────────────────────────────────────────────

const runDebateAsync = async (session, roster, emitter, pool, missionBriefing = null) => {
  const sessionId = session.id;
  const employees = await getEmployeesFromDB(pool);
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

  // Per-agent flag status — emitted with done event so frontend shows accurate badges
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
                        rL.includes('insufficient') || rL.includes('resolve before');
      agentFlags['Resource'] = resourceFlagged ? 'flagged' : 'approved';
    }

    // Technical Architect
    let techFlagged = false;
    if (roster.includes('Technical Architect')) {
      const techMsg = await runAgent('Technical Architect', 1);
      const lower = techMsg.toLowerCase();
      techFlagged = lower.includes('not feasible') || lower.includes('unrealistic') ||
                    lower.includes('blocker') || lower.includes('concern') ||
                    lower.includes('insufficient') || lower.includes('too short') ||
                    lower.includes('aggressive') || lower.includes('cannot') ||
                    lower.includes('flagging') || lower.includes('high delivery risk');
      agentFlags['Technical Architect'] = techFlagged ? 'conditional' : 'approved';
    }

    // Risk Analyst
    let riskFlagged = false;
    if (roster.includes('Risk Analyst')) {
      const riskMsg = await runAgent('Risk Analyst', 1);
      const lower = riskMsg.toLowerCase();
      riskFlagged = lower.includes('high') || lower.includes('critical') ||
                    lower.includes('red flag') || lower.includes('strongly recommend') ||
                    lower.includes('renegotiat') || lower.includes('unacceptable');
      agentFlags['Risk Analyst'] = riskFlagged ? 'conditional' : 'approved';
    }

    // Operations Manager
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
      if (resourceFlagged) issues.push('Resource Manager flagged insufficient available staff');
      if (financeFlagged) issues.push('budget flagged as financially unviable');
      if (legalFlagged) issues.push('unresolved regulatory compliance concerns');
      if (techFlagged) issues.push('Technical Architect raised feasibility/timeline concerns');
      if (riskFlagged) issues.push('Risk Analyst flagged HIGH or CRITICAL risk profile');

      if (roster.includes('Account Executive')) {
        await runAgent('Account Executive', 2,
          `Concerns raised: ${issues.join('; ')}. Propose a concrete counter-offer and revised terms.`);
        agentFlags['Account Executive'] = 'approved'; // AE always advocates
      }

      if (financeFlagged && roster.includes('Financial')) {
        await runAgent('Financial', 2,
          'Account Executive proposed revised terms. Does the counter-offer resolve the financial concern?');
        agentFlags['Financial'] = 'conditional'; // negotiated — conditions placed
      }

      if (legalFlagged && roster.includes('Legal')) {
        await runAgent('Legal', 2,
          'Account Executive proposed compliance remediation. Are these measures sufficient?');
        agentFlags['Legal'] = 'conditional'; // conditions placed but not hard-blocked
      }
    }

    // ── Final: Board of Directors verdict ───────────────────────────────────
    const boardRound = anyFlagged ? 3 : 2;
    const boardMsg = await runAgent('Board of Directors', boardRound,
      'All agents have presented. Deliver the final binding verdict.');

    let verdict = 'GO';
    if (boardMsg.includes('[VERDICT: NO-GO]') || /\bno.go\b/i.test(boardMsg)) verdict = 'NO-GO';
    else if (boardMsg.includes('[VERDICT: NEGOTIATE]') || /\bnegotiate\b/i.test(boardMsg)) verdict = 'NEGOTIATE';

    // If board says GO, all conditionals get cleared
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
