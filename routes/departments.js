const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT d.*,COUNT(e.id)::int as employee_count FROM departments d LEFT JOIN employees e ON d.id=e.department_id AND e.status='active' GROUP BY d.id ORDER BY d.name`);
    res.json({ success:true, data:rows });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success:false, message:'Name required' });
    const { rows } = await pool.query('INSERT INTO departments (name) VALUES ($1) RETURNING *',[name]);
    res.status(201).json({ success:true, message:'Created', data:rows[0] });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE departments SET name=$1 WHERE id=$2',[req.body.name,req.params.id]);
    res.json({ success:true, message:'Updated' });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM departments WHERE id=$1',[req.params.id]);
    res.json({ success:true, message:'Deleted' });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

module.exports = router;
