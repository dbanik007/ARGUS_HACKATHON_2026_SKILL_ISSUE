-- Lookup table for technology skills
CREATE TABLE IF NOT EXISTS techstacks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL
);

-- Projects table (current and future)
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Employees master table
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    designation VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    date_of_joining DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many: employee <-> techstack
CREATE TABLE IF NOT EXISTS employee_techstacks (
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    techstack_id INT REFERENCES techstacks(id) ON DELETE CASCADE,
    PRIMARY KEY (employee_id, techstack_id)
);

-- Many-to-many: employee <-> project (with current/future type)
CREATE TABLE IF NOT EXISTS employee_projects (
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    project_id INT REFERENCES projects(id) ON DELETE CASCADE,
    project_type VARCHAR(10) NOT NULL CHECK (project_type IN ('current', 'future')),
    PRIMARY KEY (employee_id, project_id)
);
