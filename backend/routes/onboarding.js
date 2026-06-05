const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticateJWT } = require('./auth');

// GET /api/onboarding/status — check if the requesting user belongs to a company
router.get('/status', authenticateJWT, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.industry, cu.role
       FROM companies c
       JOIN company_users cu ON cu.company_id = c.id
       WHERE cu.user_id = $1
       LIMIT 1`,
      [req.user.id]
    );
    if (result.rows.length > 0) {
      res.json({ onboarded: true, company: result.rows[0] });
    } else {
      res.json({ onboarded: false });
    }
  } catch (err) {
    console.error('Onboarding status check failed:', err);
    res.status(500).json({ error: 'Status check failed' });
  }
});

// POST /api/onboarding/company — create company + financials, link requesting user as owner
router.post('/company', authenticateJWT, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      // Company profile
      name, industry, address, website, registration_number, size_category,
      // Financial snapshot
      fiscal_year, annual_revenue, working_capital, total_debt,
      active_project_value, annual_payroll, overhead_rate_percent,
      target_profit_margin_percent, max_bid_capacity_override
    } = req.body;

    const missing = [];
    if (!name?.trim())                                    missing.push('name');
    if (annual_revenue == null || annual_revenue === '')  missing.push('annual_revenue');
    if (working_capital == null || working_capital === '') missing.push('working_capital');
    if (annual_payroll  == null || annual_payroll  === '') missing.push('annual_payroll');

    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    await client.query('BEGIN');

    const companyRes = await client.query(
      `INSERT INTO companies (name, industry, address, website, registration_number, size_category)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name.trim(),
        industry         || null,
        address          || null,
        website          || null,
        registration_number || null,
        size_category    || 'medium'
      ]
    );
    const company = companyRes.rows[0];

    await client.query(
      `INSERT INTO company_financials
         (company_id, fiscal_year, annual_revenue, working_capital, total_debt,
          active_project_value, annual_payroll, overhead_rate_percent,
          target_profit_margin_percent, max_bid_capacity_override)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        company.id,
        fiscal_year ? parseInt(fiscal_year, 10) : new Date().getFullYear(),
        parseFloat(annual_revenue),
        parseFloat(working_capital),
        parseFloat(total_debt          ?? 0),
        parseFloat(active_project_value ?? 0),
        parseFloat(annual_payroll),
        parseFloat(overhead_rate_percent        ?? 20),
        parseFloat(target_profit_margin_percent ?? 15),
        max_bid_capacity_override ? parseFloat(max_bid_capacity_override) : null
      ]
    );

    await client.query(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [company.id, req.user.id]
    );

    await client.query('COMMIT');
    res.json({ success: true, company });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Company creation failed:', err);
    res.status(500).json({ error: 'Company creation failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
