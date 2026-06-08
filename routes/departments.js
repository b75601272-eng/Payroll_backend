const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.*, COUNT(e.id) as employee_count
       FROM departments d
       LEFT JOIN employees e ON d.id=e.department_id AND e.status='active'
       GROUP BY d.id ORDER BY d.name`
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    const [result] = await pool.query('INSERT INTO departments (name) VALUES (?)', [name]);
    res.status(201).json({ success: true, message: 'Department created', data: { id: result.insertId, name } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE departments SET name=? WHERE id=?', [req.body.name, req.params.id]);
    res.json({ success: true, message: 'Department updated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM departments WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Department deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
