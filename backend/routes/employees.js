const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const { pool } = require('../config/db');
const { authenticateJWT } = require('./auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// File upload: memory-only, 5 MB cap, CSV/XLSX only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv' && ext !== '.xlsx') {
      return cb(Object.assign(new Error('Only .csv and .xlsx files are accepted'), { code: 'INVALID_TYPE' }));
    }
    cb(null, true);
  }
});

// Canonical column keys expected in the uploaded file
const REQUIRED_COLS = ['employee_name', 'designation', 'email', 'date_of_joining'];
// upcoming_leaves format: YYYY-MM-DD:YYYY-MM-DD;YYYY-MM-DD:YYYY-MM-DD (start:end pairs, semicolon-separated)
const ALL_COLS = [...REQUIRED_COLS, 'current_projects', 'past_projects', 'tech_stack', 'upcoming_leaves'];

function normaliseHeader(h) {
  return String(h).trim().toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[()[\]]/g, '')
    .replace(/_+/g, '_');
}

function splitSemicolon(val) {
  return String(val || '').split(';').map(s => s.trim()).filter(Boolean);
}

// Parse semicolon-separated start:end leave pairs, e.g. "2026-07-01:2026-07-10;2026-09-05:2026-09-05"
function parseLeaves(val) {
  return String(val || '').split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => {
      const [start, end] = pair.split(':').map(d => d.trim());
      if (!start) return null;
      const startD = new Date(start);
      const endD   = end ? new Date(end) : startD;
      if (isNaN(startD.getTime()) || isNaN(endD.getTime())) return null;
      return {
        start_date: startD.toISOString().split('T')[0],
        end_date:   endD.toISOString().split('T')[0],
      };
    })
    .filter(Boolean);
}

