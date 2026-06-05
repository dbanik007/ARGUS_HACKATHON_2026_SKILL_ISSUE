'use strict';
/**
 * Database seeder — run with: npm run seed
 * Idempotent: uses ON CONFLICT DO NOTHING / DO UPDATE throughout.
 * Seeds employees, projects, leaves, and completed evaluation sessions
 * pre-attached to all three mock login accounts.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/boardroom',
});

// ─── Data ────────────────────────────────────────────────────────────────────

const MOCK_USERS = [
  {
    google_id: 'mock-google-user-12345',
    email: 'boardroom.tester@example.com',
    name: 'Executive Boardroom Tester',
    picture: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=120',
  },
  {
    google_id: 'mock-google-sarah-00001',
    email: 'sarah.jenkins@example.com',
    name: 'Sarah Jenkins',
    picture: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=120',
  },
  {
    google_id: 'mock-google-alex-00002',
    email: 'alex.rivera@example.com',
    name: 'Alex Rivera',
    picture: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120',
  },
];

const TECH_STACKS = [
  'Angular', 'React', 'TypeScript', 'JavaScript', 'Node.js', 'Python', 'Java', 'Go',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch',
  'Docker', 'Kubernetes', 'Terraform', 'AWS', 'Azure', 'GCP',
  'GraphQL', 'REST', 'gRPC', 'Kafka', 'RabbitMQ',
  'HIPAA', 'SOC2', 'PCI-DSS', 'GDPR',
  'Playwright', 'Jest', 'Selenium', 'Cypress', 'CI/CD',
  'Flask', 'Django', 'Express', 'Spring Boot',
  'System Design', 'DevOps', 'Network Architecture', 'Cybersecurity',
  'Tailwind CSS', 'HTML5', 'CSS3',
];

const EMPLOYEES = [
  {
    name: 'Sarah Connor',
    designation: 'Lead Architect',
    email: 'sarah.connor@argusoft.in',
    date_of_joining: '2017-03-01',
    skills: ['System Design', 'Node.js', 'PostgreSQL', 'Docker', 'DevOps', 'AWS', 'HIPAA'],
    current_projects: [],
    past_projects: [
      { name: 'MediLink Portal', domain: 'Healthcare', complexity: 'high' },
      { name: 'SecureVault', domain: 'Cybersecurity', complexity: 'high' },
    ],
    leaves: [],
  },
  {
    name: 'David Miller',
    designation: 'Senior Frontend Developer',
    email: 'david.miller@argusoft.in',
    date_of_joining: '2020-07-15',
    skills: ['Angular', 'React', 'TypeScript', 'Tailwind CSS', 'HTML5', 'CSS3'],
    current_projects: [],
    past_projects: [
      { name: 'RetailX Dashboard', domain: 'E-Commerce', complexity: 'medium' },
    ],
    leaves: [
      { start_date: '2026-06-20', end_date: '2026-06-27', leave_type: 'planned' },
    ],
  },
  {
    name: 'Elena Rostova',
    designation: 'Fullstack Engineer',
    email: 'elena.rostova@argusoft.in',
    date_of_joining: '2019-01-10',
    skills: ['Node.js', 'Express', 'Angular', 'TypeScript', 'PostgreSQL', 'Redis', 'HIPAA'],
    current_projects: [
      { name: 'Nexus Health', domain: 'Healthcare', complexity: 'high' },
      { name: 'ClaimsBridge', domain: 'Financial Services', complexity: 'medium' },
    ],
    past_projects: [],
    leaves: [],
  },
  {
    name: 'Marcus Aurelius',
    designation: 'QA Automation Lead',
    email: 'marcus.aurelius@argusoft.in',
    date_of_joining: '2018-09-01',
    skills: ['Jest', 'Playwright', 'Selenium', 'Cypress', 'CI/CD', 'Python', 'HIPAA'],
    current_projects: [],
    past_projects: [
      { name: 'FinTrack Audit', domain: 'Financial Services', complexity: 'high' },
    ],
    leaves: [],
  },
  {
    name: 'Ada Lovelace',
    designation: 'Backend Specialist',
    email: 'ada.lovelace@argusoft.in',
    date_of_joining: '2021-04-01',
    skills: ['Node.js', 'Python', 'Flask', 'GraphQL', 'Redis', 'MongoDB', 'REST'],
    current_projects: [
      { name: 'LogiRoute', domain: 'Logistics', complexity: 'medium' },
    ],
    past_projects: [],
    leaves: [
      { start_date: '2026-07-01', end_date: '2026-07-15', leave_type: 'planned' },
    ],
  },
  {
    name: 'Linus Torvalds',
    designation: 'Security Compliance Lead',
    email: 'linus.torvalds@argusoft.in',
    date_of_joining: '2016-06-01',
    skills: ['Cybersecurity', 'Network Architecture', 'HIPAA', 'SOC2', 'PCI-DSS', 'GDPR', 'Terraform'],
    current_projects: [],
    past_projects: [
      { name: 'CipherCore', domain: 'Cybersecurity', complexity: 'high' },
      { name: 'ComplianceNet', domain: 'Healthcare', complexity: 'medium' },
    ],
    leaves: [],
  },
  {
    name: 'Priya Sharma',
    designation: 'Data Engineer',
    email: 'priya.sharma@argusoft.in',
    date_of_joining: '2022-02-14',
    skills: ['Python', 'PostgreSQL', 'Elasticsearch', 'Kafka', 'AWS', 'Docker'],
    current_projects: [
      { name: 'DataPulse Analytics', domain: 'E-Commerce', complexity: 'medium' },
    ],
    past_projects: [
      { name: 'LogiRoute', domain: 'Logistics', complexity: 'medium' },
    ],
    leaves: [],
  },
  {
    name: 'Rahul Mehta',
    designation: 'DevOps Engineer',
    email: 'rahul.mehta@argusoft.in',
    date_of_joining: '2020-11-01',
    skills: ['Docker', 'Kubernetes', 'Terraform', 'AWS', 'GCP', 'CI/CD', 'Python'],
    current_projects: [],
    past_projects: [
      { name: 'SecureVault', domain: 'Cybersecurity', complexity: 'high' },
      { name: 'MediLink Portal', domain: 'Healthcare', complexity: 'high' },
    ],
    leaves: [
      { start_date: '2026-08-10', end_date: '2026-08-20', leave_type: 'planned' },
    ],
  },
  {
    name: 'Ananya Das',
    designation: 'Full Stack Developer',
    email: 'ananya.das@argusoft.in',
    date_of_joining: '2023-06-01',
    skills: ['React', 'Node.js', 'PostgreSQL', 'REST', 'TypeScript', 'Jest'],
    current_projects: [],
    past_projects: [
      { name: 'RetailX Dashboard', domain: 'E-Commerce', complexity: 'medium' },
    ],
    leaves: [],
  },
  {
    name: 'Vikram Nair',
    designation: 'Java Backend Developer',
    email: 'vikram.nair@argusoft.in',
    date_of_joining: '2019-08-15',
    skills: ['Java', 'Spring Boot', 'PostgreSQL', 'Kafka', 'Docker', 'PCI-DSS', 'REST'],
    current_projects: [
      { name: 'ClaimsBridge', domain: 'Financial Services', complexity: 'medium' },
    ],
    past_projects: [
      { name: 'FinTrack Audit', domain: 'Financial Services', complexity: 'high' },
    ],
    leaves: [],
  },
  {
    name: 'Kavya Reddy',
    designation: 'ML Engineer',
    email: 'kavya.reddy@argusoft.in',
    date_of_joining: '2022-09-01',
    skills: ['Python', 'Flask', 'Django', 'PostgreSQL', 'AWS', 'Docker', 'REST'],
    current_projects: [],
    past_projects: [
      { name: 'DataPulse Analytics', domain: 'E-Commerce', complexity: 'medium' },
    ],
    leaves: [
      { start_date: '2026-09-05', end_date: '2026-09-12', leave_type: 'planned' },
    ],
  },
  {
    name: 'Arjun Pillai',
    designation: 'Cloud Solutions Architect',
    email: 'arjun.pillai@argusoft.in',
    date_of_joining: '2015-04-10',
    skills: ['AWS', 'Azure', 'GCP', 'Terraform', 'Kubernetes', 'System Design', 'Go', 'SOC2'],
    current_projects: [],
    past_projects: [
      { name: 'CipherCore', domain: 'Cybersecurity', complexity: 'high' },
      { name: 'Nexus Health', domain: 'Healthcare', complexity: 'high' },
    ],
    leaves: [],
  },
];

// Completed evaluation sessions — will be assigned to the mock users in round-robin
const EVAL_SESSIONS = [
  {
    tender_name: 'Next-Gen Medical Telemetry Suite',
    client_name: 'St. Jude Clinical Research',
    budget: 2800000,
    timeline_months: 18,
    industry: 'Healthcare',
    roster: ['Technical Architect', 'Risk Analyst', 'Operations Manager', 'Legal', 'Resource', 'Financial'],
    final_verdict: 'GO',
    final_budget: 2800000,
    messages: [
      { sender: 'Financial', text: 'St. Jude Clinical Research is a marquee Healthcare client and this ₹2.8M engagement is exactly the anchor deal we need to expand our medical vertical. The 18-month timeline is achievable and the budget comfortably covers a strong 4-person HIPAA-certified team. I strongly advocate for GO — our Healthcare track record makes us the natural choice here.', round: 1 },
      { sender: 'Resource', text: 'Bench review complete for this Healthcare engagement. I\'m nominating Sarah Connor (Lead Architect, 9 yrs exp, HIPAA-certified, fully available), Linus Torvalds (Security Compliance Lead, 10 yrs exp, HIPAA/SOC2/GDPR, no upcoming leaves), Marcus Aurelius (QA Lead, 7 yrs exp, HIPAA-certified), and Elena Rostova (Fullstack, 7 yrs exp, HIPAA-certified) — though Elena\'s current workload of 2 active projects is a flag. Backup coverage plan recommended for Elena.', round: 1 },
      { sender: 'Technical Architect', text: 'Technical feasibility confirmed. Sarah Connor and Linus Torvalds provide senior architectural and compliance coverage across an 18-month window — both free of leave conflicts. The HIPAA-compliant cloud architecture is standard for our Healthcare deliveries; no exotic integrations required. Technical risk tier: LOW. Proceed.', round: 1 },
      { sender: 'Risk Analyst', text: 'Risk assessment for the St. Jude telemetry project: primary risks are scope creep in Healthcare environments (~30% probability) and HIPAA audit timeline dependencies. Overall risk tier: MEDIUM. Mitigations: biweekly compliance checkpoints, 10% budget contingency, formal BAA signed pre-kickoff. Risk is within acceptable tolerance.', round: 1 },
      { sender: 'Operations Manager', text: 'Operationally sound. 18 months provides a comfortable delivery runway. Team onboarding can begin within 5 business days. I recommend HIPAA-aware Agile framework with biweekly compliance checkpoints. No execution gaps identified.', round: 1 },
      { sender: 'Legal', text: 'HIPAA compliance requirements are fully covered by our nominated team — 3 certified developers plus the Security Compliance Lead. BAA must be signed before any data access. Contractual IP and liability clauses are standard for this client type. Legal clears this engagement.', round: 1 },
      { sender: 'Financial', text: 'Financial analysis complete. Staffing 4 developers for 18 months at ₹13,000/month yields a total cost of ₹936,000, well within the ₹2.8M budget. Projected gross margin: 67% — excellent for a strategic Healthcare anchor account. I approve proceeding.', round: 1 },
      { sender: 'Board of Directors', text: 'The Board has reviewed all departmental assessments for the Next-Gen Medical Telemetry Suite tender. All six agents — Finance, Resource, Technical Architecture, Risk, Operations, and Legal — have validated project parameters within their respective remits. HIPAA staffing is confirmed, financial margins are strong, and strategic fit is clear. The Board issues its unanimous verdict.\n[VERDICT: GO]', round: 2 },
    ],
  },
  {
    tender_name: 'PCI-DSS Payment Gateway Overhaul',
    client_name: 'NovaPay Financial',
    budget: 950000,
    timeline_months: 9,
    industry: 'Financial Services',
    roster: ['Technical Architect', 'Risk Analyst', 'Operations Manager', 'Legal', 'Resource', 'Financial'],
    final_verdict: 'NEGOTIATE',
    final_budget: 1187500,
    messages: [
      { sender: 'Financial', text: 'NovaPay is a high-growth FinTech client with a critical infrastructure modernization need. The ₹950K budget over 9 months is tight for PCI-DSS scope, but the strategic value of this relationship — and their expected Series B funding — makes this a priority engagement. I advocate for GO with a revised budget conversation.', round: 1 },
      { sender: 'Resource', text: 'Staffing analysis reveals a gap. The ₹950K / 9-month window supports ~7 developers, but only 5 PCI-DSS capable developers are available without leave conflicts. Vikram Nair (Java/PCI-DSS, 6 yrs exp), Linus Torvalds (Security/PCI-DSS), and Marcus Aurelius (QA) can anchor. Ada Lovelace has a 15-day leave from July 1 — a risk if she\'s in the critical path during sprint 4–5. Staffing gap flagged.', round: 1 },
      { sender: 'Technical Architect', text: 'Technical concern: PCI-DSS Level 1 certification requires independent security audits and infrastructure scoping that typically adds 6–8 weeks to a 9-month project. The timeline is aggressive. Ada Lovelace\'s mid-project leave creates an API layer continuity risk. I\'m flagging this as HIGH delivery risk at current parameters.', round: 1 },
      { sender: 'Risk Analyst', text: 'HIGH risk profile. PCI-DSS compliance dependencies, aggressive timeline, and a mid-project leave gap for a key resource combine to create a ~55% on-time delivery probability. Strongly recommend renegotiating timeline to 12 months or budget uplift for an additional senior resource to cover the leave gap.', round: 1 },
      { sender: 'Operations Manager', text: 'Operationally, 9 months for a PCI-DSS overhaul at this scope is the outer limit of feasibility. Independent audit coordination will consume 4–6 weeks. I recommend embedding an audit milestone at month 6 as a contractual checkpoint.', round: 1 },
      { sender: 'Legal', text: 'PCI-DSS Level 1 and SOC 2 Type II obligations are triggered. All infrastructure must be certified and code subject to an independent QSA audit before production. Compliance costs should be built into the contract — approximately ₹20,000. Liability cap clause is mandatory. Legal approves subject to these contractual conditions.', round: 1 },
      { sender: 'Financial', text: 'The financial case is currently untenable. Staffing 7 qualified developers for 9 months costs approximately ₹819,000 — plus ₹20,000 PCI audit costs — leaving only ₹111,000 margin at 11.7%, below our 15% floor. I\'m flagging this as a financial blocker and recommending a budget uplift to ₹1.1M+.', round: 1 },
      { sender: 'Financial', text: 'Understood. I\'ve spoken with NovaPay\'s CFO and am proposing a revised budget of ₹1,187,500 — a 25% uplift — with a phased model: Phase 1 (PCI infrastructure hardening, months 1–6) and Phase 2 (full payment gateway cutover, months 7–12). This de-risks the audit timeline and covers the compliance contingency. Can the team support this revised framework?', round: 2 },
      { sender: 'Financial', text: 'The revised ₹1,187,500 budget restores margin to 27% after staffing and compliance costs. I withdraw my financial objection conditionally on the client executing the amendment before mobilization.', round: 2 },
      { sender: 'Legal', text: 'The revised terms are acceptable. PCI-DSS audit milestone embedded in Phase 1, liability cap clause confirmed, and compliance costs covered. Legal approves the revised engagement.', round: 2 },
      { sender: 'Board of Directors', text: 'The Board has reviewed the renegotiation round for the NovaPay PCI-DSS overhaul. While initial parameters failed Financial and Technical thresholds, the revised budget of ₹1,187,500 and phased delivery model resolve the core concerns. The Board approves advancing this engagement subject to client execution of the formal budget amendment and PCI audit milestone in the SOW.\n[VERDICT: NEGOTIATE]', round: 3 },
    ],
  },
  {
    tender_name: 'Omnichannel Retail Intelligence Platform',
    client_name: 'ShopSphere Global',
    budget: 1500000,
    timeline_months: 12,
    industry: 'E-Commerce',
    roster: ['Technical Architect', 'Risk Analyst', 'Operations Manager', 'Resource', 'Financial'],
    final_verdict: 'GO',
    final_budget: 1500000,
    messages: [
      { sender: 'Financial', text: 'ShopSphere Global is one of the fastest-growing E-Commerce platforms in the region. The ₹1.5M, 12-month engagement covers a full omnichannel intelligence stack — exactly our sweet spot. Domain match with our RetailX and DataPulse track record is strong. This is a GO.', round: 1 },
      { sender: 'Resource', text: 'Excellent bench fit for this E-Commerce engagement. Nominating: Ananya Das (Fullstack, 3 yrs, RetailX alumna), Priya Sharma (Data Engineer, 4 yrs, DataPulse alumna, currently on one project — manageable partial capacity), Kavya Reddy (ML Engineer, 4 yrs, DataPulse alumna), and David Miller (Frontend, 6 yrs, RetailX alumna — note 8-day leave June 20-27, early in project). Domain alignment across all four nominees is strong. Leave conflicts are minor and manageable within a 12-month window.', round: 1 },
      { sender: 'Technical Architect', text: 'Strong technical fit. The proposed team has direct E-Commerce domain experience from RetailX and DataPulse — non-functional requirements like product catalog scale, search performance, and cart concurrency are well-understood. David Miller\'s early leave is minor; sprint 1 can be planned around it. Technical risk: LOW.', round: 1 },
      { sender: 'Risk Analyst', text: 'Risk assessment: primary risks are third-party API integration delays (search, payment, logistics), scope creep in omnichannel feature set (~30% probability). Overall risk tier: MEDIUM. Mitigations: API integration spike in sprint 1, weekly risk register, 10% contingency buffer.', round: 1 },
      { sender: 'Operations Manager', text: '12 months with a 4-person team of domain-aligned developers is operationally sound. Agile sprint cadence with 2-week sprints recommended. Onboarding can begin within 5 days. No significant execution gaps identified.', round: 1 },
      { sender: 'Financial', text: 'Financial analysis complete. Staffing 4 developers for 12 months at ₹13,000/month yields ₹624,000 total cost against a ₹1.5M budget — a healthy 58% gross margin. I strongly approve proceeding.', round: 1 },
      { sender: 'Board of Directors', text: 'The Board has reviewed all assessments for the ShopSphere Global Omnichannel Platform tender. All five participating agents — Resource, Technical Architecture, Risk, Operations, and Finance — have validated the engagement. Domain alignment is exceptional, financial margins are strong, and delivery risk is low. The Board issues a unanimous verdict.\n[VERDICT: GO]', round: 2 },
    ],
  },
  {
    tender_name: 'Critical Infrastructure Threat Detection System',
    client_name: 'CyberShield Defense Corp',
    budget: 420000,
    timeline_months: 6,
    industry: 'Cybersecurity',
    roster: ['Technical Architect', 'Risk Analyst', 'Operations Manager', 'Legal', 'Resource', 'Financial'],
    final_verdict: 'NO-GO',
    final_budget: 420000,
    messages: [
      { sender: 'Financial', text: 'CyberShield is a prestigious defense-sector client and this ₹420K engagement would open the national security vertical for us. 6 months is tight but doable. I advocate for GO — the reputational upside alone justifies this.', round: 1 },
      { sender: 'Resource', text: 'Staffing review flags a critical gap. The ₹420K / 6-month window requires ~5 senior security engineers, but we only have Linus Torvalds (Security Lead) and Rahul Mehta (DevOps/Terraform) with relevant profiles — that\'s 2 out of a required 5. No other available staff hold cybersecurity or defense-sector domain experience. Cannot staff this engagement from current bench. This is a blocking staffing gap.', round: 1 },
      { sender: 'Technical Architect', text: 'Critical architecture concern: threat detection at national infrastructure scale demands real-time stream processing, sub-100ms alerting, and isolated security-cleared environments. Our current stack capability does not include the classified toolchain required for CyberShield\'s environment. 6 months is also half the realistic delivery window for this complexity. HIGH delivery risk — recommend rejection or a 12-month re-submission with sub-contractor strategy.', round: 1 },
      { sender: 'Risk Analyst', text: 'CRITICAL risk profile. Understaffed by 60%, timeline at half the viable minimum, and zero defense-sector delivery track record creates an unacceptable risk exposure. Probability of on-time delivery: ~20%. Reputational risk of a failed defense engagement outweighs any upside. Strongly recommend NO-GO.', round: 1 },
      { sender: 'Operations Manager', text: 'Operationally infeasible at current parameters. A 6-month window for this scope would require the entire security bench, leaving zero contingency staffing. Cannot execute without a sub-contractor onboarding plan that itself takes 4–6 weeks.', round: 1 },
      { sender: 'Legal', text: 'Defense sector engagements of this type may trigger ITAR and government security clearance obligations. None of our current staff hold the required clearances. This is a legal compliance blocker independent of the staffing issue.', round: 1 },
      { sender: 'Financial', text: 'Financially untenable. Staffing 5 senior security engineers for 6 months at ₹15,000/month (security premium rate) costs ₹450,000 — already exceeding the ₹420,000 budget before any overheads. This engagement has a guaranteed negative margin.', round: 1 },
      { sender: 'Board of Directors', text: 'The Board has reviewed all assessments for the CyberShield Defense Corp tender. Five out of five departments have flagged critical blockers: staffing gap at 60% below requirement, negative financial margin, ITAR legal obligation, and a timeline at half the viable minimum. Despite the strategic appeal of the defense vertical, the Board cannot approve an engagement with this risk profile. The Board issues its verdict.\n[VERDICT: NO-GO]', round: 2 },
    ],
  },
  {
    tender_name: 'Last-Mile Delivery Optimization Engine',
    client_name: 'FastTrack Logistics Ltd',
    budget: 680000,
    timeline_months: 8,
    industry: 'Logistics',
    roster: ['Technical Architect', 'Risk Analyst', 'Operations Manager', 'Resource', 'Financial'],
    final_verdict: 'GO',
    final_budget: 680000,
    messages: [
      { sender: 'Financial', text: 'FastTrack Logistics is a rapidly scaling last-mile player and their optimization engine project is a well-defined, contained scope. ₹680K over 8 months is realistic and aligns with our Logistics track record from the LogiRoute engagement. Strong advocate for GO.', round: 1 },
      { sender: 'Resource', text: 'Good bench fit. Proposing: Ada Lovelace (Backend/GraphQL, 5 yrs, LogiRoute alumna — note July leave, manageable with sprint planning), Priya Sharma (Data Engineer, LogiRoute alumna, partial capacity), and Ananya Das (Fullstack, 3 yrs). Three developers covers the scope at this budget level. Ada\'s leave is the only flag — her July 1-15 absence coincides with month 3 of the project; recommend sprint planning to avoid critical milestones during that window.', round: 1 },
      { sender: 'Technical Architect', text: 'Logistics optimization at this scale is within our delivery capability — route optimization APIs, real-time tracking, and delivery ETL pipelines are well-understood patterns. Ada\'s leave is a minor continuity risk for the API layer; Priya can cover basic backend tasks during the 2-week gap. Technical risk: LOW.', round: 1 },
      { sender: 'Risk Analyst', text: 'Risk assessment: primary risks are third-party mapping/routing API reliability and scope expansion into real-time fleet tracking. Risk tier: MEDIUM-LOW. Ada Lovelace\'s July leave should be flagged in the project risk register with a concrete coverage plan. Overall profile is acceptable.', round: 1 },
      { sender: 'Operations Manager', text: '8 months is operationally comfortable for this scope. Sprint planning can easily route Ada\'s leave into a lower-intensity sprint. Team onboarding can begin within 5 days. I recommend a formal leave-coverage roster published before sprint 1.', round: 1 },
      { sender: 'Financial', text: 'Staffing 3 developers for 8 months at ₹13,000/month yields ₹312,000 against a ₹680,000 budget — 54% gross margin. Solid financial profile. I approve proceeding.', round: 1 },
      { sender: 'Board of Directors', text: 'The Board has reviewed the FastTrack Logistics tender. All five agents have validated the engagement. Domain alignment, financial margins, and staffing are all green. Ada Lovelace\'s July leave is a noted operational flag that Operations must manage within sprint planning. The Board approves this engagement.\n[VERDICT: GO]', round: 2 },
    ],
  },
];

// ─── Seed runner ──────────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect();
  try {
    console.log('\n🌱 Starting database seed...\n');

    // ── 1. Mock users ──────────────────────────────────────────────────────────
    console.log('→ Seeding mock users...');
    const userIds = {};
    for (const u of MOCK_USERS) {
      const res = await client.query(
        `INSERT INTO users (google_id, email, name, picture)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET google_id = EXCLUDED.google_id, name = EXCLUDED.name, picture = EXCLUDED.picture
         RETURNING id`,
        [u.google_id, u.email, u.name, u.picture]
      );
      userIds[u.email] = res.rows[0].id;
      console.log(`   ✓ User: ${u.name} (id=${res.rows[0].id})`);
    }

    // ── 2. Tech stacks ─────────────────────────────────────────────────────────
    console.log('\n→ Seeding tech stacks...');
    const tsIdMap = {};
    for (const ts of TECH_STACKS) {
      const res = await client.query(
        `INSERT INTO techstacks (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [ts]
      );
      tsIdMap[ts] = res.rows[0].id;
    }
    console.log(`   ✓ ${TECH_STACKS.length} tech stacks upserted`);

    // ── 3. Projects (collect all unique ones) ────────────────────────────────
    console.log('\n→ Seeding projects...');
    const allProjects = {};
    for (const emp of EMPLOYEES) {
      for (const p of [...emp.current_projects, ...emp.past_projects]) {
        if (!allProjects[p.name]) allProjects[p.name] = p;
      }
    }
    const projIdMap = {};
    for (const [name, proj] of Object.entries(allProjects)) {
      const res = await client.query(
        `INSERT INTO projects (name, domain, complexity)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET domain = EXCLUDED.domain, complexity = EXCLUDED.complexity
         RETURNING id`,
        [name, proj.domain || 'General', proj.complexity || 'medium']
      );
      projIdMap[name] = res.rows[0].id;
      console.log(`   ✓ Project: ${name} [${proj.domain}, ${proj.complexity}]`);
    }

    // ── 4. Employees + relations ──────────────────────────────────────────────
    console.log('\n→ Seeding employees...');
    const empIdMap = {};
    for (const emp of EMPLOYEES) {
      // Check existence by email
      let empRes = await client.query('SELECT id FROM employees WHERE email = $1', [emp.email]);
      let empId;
      if (empRes.rows.length > 0) {
        empId = empRes.rows[0].id;
        console.log(`   ~ Employee already exists: ${emp.name}`);
      } else {
        const ins = await client.query(
          `INSERT INTO employees (name, designation, email, date_of_joining)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [emp.name, emp.designation, emp.email, emp.date_of_joining]
        );
        empId = ins.rows[0].id;
        console.log(`   ✓ Employee: ${emp.name} (${emp.designation}, joined ${emp.date_of_joining})`);
      }
      empIdMap[emp.email] = empId;

      // Tech stacks
      for (const skill of emp.skills) {
        if (tsIdMap[skill]) {
          await client.query(
            `INSERT INTO employee_techstacks (employee_id, techstack_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [empId, tsIdMap[skill]]
          );
        }
      }

      // Current projects
      for (const proj of emp.current_projects) {
        if (projIdMap[proj.name]) {
          await client.query(
            `INSERT INTO employee_projects (employee_id, project_id, project_type)
             VALUES ($1,$2,'current') ON CONFLICT DO NOTHING`,
            [empId, projIdMap[proj.name]]
          );
        }
      }

      // Past projects
      for (const proj of emp.past_projects) {
        if (projIdMap[proj.name]) {
          await client.query(
            `INSERT INTO employee_projects (employee_id, project_id, project_type)
             VALUES ($1,$2,'past') ON CONFLICT DO NOTHING`,
            [empId, projIdMap[proj.name]]
          );
        }
      }

      // Leaves — delete future leaves for this employee first to avoid duplicates
      await client.query(
        `DELETE FROM employee_leaves WHERE employee_id = $1 AND start_date >= CURRENT_DATE`,
        [empId]
      );
      for (const leave of emp.leaves) {
        await client.query(
          `INSERT INTO employee_leaves (employee_id, start_date, end_date, leave_type, status)
           VALUES ($1, $2, $3, $4, 'approved')`,
          [empId, leave.start_date, leave.end_date, leave.leave_type]
        );
        console.log(`   ✓   Leave: ${emp.name} → ${leave.start_date} to ${leave.end_date}`);
      }
    }

    // ── 5. Evaluation sessions + debate messages ──────────────────────────────
    console.log('\n→ Seeding evaluation sessions...');
    const userEmailList = Object.keys(userIds);

    for (let i = 0; i < EVAL_SESSIONS.length; i++) {
      const s = EVAL_SESSIONS[i];
      // Rotate sessions across all three mock users
      const ownerEmail = userEmailList[i % userEmailList.length];
      const userId = userIds[ownerEmail];

      // Delete existing mock evaluation session if it exists to allow re-seeding fresh data
      await client.query(
        `DELETE FROM evaluation_sessions WHERE tender_name = $1 AND user_id = $2`,
        [s.tender_name, userId]
      );

      const createdAt = new Date(Date.now() - (EVAL_SESSIONS.length - i) * 3 * 24 * 60 * 60 * 1000);

      const sesRes = await client.query(
        `INSERT INTO evaluation_sessions
           (user_id, tender_name, client_name, budget, timeline_months, industry, roster,
            final_verdict, final_budget, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          userId, s.tender_name, s.client_name, s.budget, s.timeline_months,
          s.industry, s.roster, s.final_verdict, s.final_budget, createdAt,
        ]
      );
      const sesId = sesRes.rows[0].id;
      console.log(`   ✓ Session: "${s.tender_name}" → ${s.final_verdict} (user: ${ownerEmail})`);

      for (const msg of s.messages) {
        await client.query(
          `INSERT INTO debate_messages (session_id, sender, message_text, negotiation_round)
           VALUES ($1,$2,$3,$4)`,
          [sesId, msg.sender, msg.text, msg.round]
        );
      }
    }

    console.log('\n✅ Seed complete!\n');
  } catch (err) {
    console.error('\n❌ Seed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
