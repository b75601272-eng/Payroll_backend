const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');

// GET all
router.get('/', async (req, res) => {
  try {
    const { status, department_id, search } = req.query;
    let query  = `SELECT e.*, d.name as department_name FROM employees e LEFT JOIN departments d ON e.department_id=d.id WHERE 1=1`;
    const params = [];
    let i = 1;
    if (status)        { query += ` AND e.status=$${i++}`;                                                               params.push(status); }
    if (department_id) { query += ` AND e.department_id=$${i++}`;                                                        params.push(department_id); }
    if (search)        { query += ` AND (e.name ILIKE $${i} OR e.employee_id ILIKE $${i} OR e.email ILIKE $${i++})`;    params.push(`%${search}%`); }
    query += ' ORDER BY e.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json({ success:true, data:rows, count:rows.length });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

// GET one
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT e.*,d.name as department_name FROM employees e LEFT JOIN departments d ON e.department_id=d.id WHERE e.id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Employee not found' });
    res.json({ success:true, data:rows[0] });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

// POST create
router.post('/', async (req, res) => {
  try {
    const { employee_id,name,email,phone,department_id,designation,base_salary,hra_percent,da_percent,ta_fixed,ma_fixed,joining_date,bank_account,bank_name,pan_number } = req.body;
    if (!employee_id||!name||!email||!base_salary||!joining_date) return res.status(400).json({ success:false, message:'Required: employee_id, name, email, base_salary, joining_date' });
    const { rows } = await pool.query(
      `INSERT INTO employees (employee_id,name,email,phone,department_id,designation,base_salary,hra_percent,da_percent,ta_fixed,ma_fixed,joining_date,bank_account,bank_name,pan_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [employee_id,name,email,phone||null,department_id||null,designation||null,base_salary,hra_percent||40,da_percent||20,ta_fixed||1600,ma_fixed||1250,joining_date,bank_account||null,bank_name||null,pan_number||null]
    );
    res.status(201).json({ success:true, message:'Employee created', data:rows[0] });
  } catch (e) {
    if (e.code==='23505') return res.status(409).json({ success:false, message:'Employee ID or Email already exists' });
    res.status(500).json({ success:false, message:e.message });
  }
});

// PUT update
router.put('/:id', async (req, res) => {
  try {
    const { name,email,phone,department_id,designation,base_salary,hra_percent,da_percent,ta_fixed,ma_fixed,joining_date,status,bank_account,bank_name,pan_number } = req.body;
    const { rows } = await pool.query(
      `UPDATE employees SET name=$1,email=$2,phone=$3,department_id=$4,designation=$5,base_salary=$6,hra_percent=$7,da_percent=$8,ta_fixed=$9,ma_fixed=$10,joining_date=$11,status=$12,bank_account=$13,bank_name=$14,pan_number=$15,updated_at=NOW() WHERE id=$16 RETURNING *`,
      [name,email,phone||null,department_id||null,designation||null,base_salary,hra_percent||40,da_percent||20,ta_fixed||1600,ma_fixed||1250,joining_date,status||'active',bank_account||null,bank_name||null,pan_number||null,req.params.id]
    );
    res.json({ success:true, message:'Employee updated', data:rows[0] });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM employees WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Not found' });
    await pool.query('DELETE FROM employees WHERE id=$1', [req.params.id]);
    res.json({ success:true, message:'Employee deleted' });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

module.exports = router;
