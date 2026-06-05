'use strict';
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const getEmployees = () => {
  try {
    const dataPath = path.join(__dirname, '../data/dummy_employees.json');
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (err) {
    console.error('Failed to read dummy employees:', err.message);
    return [];
  }
};

const AGENT_PERSONAS = {
  'Account Executive': `You are the Account Executive (Sales Representative) in a high-stakes corporate boardroom tender evaluation meeting.
Your role is to champion this project and advocate strongly for a GO decision. Be enthusiastic, strategic, and opportunity-focused.
Reference specific details: client name, budget, timeline, and industry sector.
Respond in 2-4 concise sentences.`,

  'Resource': `You are the Resource Manager in a corporate boardroom tender evaluation meeting.
Your role is to assess developer bench availability, skill gaps, and staffing feasibility for this project scope.
Be practical and data-driven. Reference the available staff list and HIPAA certifications where relevant.
Respond in 2-4 concise sentences.`,

  'Legal': `You are the Legal Compliance Officer in a corporate boardroom tender evaluation meeting.
Your role is to identify regulatory obligations, compliance requirements (HIPAA for Healthcare, GDPR, SOC2, etc.), and contractual risk exposure.
Be thorough and precise. Explicitly flag any compliance gaps that could block the project.
Respond in 2-4 concise sentences.`,

  'Financial': `You are the Chief Financial Officer (CFO) in a corporate boardroom tender evaluation meeting.
Your role is to evaluate budget viability, profit margins, cost structures, and financial risk.
Standard developer cost is approximately $12,000–15,000 per developer per month.
If the proposed budget does not cover staffing costs plus a reasonable margin, say so clearly.
Respond in 2-4 concise sentences.`,

  'Board of Directors': `You are the Chairman of the Board of Directors delivering the FINAL binding verdict on this project tender evaluation.
Review all agent positions from the transcript and issue a clear, authoritative decision.
Your response MUST end with exactly one of these verdict tags on its own line:
[VERDICT: GO]
[VERDICT: NEGOTIATE]
[VERDICT: NO-GO]

Definitions:
- GO: Project approved as-is — all concerns resolved.
- NEGOTIATE: Project viable but requires renegotiated terms (budget increase, timeline extension, or compliance remediation).
- NO-GO: Project rejected — risks too severe or unresolved.

Respond in 3-5 sentences then the verdict tag.`
};

const callGemini = async (agentName, contextPrompt) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in environment');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: AGENT_PERSONAS[agentName]
  });

  const result = await model.generateContent(contextPrompt);
  return result.response.text().trim();
};

const buildContext = (session, roster, employees, debateHistory, extraNote) => {
  const availableDevs = employees.filter(e => e.available);
  const hipaaDevs = employees.filter(e => e.hipaa_certified && e.available);

  const historyText = debateHistory.length > 0
    ? debateHistory.map(m => `[${m.sender}] (Round ${m.negotiation_round}): ${m.message_text}`).join('\n\n')
    : 'You are opening the boardroom debate.';

  return `TENDER DETAILS:
- Project Name: ${session.tender_name}
- Client: ${session.client_name}
- Proposed Budget: $${Number(session.budget).toLocaleString()}
- Timeline: ${session.timeline_months} months
- Industry: ${session.industry}
- Agents in Attendance: ${roster.join(', ')}

AVAILABLE BENCH STAFF:
${availableDevs.map(e => `  - ${e.name} | ${e.role} | HIPAA Certified: ${e.hipaa_certified ? 'YES' : 'NO'}`).join('\n')}
Total available: ${availableDevs.length} | HIPAA-certified & available: ${hipaaDevs.length}

BOARDROOM TRANSCRIPT SO FAR:
${historyText}
${extraNote ? `\nSITUATION NOTE: ${extraNote}` : ''}

Provide your assessment now:`;
};

