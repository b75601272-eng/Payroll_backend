const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');

// GET all employees
router.get('/', async (req, res) => {
  try {
    const { status, department_id, search } = req.query;
    let query  = `SELECT e.*, d.name as department_name
                  FROM employees e
                  LEFT JOIN departments d ON e.department_id = d.id
                  WHERE 1=1`;
    const params = [];

    if (status)        { query += ' AND e.status = ?';                                              params.push(status); }
    if (department_id) { query += ' AND e.department_id = ?';                                       params.push(department_id); }
    if (search)        { query += ' AND (e.name LIKE ? OR e.employee_id LIKE ? OR e.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    query += ' ORDER BY e.created_at DESC';

    const [rows] = await pool.query(query, params);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single employee
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, d.name as department_name
       FROM employees e LEFT JOIN departments d ON e.department_id = d.id
       WHERE e.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create employee
router.post('/', async (req, res) => {
  try {
    const {
      employee_id, name, email, phone, department_id, designation,
      base_salary, hra_percent, da_percent, ta_fixed, ma_fixed,
      joining_date, bank_account, bank_name, pan_number
    } = req.body;

    if (!employee_id || !name || !email || !base_salary || !joining_date) {
      return res.status(400).json({ success: false, message: 'Required: employee_id, name, email, base_salary, joining_date' });
    }

    const [result] = await pool.query(
      `INSERT INTO employees
        (employee_id, name, email, phone, department_id, designation, base_salary,
         hra_percent, da_percent, ta_fixed, ma_fixed, joining_date, bank_account, bank_name, pan_number)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [employee_id, name, email, phone||null, department_id||null, designation||null,
       base_salary, hra_percent||40, da_percent||20, ta_fixed||1600, ma_fixed||1250,
       joining_date, bank_account||null, bank_name||null, pan_number||null]
    );
    const [newEmp] = await pool.query('SELECT * FROM employees WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, message: 'Employee created', data: newEmp[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Employee ID or Email already exists' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT update employee
router.put('/:id', async (req, res) => {
  try {
    const {
      name, email, phone, department_id, designation, base_salary,
      hra_percent, da_percent, ta_fixed, ma_fixed, joining_date,
      status, bank_account, bank_name, pan_number
    } = req.body;

    await pool.query(
      `UPDATE employees SET
        name=?,email=?,phone=?,department_id=?,designation=?,base_salary=?,
        hra_percent=?,da_percent=?,ta_fixed=?,ma_fixed=?,joining_date=?,
        status=?,bank_account=?,bank_name=?,pan_number=?
       WHERE id=?`,
      [name, email, phone||null, department_id||null, designation||null, base_salary,
       hra_percent||40, da_percent||20, ta_fixed||1600, ma_fixed||1250, joining_date,
       status||'active', bank_account||null, bank_name||null, pan_number||null,
       req.params.id]
    );
    const [updated] = await pool.query('SELECT * FROM employees WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Employee updated', data: updated[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE employee
router.delete('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id FROM employees WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Employee not found' });
    await pool.query('DELETE FROM employees WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Employee deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
