const express = require('express');
const router  = express.Router();
const PDFDocument = require('pdfkit');
const { pool } = require('../config/db');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Tax calculator ───────────────────────────────────────
function calculateTax(grossSalary, taxSettings) {
  let pt = 0, ss = 0, it = 0;
  const annual = grossSalary * 12;

  taxSettings.forEach(tax => {
    if (!tax.is_active) return;
    const rate = parseFloat(tax.rate) / 100;
    const min  = parseFloat(tax.min_salary || 0);
    const max  = tax.max_salary ? parseFloat(tax.max_salary) : Infinity;

    if (tax.tax_type === 'PT' && grossSalary >= min) {
      pt += grossSalary * rate;
    } else if (tax.tax_type === 'SS') {
      ss += grossSalary * rate;
    } else if (tax.tax_type === 'IT' && annual > min) {
      const taxable = Math.min(annual, max) - min;
      it += (taxable * rate) / 12;
    }
  });

  return {
    pt: Math.round(pt * 100) / 100,
    ss: Math.round(ss * 100) / 100,
    it: Math.round(it * 100) / 100
  };
}

// ── GET all payroll records ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { month, year, employee_id, status } = req.query;
    let query = `
      SELECT pr.*, e.name as employee_name, e.employee_id as emp_code,
             d.name as department_name, e.designation
      FROM payroll_records pr
      JOIN employees e ON pr.employee_id = e.id
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE 1=1`;
    const params = [];
    if (month)       { query += ' AND pr.month=?';            params.push(month); }
    if (year)        { query += ' AND pr.year=?';             params.push(year); }
    if (employee_id) { query += ' AND pr.employee_id=?';      params.push(employee_id); }
    if (status)      { query += ' AND pr.payment_status=?';   params.push(status); }
    query += ' ORDER BY pr.year DESC, pr.month DESC, e.name ASC';

    const [rows] = await pool.query(query, params);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST generate payroll ────────────────────────────────
