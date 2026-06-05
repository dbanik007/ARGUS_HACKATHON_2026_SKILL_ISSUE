-- Company master table
CREATE TABLE IF NOT EXISTS companies (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(255) NOT NULL,
  industry            VARCHAR(100),
  address             TEXT,
  website             VARCHAR(255),
  registration_number VARCHAR(100),
  size_category       VARCHAR(50) NOT NULL DEFAULT 'medium'
                        CHECK (size_category IN ('startup', 'small', 'medium', 'large', 'enterprise')),
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Financial snapshot — one row per fiscal year per company
CREATE TABLE IF NOT EXISTS company_financials (
  id                            SERIAL PRIMARY KEY,
  company_id                    INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year                   INT NOT NULL,
  annual_revenue                NUMERIC(18, 2) NOT NULL,
  working_capital               NUMERIC(18, 2) NOT NULL,
  total_debt                    NUMERIC(18, 2) NOT NULL DEFAULT 0,
  active_project_value          NUMERIC(18, 2) NOT NULL DEFAULT 0,
  annual_payroll                NUMERIC(18, 2) NOT NULL,
  overhead_rate_percent         NUMERIC(5, 2)  NOT NULL DEFAULT 20.00,
  target_profit_margin_percent  NUMERIC(5, 2)  NOT NULL DEFAULT 15.00,
  max_bid_capacity_override     NUMERIC(18, 2),
  created_at                    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, fiscal_year)
);

-- Company ↔ user link (owner / admin / member)
CREATE TABLE IF NOT EXISTS company_users (
  id          SERIAL PRIMARY KEY,
  company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role        VARCHAR(50) NOT NULL DEFAULT 'owner'
                CHECK (role IN ('owner', 'admin', 'member')),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, user_id)
);

-- Scope employees to a company (nullable for backward compat with existing rows)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_company_users_user    ON company_users(user_id);
CREATE INDEX IF NOT EXISTS idx_company_users_company ON company_users(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_company     ON employees(company_id);

-- Demo company seed (Argusoft India Ltd — IT services)
INSERT INTO companies (name, industry, address, website, registration_number, size_category)
VALUES (
  'Argusoft India Ltd',
  'Information Technology',
  'Ahmedabad, Gujarat, India',
  'https://www.argusoft.com',
  'U72200GJ1992PTC018122',
  'large'
) ON CONFLICT DO NOTHING;

-- Financial snapshot for the demo company (FY 2025, amounts in INR)
WITH demo AS (SELECT id FROM companies WHERE name = 'Argusoft India Ltd' LIMIT 1)
INSERT INTO company_financials
  (company_id, fiscal_year, annual_revenue, working_capital, total_debt,
   active_project_value, annual_payroll, overhead_rate_percent, target_profit_margin_percent)
SELECT
  id,
  2025,
  850000000.00,   -- INR 85 Cr annual revenue
  120000000.00,   -- INR 12 Cr liquid working capital
  50000000.00,    -- INR  5 Cr outstanding debt
  320000000.00,   -- INR 32 Cr in active contracts
  380000000.00,   -- INR 38 Cr annual payroll
  22.50,
  18.00
FROM demo
ON CONFLICT DO NOTHING;