const runDebateAsync = async (session, roster, emitter, pool) => {
  const sessionId = session.id;
  const employees = getEmployees();
  const debateHistory = [];

  const emit = (event, data) => emitter.emit(`${event}:${sessionId}`, data);

  const runAgent = async (agentName, round, extraNote = '') => {
    emit('typing', { sender: agentName });

    const contextPrompt = buildContext(session, roster, employees, debateHistory, extraNote);
    const messageText = await callGemini(agentName, contextPrompt);

    const msg = { sender: agentName, message_text: messageText, negotiation_round: round };
    debateHistory.push(msg);

    if (pool) {
      try {
        await pool.query(
          'INSERT INTO debate_messages (session_id, sender, message_text, negotiation_round) VALUES ($1, $2, $3, $4)',
          [sessionId, agentName, messageText, round]
        );
      } catch (dbErr) {
        console.error(`DB save error for agent ${agentName}:`, dbErr.message);
      }
    }

    emit('message', msg);
    return messageText;
  };

  try {
    // === ROUND 1: Initial Presentations ===
    await runAgent('Account Executive', 1);

    if (roster.includes('Resource')) {
      await runAgent('Resource', 1);
    }

    let legalFlagged = false;
    if (roster.includes('Legal')) {
      const legalMsg = await runAgent('Legal', 1);
      const lower = legalMsg.toLowerCase();
      legalFlagged = lower.includes('warning') || lower.includes('risk') ||
                     lower.includes('violation') || lower.includes('non-compliant') ||
                     lower.includes('cannot approve') || lower.includes('flag');
    }

    let financeFlagged = false;
    if (roster.includes('Financial')) {
      const financeMsg = await runAgent('Financial', 1);
      const lower = financeMsg.toLowerCase();
      financeFlagged = lower.includes('negative') || lower.includes('deficit') ||
                       lower.includes('too low') || lower.includes('insufficient') ||
                       lower.includes('unviable') || lower.includes('loss') ||
                       lower.includes('cannot support') || lower.includes('shortfall');
    }

    // === ROUND 2: Renegotiation (if issues were raised) ===
    if (financeFlagged || legalFlagged) {
      const issues = [];
      if (financeFlagged) issues.push('the proposed budget has been flagged as financially unviable');
      if (legalFlagged) issues.push('there are unresolved regulatory compliance concerns');

      await runAgent(
        'Account Executive',
        2,
        `Serious concerns have been raised: ${issues.join(' and ')}. Propose a concrete counter-offer and revised project terms to address these issues.`
      );

      if (financeFlagged && roster.includes('Financial')) {
        await runAgent(
          'Financial',
          2,
          'The Account Executive has proposed revised terms. Evaluate whether this counter-offer resolves the financial viability concern.'
        );
      }

      if (legalFlagged && roster.includes('Legal')) {
        await runAgent(
          'Legal',
          2,
          'The Account Executive has proposed compliance remediation measures. Assess whether these sufficiently address the regulatory concerns.'
        );
      }
    }

    // === ROUND 3: Board of Directors Final Verdict ===
    const boardRound = (financeFlagged || legalFlagged) ? 3 : 2;
    const boardMsg = await runAgent(
      'Board of Directors',
      boardRound,
      'All agents have presented their positions. Deliver the final binding verdict for this tender.'
    );

    // Parse verdict from board message
    let verdict = 'GO';
    if (boardMsg.includes('[VERDICT: NO-GO]') || /\bno.go\b/i.test(boardMsg)) {
      verdict = 'NO-GO';
    } else if (boardMsg.includes('[VERDICT: NEGOTIATE]') || /\bnegotiate\b/i.test(boardMsg)) {
      verdict = 'NEGOTIATE';
    }

    const currentBudget = parseFloat(session.budget);
    const finalBudget = verdict === 'NEGOTIATE' ? Math.round(currentBudget * 1.25) : currentBudget;

    // Persist final verdict to DB
    let updatedSession = { ...session, final_verdict: verdict, final_budget: finalBudget };
    if (pool) {
      try {
        const result = await pool.query(
          'UPDATE evaluation_sessions SET final_verdict = $1, final_budget = $2 WHERE id = $3 RETURNING *',
          [verdict, finalBudget, sessionId]
        );
        if (result.rows.length > 0) updatedSession = result.rows[0];
      } catch (dbErr) {
        console.error('Failed to persist final verdict:', dbErr.message);
      }
    }

    emit('done', updatedSession);

  } catch (err) {
    console.error(`Debate engine error for session ${sessionId}:`, err.message);
    emit('error', { error: err.message || 'AI debate engine encountered an error' });

    if (pool) {
      pool.query('UPDATE evaluation_sessions SET final_verdict = $1 WHERE id = $2', ['ERROR', sessionId])
        .catch(dbErr => console.error('Failed to mark session as ERROR:', dbErr.message));
    }
  }
};

module.exports = { runDebateAsync };
