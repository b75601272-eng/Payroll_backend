const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tax_settings ORDER BY tax_type,min_salary');
    res.json({ success:true, data:rows });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name,tax_type,rate,min_salary,max_salary,is_active } = req.body;
    if (!name||!tax_type||rate===undefined) return res.status(400).json({ success:false, message:'name, tax_type and rate required' });
    const { rows } = await pool.query('INSERT INTO tax_settings (name,tax_type,rate,min_salary,max_salary,is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [name,tax_type,rate,min_salary||0,max_salary||null,is_active!==undefined?is_active:true]);
    res.status(201).json({ success:true, message:'Created', data:rows[0] });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name,tax_type,rate,min_salary,max_salary,is_active } = req.body;
    await pool.query('UPDATE tax_settings SET name=$1,tax_type=$2,rate=$3,min_salary=$4,max_salary=$5,is_active=$6,updated_at=NOW() WHERE id=$7',
      [name,tax_type,rate,min_salary||0,max_salary||null,is_active,req.params.id]);
    res.json({ success:true, message:'Updated' });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tax_settings WHERE id=$1',[req.params.id]);
    res.json({ success:true, message:'Deleted' });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
});

module.exports = router;