// GET /api/employees/template  — returns a pre-filled XLSX template
router.get('/template', authenticateJWT, (_req, res) => {
  const wb = XLSX.utils.book_new();
  const rows = [
    ALL_COLS,
    ['Archishman Ghosh',  'Security Guard',     'aghosh@argusoft.com',  '2023-01-15', 'Argusoft Gate', 'Meghdoot',          'Angular;Node.js;PostgreSQL', ''],
    ['Diganta Banik',    'Software Engineer',   'dbanik@argusoft.com',   '2022-06-01', 'Meghdoot',     'Reporting;Testing', 'Jira;Confluence',            '2026-07-01:2026-07-10'],
    ['Sankalan Chanda',  'Senior Engineer',     'schanda@argusoft.com',  '2024-03-10', 'Meghdoot',     '',                  'Docker;Kubernetes;Terraform', ''],
    ['Samrat Mondal',    'Vice President',      'smondal@argusoft.com',  '2024-03-10', 'EMS',          'MMS',               'HTML;CSS',                   '2026-08-15:2026-08-22;2026-09-01:2026-09-05'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [22, 22, 32, 24, 38, 38, 32, 44].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="employee_import_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// POST /api/employees/import  — parse, validate, and persist uploaded file
router.post('/import', authenticateJWT, (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'File exceeds the 5 MB size limit' });
      if (uploadErr.code === 'INVALID_TYPE')    return res.status(400).json({ message: uploadErr.message });
      return res.status(400).json({ message: 'File upload failed' });
    }
    if (!req.file) return res.status(400).json({ message: 'No file attached. Send a multipart/form-data request with a "file" field.' });

    // --- Parse ---
    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    } catch {
      return res.status(422).json({ message: 'Could not parse the file — ensure it is a valid CSV or XLSX.' });
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

    if (rawRows.length < 2) {
      return res.status(422).json({ message: 'File must have a header row plus at least one data row.' });
    }

    // --- Header resolution ---
    const headerRow = rawRows[0].map(normaliseHeader);
    const missing = REQUIRED_COLS.filter(c => !headerRow.includes(c));
    if (missing.length) {
      return res.status(422).json({ message: `Missing required column(s): ${missing.join(', ')}` });
    }
    const idx = Object.fromEntries(ALL_COLS.map(c => [c, headerRow.indexOf(c)]));

    // --- Row-by-row validation ---
    const errors = [];
    const seenEmails = new Map(); // email → first row number (for duplicate detection)
    const parsed = [];

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 1; // human-readable (1 = header)

      if (row.every(cell => !String(cell).trim())) continue; // skip blank rows

      const name        = String(row[idx.employee_name]   ?? '').trim();
      const designation = String(row[idx.designation]     ?? '').trim();
      const rawEmail    = String(row[idx.email]           ?? '').trim();
      const email       = rawEmail.toLowerCase();
      const dateRaw     = String(row[idx.date_of_joining] ?? '').trim();
      const curProjs    = splitSemicolon(idx.current_projects  !== -1 ? row[idx.current_projects]  : '');
      const pastProjs   = splitSemicolon(idx.past_projects     !== -1 ? row[idx.past_projects]     : '');
      const techStack   = splitSemicolon(idx.tech_stack        !== -1 ? row[idx.tech_stack]        : '');
      const leaves      = parseLeaves(  idx.upcoming_leaves   !== -1 ? row[idx.upcoming_leaves]   : '');

      const rowErr = [];

      if (!name)        rowErr.push({ row: rowNum, field: 'employee_name',   message: 'Employee name is required' });
      if (!designation) rowErr.push({ row: rowNum, field: 'designation',     message: 'Designation is required' });

      if (!rawEmail) {
        rowErr.push({ row: rowNum, field: 'email', message: 'Email is required' });
      } else if (!EMAIL_RE.test(email)) {
        rowErr.push({ row: rowNum, field: 'email', message: `"${rawEmail}" is not a valid email address` });
      } else if (seenEmails.has(email)) {
        rowErr.push({ row: rowNum, field: 'email', message: `Duplicate email "${email}" — first seen at row ${seenEmails.get(email)}` });
      } else {
        seenEmails.set(email, rowNum);
      }

      let parsedDate = null;
      if (!dateRaw) {
        rowErr.push({ row: rowNum, field: 'date_of_joining', message: 'Date of joining is required' });
      } else {
        const d = new Date(dateRaw);
        if (isNaN(d.getTime())) {
          rowErr.push({ row: rowNum, field: 'date_of_joining', message: `"${dateRaw}" is not a valid date. Use YYYY-MM-DD format (e.g. 2023-01-15)` });
        } else {
          parsedDate = d.toISOString().split('T')[0];
        }
      }

      if (rowErr.length) {
        errors.push(...rowErr);
      } else {
        parsed.push({ rowNum, name, designation, email, date_of_joining: parsedDate, curProjs, pastProjs, techStack, leaves });
      }
    }

    if (!parsed.length && !errors.length) {
      return res.status(422).json({ message: 'No data rows found in file.' });
    }

    // --- DB-level uniqueness check ---
    if (seenEmails.size > 0) {
      const emailList = [...seenEmails.keys()];
      const { rows: existing } = await pool.query(
        'SELECT email FROM employees WHERE email = ANY($1)',
        [emailList]
      );
      const existingSet = new Set(existing.map(r => r.email));
      parsed.forEach(r => {
        if (existingSet.has(r.email)) {
          errors.push({ row: r.rowNum, field: 'email', message: `Employee with email "${r.email}" already exists in the system` });
        }
      });
    }

    if (errors.length) {
      return res.status(422).json({ errors });
    }

    // --- Transactional insert ---
    const client = await pool.connect();
    let insertedCount = 0;
    try {
      await client.query('BEGIN');

      for (const r of parsed) {
        const { rows: [{ id: empId }] } = await client.query(
          'INSERT INTO employees (name, designation, email, date_of_joining) VALUES ($1,$2,$3,$4) RETURNING id',
          [r.name, r.designation, r.email, r.date_of_joining]
        );

        for (const tech of r.techStack) {
          const { rows: [{ id: tsId }] } = await client.query(
            'INSERT INTO techstacks (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id',
            [tech]
          );
          await client.query(
            'INSERT INTO employee_techstacks (employee_id, techstack_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [empId, tsId]
          );
        }

        for (const proj of r.curProjs) {
          const { rows: [{ id: pId }] } = await client.query(
            'INSERT INTO projects (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id',
            [proj]
          );
          await client.query(
            'INSERT INTO employee_projects (employee_id, project_id, project_type) VALUES ($1,$2,\'current\') ON CONFLICT DO NOTHING',
            [empId, pId]
          );
        }

        for (const proj of r.pastProjs) {
          const { rows: [{ id: pId }] } = await client.query(
            'INSERT INTO projects (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id',
            [proj]
          );
          await client.query(
            'INSERT INTO employee_projects (employee_id, project_id, project_type) VALUES ($1,$2,\'past\') ON CONFLICT DO NOTHING',
            [empId, pId]
          );
        }

        for (const leave of r.leaves) {
          await client.query(
            `INSERT INTO employee_leaves (employee_id, start_date, end_date, leave_type, status)
             VALUES ($1, $2, $3, 'planned', 'approved')`,
            [empId, leave.start_date, leave.end_date]
          );
        }

        insertedCount++;
      }

      await client.query('COMMIT');
      res.json({ imported: insertedCount, message: `Successfully imported ${insertedCount} employee(s)` });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[employees] import transaction failed:', err);
      res.status(500).json({ message: 'Import failed due to a database error. Please try again.' });
    } finally {
      client.release();
    }
  });
});

module.exports = router;