router.post('/generate', async (req, res) => {
  try {
    const { month, year, employee_ids } = req.body;
    if (!month || !year) return res.status(400).json({ success: false, message: 'month and year are required' });

    const [taxSettings] = await pool.query('SELECT * FROM tax_settings WHERE is_active=1');

    let empQuery  = 'SELECT * FROM employees WHERE status="active"';
    const empParams = [];
    if (employee_ids && employee_ids.length) {
      empQuery += ` AND id IN (${employee_ids.map(() => '?').join(',')})`;
      empParams.push(...employee_ids);
    }
    const [employees] = await pool.query(empQuery, empParams);
    if (!employees.length) return res.status(404).json({ success: false, message: 'No active employees found' });

    const generated = [], skipped = [];

    for (const emp of employees) {
      const [existing] = await pool.query(
        'SELECT id FROM payroll_records WHERE employee_id=? AND month=? AND year=?',
        [emp.id, month, year]
      );
      if (existing.length) { skipped.push(emp.name); continue; }

      const hra   = (emp.base_salary * parseFloat(emp.hra_percent || 40)) / 100;
      const da    = (emp.base_salary * parseFloat(emp.da_percent  || 20)) / 100;
      const ta    = parseFloat(emp.ta_fixed || 1600);
      const ma    = parseFloat(emp.ma_fixed || 1250);
      const gross = emp.base_salary + hra + da + ta + ma;
      const taxes = calculateTax(gross, taxSettings);
      const totalDed = taxes.pt + taxes.ss + taxes.it;
      const net   = gross - totalDed;

      await pool.query(
        `INSERT INTO payroll_records
          (employee_id,month,year,base_salary,hra,da,ta,ma,gross_salary,
           pt_deduction,ss_deduction,it_deduction,total_deductions,net_salary)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [emp.id, month, year, emp.base_salary,
         Math.round(hra*100)/100, Math.round(da*100)/100, ta, ma,
         Math.round(gross*100)/100,
         taxes.pt, taxes.ss, taxes.it,
         Math.round(totalDed*100)/100,
         Math.round(net*100)/100]
      );
      generated.push(emp.name);
    }

    res.json({ success: true, message: `Payroll generated for ${generated.length} employee(s)`, generated, skipped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PATCH payment status ─────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  try {
    const { payment_status, payment_date } = req.body;
    await pool.query(
      'UPDATE payroll_records SET payment_status=?, payment_date=? WHERE id=?',
      [payment_status, payment_date || new Date().toISOString().split('T')[0], req.params.id]
    );
    res.json({ success: true, message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET PDF payslip ──────────────────────────────────────
router.get('/:id/slip', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pr.*, e.name, e.employee_id as emp_code, e.email, e.designation,
              e.bank_account, e.bank_name, e.pan_number, e.joining_date,
              d.name as department_name
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE pr.id=?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Record not found' });

    const p = rows[0];
    const mName = MONTHS[p.month - 1];
    const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=payslip_${p.emp_code}_${mName}_${p.year}.pdf`);
    doc.pipe(res);

    // Header band
    doc.rect(0, 0, 595, 80).fill('#1e293b');
    doc.fillColor('white').fontSize(20).font('Helvetica-Bold')
       .text(process.env.COMPANY_NAME || 'PayrollPro', 50, 18);
    doc.fontSize(10).font('Helvetica')
       .text(`Pay Slip — ${mName} ${p.year}`, 50, 46)
       .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 400, 46);

    // Employee info
    doc.fillColor('#1e293b').fontSize(12).font('Helvetica-Bold').text('Employee Details', 50, 98);
    doc.moveTo(50,114).lineTo(545,114).strokeColor('#e2e8f0').stroke();

    const field = (l,v,x,y) => {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b').text(l, x, y);
      doc.fontSize(10).font('Helvetica').fillColor('#1e293b').text(v||'N/A', x, y+13);
    };
    let y = 124;
    field('Employee ID', p.emp_code, 50, y);  field('Name', p.name, 300, y);
    y+=36;
    field('Department', p.department_name, 50, y); field('Designation', p.designation, 300, y);
    y+=36;
    field('PAN', p.pan_number, 50, y); field('Bank', p.bank_account ? `${p.bank_name||''} - ${p.bank_account}` : 'N/A', 300, y);

    // Earnings / Deductions table
    y += 52;
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e293b').text('Salary Breakdown', 50, y);
    doc.moveTo(50, y+16).lineTo(545, y+16).strokeColor('#e2e8f0').stroke();
    y += 24;

    doc.rect(50, y, 495, 22).fill('#f1f5f9');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b');
    doc.text('EARNINGS', 60, y+7); doc.text('AMOUNT', 210, y+7);
    doc.text('DEDUCTIONS', 310, y+7); doc.text('AMOUNT', 470, y+7);
    y += 28;

    const earnings   = [['Basic Salary',p.base_salary],['HRA',p.hra],['DA',p.da],['Travel Allow.',p.ta],['Medical Allow.',p.ma]];
    const deductions = [['Professional Tax',p.pt_deduction],['Social Security',p.ss_deduction],['Income Tax',p.it_deduction]];
    if (parseFloat(p.other_allowances||0)>0)  earnings.push(['Other',p.other_allowances]);
    if (parseFloat(p.other_deductions||0)>0) deductions.push(['Other',p.other_deductions]);

    const maxR = Math.max(earnings.length, deductions.length);
    for (let i=0; i<maxR; i++) {
      if (i%2===0) doc.rect(50, y-2, 495, 20).fill('#fafafa');
      doc.fontSize(9).font('Helvetica').fillColor('#334155');
      if (earnings[i])   { doc.text(earnings[i][0], 60, y+2);   doc.text(`₹ ${fmt(earnings[i][1])}`,   190, y+2, {width:100, align:'right'}); }
      if (deductions[i]) { doc.text(deductions[i][0], 310, y+2); doc.text(`₹ ${fmt(deductions[i][1])}`, 440, y+2, {width:100, align:'right'}); }
      y += 20;
    }

    // Totals row
    y += 4;
    doc.rect(50, y, 495, 26).fill('#e2e8f0');
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b');
    doc.text('Gross Salary', 60, y+8);
    doc.text(`₹ ${fmt(p.gross_salary)}`, 140, y+8, {width:150, align:'right'});
    doc.text('Total Deductions', 310, y+8);
    doc.text(`₹ ${fmt(p.total_deductions)}`, 390, y+8, {width:150, align:'right'});

    y += 36;
    doc.rect(50, y, 495, 34).fill('#1e293b');
    doc.fillColor('white').fontSize(13).font('Helvetica-Bold')
       .text('NET SALARY (Take Home)', 60, y+10);
    doc.text(`₹ ${fmt(p.net_salary)}`, 300, y+10, {width:235, align:'right'});

    y += 52;
    doc.fontSize(8).fillColor('#94a3b8').text('This is a computer-generated payslip. No signature required.', 50, y, {align:'center', width:495});

    doc.end();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET reports summary ──────────────────────────────────
router.get('/reports/summary', async (req, res) => {
  try {
    const reportYear = req.query.year || new Date().getFullYear();

    const [monthly] = await pool.query(
      `SELECT month, SUM(gross_salary) as total_gross, SUM(total_deductions) as total_deductions,
              SUM(net_salary) as total_net, COUNT(*) as employee_count
       FROM payroll_records WHERE year=? AND payment_status='paid'
       GROUP BY month ORDER BY month`,
      [reportYear]
    );
    const [deptSummary] = await pool.query(
      `SELECT d.name as department, SUM(pr.net_salary) as total_net,
              COUNT(DISTINCT pr.employee_id) as employee_count
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE pr.year=? AND pr.payment_status='paid' GROUP BY d.name`,
      [reportYear]
    );
    const [[totals]] = await pool.query(
      `SELECT COUNT(DISTINCT employee_id) as total_employees,
              COALESCE(SUM(gross_salary),0) as annual_gross,
              COALESCE(SUM(total_deductions),0) as annual_deductions,
              COALESCE(SUM(net_salary),0) as annual_net
       FROM payroll_records WHERE year=? AND payment_status='paid'`,
      [reportYear]
    );

    res.json({ success: true, data: { monthly, deptSummary, totals, year: reportYear } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
