-- Rename project_type value from 'future' to 'past' — future projects are unknowable at import time
ALTER TABLE employee_projects DROP CONSTRAINT IF EXISTS employee_projects_project_type_check;
ALTER TABLE employee_projects ADD CONSTRAINT employee_projects_project_type_check
    CHECK (project_type IN ('current', 'past'));
