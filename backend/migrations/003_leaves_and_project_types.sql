-- Add domain and complexity to projects so agents can evaluate alignment with the new tender
ALTER TABLE projects ADD COLUMN IF NOT EXISTS domain VARCHAR(100) DEFAULT 'General';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS complexity VARCHAR(10) DEFAULT 'medium'
  CHECK (complexity IN ('low', 'medium', 'high'));

-- Employee leaves: planned/approved leave windows that affect availability
CREATE TABLE IF NOT EXISTS employee_leaves (
  id            SERIAL PRIMARY KEY,
  employee_id   INT  NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  leave_type    VARCHAR(50)  NOT NULL DEFAULT 'planned',
  status        VARCHAR(20)  NOT NULL DEFAULT 'approved'
                  CHECK (status IN ('approved', 'pending')),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_employee_leaves_emp  ON employee_leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_dates ON employee_leaves(start_date, end_date);
