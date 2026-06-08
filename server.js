require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app = express();

// ── Logger ───────────────────────────────────────────────
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(path.join(logDir, 'app.log'), line); } catch (_) {}
}

log('Server starting...');
log(`Node: ${process.version} | ENV: ${process.env.NODE_ENV || 'development'}`);

// ── CORS ─────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => { log(`${req.method} ${req.path}`); next(); });

// ── Health (always works, no DB needed) ──────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), node: process.version, uptime: Math.floor(process.uptime()) + 's' });
});

// ── Debug logs viewer ────────────────────────────────────
app.get('/api/debug/logs', (req, res) => {
  try {
    const f = path.join(logDir, 'app.log');
    if (!fs.existsSync(f)) return res.type('text').send('No logs yet');
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n').slice(-150).join('\n');
    res.type('text').send(lines);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/debug/logs', (req, res) => {
  try { fs.writeFileSync(path.join(logDir, 'app.log'), ''); res.json({ message: 'Logs cleared' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Routes ───────────────────────────────────────────────
const load = (name, path_) => {
  try { app.use(path_, require(name)); log(`✅ Route: ${path_}`); }
  catch (e) { log(`❌ Route FAILED ${path_}: ${e.message}`); }
};
load('./routes/employees',   '/api/employees');
load('./routes/payroll',     '/api/payroll');
load('./routes/departments', '/api/departments');
load('./routes/taxSettings', '/api/tax-settings');

// ── Dashboard ────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    const { pool } = require('./config/db');
    const m = new Date().getMonth() + 1;
    const y = new Date().getFullYear();

    const { rows: [emp] }    = await pool.query(`SELECT COUNT(*)::int as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END)::int as active, SUM(CASE WHEN status='inactive' THEN 1 ELSE 0 END)::int as inactive FROM employees`);
    const { rows: [pay] }    = await pool.query(`SELECT COUNT(*)::int as processed, COALESCE(SUM(net_salary),0) as total_net, SUM(CASE WHEN payment_status='paid' THEN 1 ELSE 0 END)::int as paid, SUM(CASE WHEN payment_status='pending' THEN 1 ELSE 0 END)::int as pending FROM payroll_records WHERE month=$1 AND year=$2`, [m, y]);
    const { rows: [dept] }   = await pool.query(`SELECT COUNT(*)::int as total FROM departments`);
    const { rows: recent }   = await pool.query(`SELECT pr.id,e.name,e.employee_id as emp_code,pr.net_salary,pr.payment_status,pr.month,pr.year FROM payroll_records pr JOIN employees e ON pr.employee_id=e.id ORDER BY pr.created_at DESC LIMIT 5`);
    const { rows: monthly }  = await pool.query(`SELECT month,SUM(gross_salary) as total_gross,SUM(total_deductions) as total_deductions,SUM(net_salary) as total_net,COUNT(*)::int as employee_count FROM payroll_records WHERE year=$1 AND payment_status='paid' GROUP BY month ORDER BY month`, [y]);
    const { rows: deptSum }  = await pool.query(`SELECT d.name as department,SUM(pr.net_salary) as total_net,COUNT(DISTINCT pr.employee_id)::int as employee_count FROM payroll_records pr JOIN employees e ON pr.employee_id=e.id LEFT JOIN departments d ON e.department_id=d.id WHERE pr.year=$1 AND pr.payment_status='paid' GROUP BY d.name`, [y]);

    res.json({ success:true, data:{ employees:emp, currentMonthPayroll:pay, departments:dept.total, recentPayroll:recent, monthly, deptSummary:deptSum, currentMonth:m, currentYear:y }});
  } catch (e) { log(`Dashboard error: ${e.message}`); res.status(500).json({ success:false, message:e.message }); }
});

// ── 404 / Error handlers ─────────────────────────────────
app.use((req, res) => res.status(404).json({ success:false, message:`Route not found: ${req.method} ${req.path}` }));
app.use((err, req, res, next) => { log(`Error: ${err.message}`); res.status(500).json({ success:false, message:err.message }); });

// ── Start ────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5000;
app.listen(PORT, '0.0.0.0', () => {
  log(`🚀 Server on port ${PORT}`);
  log(`❤️  Health:     /api/health`);
  log(`🔍 Debug logs: /api/debug/logs`);
});

process.on('uncaughtException',  e => log(`UNCAUGHT: ${e.message}\n${e.stack}`));
process.on('unhandledRejection', e => log(`UNHANDLED: ${e}`));
