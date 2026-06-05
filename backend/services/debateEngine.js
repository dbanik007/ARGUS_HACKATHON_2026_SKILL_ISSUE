const fs = require('fs');
const path = require('path');

// Helper to read dummy employees
const getEmployees = () => {
  try {
    const dataPath = path.join(__dirname, '../data/dummy_employees.json');
    const rawData = fs.readFileSync(dataPath, 'utf8');
    return JSON.parse(rawData);
  } catch (err) {
    console.error('Failed to read dummy employees:', err);
    return [];
  }
};

const runDebate = (session, roster) => {
  const employees = getEmployees();
  const messages = [];
  let currentBudget = parseFloat(session.budget);
  let currentTimeline = parseInt(session.timeline_months);
  let finalVerdict = 'GO';
  let finalBudget = currentBudget;

  const isSelected = (agentName) => roster.includes(agentName);

  // --- Step 1: Resource Evaluation ---
  const availableDevs = employees.filter(e => e.available);
  const hipaaCertifiedDevs = employees.filter(e => e.hipaa_certified && e.available);
  const neededDevsCount = Math.max(2, Math.ceil(currentBudget / 30000)); // basic capacity heuristic

  // --- Step 2: Financial Calculation ---
  // Standard dev cost is $12,000/month per developer
  const devRate = 12000;
  const estimatedCost = neededDevsCount * currentTimeline * devRate;

  // --- Round 1: Initial Presentation ---

  // 1. Account Executive (Sales)
  messages.push({
    sender: 'Account Executive',
    negotiation_round: 1,
    message_text: `Team, we have a fantastic opportunity from ${session.client_name} for the project "${session.tender_name}". They have proposed a budget of $${currentBudget.toLocaleString()} and a timeline of ${currentTimeline} months. This is a strategic account in the ${session.industry} space. I strongly push for a 'GO' verdict here to secure market share and build our portfolio!`
  });

  // 2. Resource Agent
  if (isSelected('Resource')) {
    let resourceMsg = '';
    if (availableDevs.length < neededDevsCount) {
      resourceMsg = `I have completed a bench capacity audit. We require at least ${neededDevsCount} developers for a project of this scale, but only ${availableDevs.length} developers are currently on the bench. We will experience a developer shortfall.`;
    } else {
      const staffList = availableDevs.slice(0, neededDevsCount).map(d => `${d.name} (${d.role})`).join(', ');
      resourceMsg = `I have audited our bench capacity. We have sufficient developers available to start immediately. I propose allocating the following team: ${staffList}. Ready to initiate onboarding.`;
    }
    messages.push({
      sender: 'Resource',
      negotiation_round: 1,
      message_text: resourceMsg
    });
  }

  // 3. Legal Agent
  let complianceRisk = false;
  if (isSelected('Legal')) {
    let legalMsg = '';
    if (session.industry.toLowerCase() === 'healthcare' || session.industry.toLowerCase() === 'medical') {
      if (hipaaCertifiedDevs.length === 0) {
        complianceRisk = true;
        legalMsg = `WARNING: Since "${session.tender_name}" is in the Healthcare sector, we are subject to strict HIPAA regulations. None of our currently available bench developers hold active HIPAA certification. Assigning non-certified staff presents severe regulatory compliance risks.`;
      } else {
        legalMsg = `I have completed the regulatory review. As a Healthcare project, HIPAA compliance is mandatory. Fortunately, we have certified staff on the bench: ${hipaaCertifiedDevs.map(d => d.name).join(', ')}. Assignment is approved from a compliance standpoint.`;
      }
    } else {
      legalMsg = `Legal review complete. The project falls under standard commercial terms. No high-risk compliance parameters detected.`;
    }
    messages.push({
      sender: 'Legal',
      negotiation_round: 1,
      message_text: legalMsg
    });
  }

  // 4. Financial Agent
  if (isSelected('Financial')) {
    let financeMsg = '';
    if (currentBudget < estimatedCost) {
      financeMsg = `Hold on, the numbers do not add up. The estimated cost for staffing ${neededDevsCount} developers for ${currentTimeline} months at standard bench rates is $${estimatedCost.toLocaleString()}. The proposed budget of $${currentBudget.toLocaleString()} leaves us with a negative margin. I must flag this as a financial risk.`;
    } else {
      const margin = ((currentBudget - estimatedCost) / currentBudget * 100).toFixed(1);
      financeMsg = `Financial analysis complete. Staffing cost is estimated at $${estimatedCost.toLocaleString()}, leaving us with a solid projected profit margin of ${margin}%. I support proceeding.`;
    }
    messages.push({
      sender: 'Financial',
      negotiation_round: 1,
      message_text: financeMsg
    });
  }

  // --- Round 2: Renegotiation / Escalation Loop ---
  let renegotiated = false;
  if ((isSelected('Financial') && currentBudget < estimatedCost) || (isSelected('Legal') && complianceRisk)) {
    renegotiated = true;

    // Sales reacts to the objections
    let salesCounter = 'I understand the concerns. ';
    if (isSelected('Financial') && currentBudget < estimatedCost) {
      finalBudget = estimatedCost * 1.15; // Propose cost + 15% margin
      salesCounter += `To address the financial deficit, I will go back to ${session.client_name} and request a budget increase to $${Math.round(finalBudget).toLocaleString()} to cover full delivery costs and preserve margin. `;
    }
    if (isSelected('Legal') && complianceRisk) {
      salesCounter += `Additionally, to satisfy Legal requirements, we will fast-track HIPAA certification for our Lead Architect or sub-contract a certified consultant. `;
    }
    messages.push({
      sender: 'Account Executive',
      negotiation_round: 2,
      message_text: salesCounter + `Can the team approve this revised structure?`
    });

    // Finance responds to the budget counter-offer
    if (isSelected('Financial')) {
      messages.push({
        sender: 'Financial',
        negotiation_round: 2,
        message_text: `With the budget raised to $${Math.round(finalBudget).toLocaleString()}, we recover a positive margin. Provided the client signs the amendment, I will withdraw my objection.`
      });
    }

    // Legal responds to certification plan
    if (isSelected('Legal') && complianceRisk) {
      messages.push({
        sender: 'Legal',
        negotiation_round: 2,
        message_text: `Fast-tracking HIPAA certification or onboarding a certified contractor resolves the liability. I can approve under these conditions.`
      });
    }
  }

  // --- Round 3: Board of Directors Decision ---
  let boardVerdict = 'GO';
  let boardReasoning = '';

  if (renegotiated) {
    boardVerdict = 'NEGOTIATE';
    boardReasoning = `The Board has reviewed the objections. While the initial tender was financially unviable, the Sales team's renegotiation plan secures a path forward. We authorize a NEGOTIATE decision. Sales is instructed to return to ${session.client_name} with a counter-offer of $${Math.round(finalBudget).toLocaleString()}.`;
  } else {
    // Check if critical items are unaddressed
    const hasUnresolvedCompliance = isSelected('Legal') && complianceRisk;
    const hasUnresolvedFinance = isSelected('Financial') && currentBudget < estimatedCost;

    if (hasUnresolvedCompliance || hasUnresolvedFinance) {
      boardVerdict = 'NO-GO';
      boardReasoning = `The Board of Directors has issued a final NO-GO. The project presents unresolved structural deficits, including compliance liabilities and negative profit margins, which have not been addressed by renegotiation.`;
    } else {
      boardVerdict = 'GO';
      boardReasoning = `The Board of Directors issues an official GO. All departments (Sales, Resource, Legal, and Finance) have completed audits and achieved consensus. The project parameters fit within standard risk tolerances.`;
    }
  }

  messages.push({
    sender: 'Board of Directors',
    negotiation_round: 3,
    message_text: boardReasoning
  });

  return {
    messages,
    verdict: boardVerdict,
    finalBudget: Math.round(finalBudget)
  };
};

module.exports = {
  runDebate
};
