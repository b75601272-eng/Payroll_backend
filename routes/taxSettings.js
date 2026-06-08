const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM tax_settings ORDER BY tax_type, min_salary');
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, tax_type, rate, min_salary, max_salary, is_active } = req.body;
    if (!name || !tax_type || rate === undefined) return res.status(400).json({ success: false, message: 'name, tax_type and rate required' });
    const [r] = await pool.query(
      'INSERT INTO tax_settings (name,tax_type,rate,min_salary,max_salary,is_active) VALUES (?,?,?,?,?,?)',
      [name, tax_type, rate, min_salary||0, max_salary||null, is_active!==undefined?is_active:1]
    );
    res.status(201).json({ success: true, message: 'Created', data: { id: r.insertId } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, tax_type, rate, min_salary, max_salary, is_active } = req.body;
    await pool.query(
      'UPDATE tax_settings SET name=?,tax_type=?,rate=?,min_salary=?,max_salary=?,is_active=? WHERE id=?',
      [name, tax_type, rate, min_salary||0, max_salary||null, is_active, req.params.id]
    );
    res.json({ success: true, message: 'Updated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tax_settings WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
