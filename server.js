// ════════════════════════════════════════════
//  PAYROLL MANAGEMENT SYSTEM - Backend Server
// ════════════════════════════════════════════
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');

const app = express();

// ── Logger (shared with db.js) ───────────────────────────
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(path.join(logDir, 'app.log'), line); } catch (_) {}
}

log('Server starting...');
log(`Node version: ${process.version}`);
log(`Environment: ${process.env.NODE_ENV || 'development'}`);

// ── CORS ─────────────────────────────────────────────────
const allowedOrigin = process.env.FRONTEND_URL || '*';
app.use(cors({
  origin: allowedOrigin === '*' ? '*' : allowedOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: allowedOrigin !== '*'
}));
log(`CORS origin: ${allowedOrigin}`);

// ── Body parsers ─────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Request logger ───────────────────────────────────────
app.use((req, res, next) => {
  log(`${req.method} ${req.path}`);
  next();
});

// ── Health check (before DB, always works) ───────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    node: process.version,
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// ── Debug: view logs via browser ─────────────────────────
app.get('/api/debug/logs', (req, res) => {
  try {
    const logFile = path.join(logDir, 'app.log');
    if (!fs.existsSync(logFile)) {
      return res.json({ logs: 'No logs yet' });
    }
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n').slice(-100); // last 100 lines
    res.setHeader('Content-Type', 'text/plain');
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Debug: clear logs ────────────────────────────────────
app.delete('/api/debug/logs', (req, res) => {
  try {
    fs.writeFileSync(path.join(logDir, 'app.log'), '');
    res.json({ message: 'Logs cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Load routes ──────────────────────────────────────────
try {
  app.use('/api/employees',    require('./routes/employees'));
  log('✅ Route loaded: /api/employees');
} catch (e) { log(`❌ employees route error: ${e.message}`); }

try {
  app.use('/api/payroll',      require('./routes/payroll'));
  log('✅ Route loaded: /api/payroll');
} catch (e) { log(`❌ payroll route error: ${e.message}`); }

try {
  app.use('/api/departments',  require('./routes/departments'));
  log('✅ Route loaded: /api/departments');
} catch (e) { log(`❌ departments route error: ${e.message}`); }

try {
  app.use('/api/tax-settings', require('./routes/taxSettings'));
  log('✅ Route loaded: /api/tax-settings');
} catch (e) { log(`❌ taxSettings route error: ${e.message}`); }

// ── Dashboard stats ──────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    const { pool } = require('./config/db');
    const currentMonth = new Date().getMonth() + 1;
    const currentYear  = new Date().getFullYear();

    const [[empStats]]    = await pool.query('SELECT COUNT(*) as total, SUM(status="active") as active, SUM(status="inactive") as inactive FROM employees');
    const [[payrollMonth]]= await pool.query(
      `SELECT COUNT(*) as processed, COALESCE(SUM(net_salary),0) as total_net,
              SUM(payment_status="paid") as paid, SUM(payment_status="pending") as pending
       FROM payroll_records WHERE month=? AND year=?`,
      [currentMonth, currentYear]
    );
    const [[deptCount]]   = await pool.query('SELECT COUNT(*) as total FROM departments');
    const [recentPayroll] = await pool.query(
      `SELECT pr.id, e.name, e.employee_id as emp_code, pr.net_salary,
              pr.payment_status, pr.month, pr.year
       FROM payroll_records pr JOIN employees e ON pr.employee_id = e.id
       ORDER BY pr.created_at DESC LIMIT 5`
    );
    const [monthly] = await pool.query(
      `SELECT month, SUM(gross_salary) as total_gross, SUM(total_deductions) as total_deductions,
              SUM(net_salary) as total_net, COUNT(*) as employee_count
       FROM payroll_records WHERE year=? AND payment_status='paid'
       GROUP BY month ORDER BY month`,
      [currentYear]
    );
    const [deptSummary] = await pool.query(
      `SELECT d.name as department, SUM(pr.net_salary) as total_net,
              COUNT(DISTINCT pr.employee_id) as employee_count
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE pr.year=? AND pr.payment_status='paid'
       GROUP BY d.name`,
      [currentYear]
    );

    res.json({
      success: true,
      data: {
        employees: empStats,
        currentMonthPayroll: payrollMonth,
        departments: deptCount.total,
        recentPayroll,
        monthly,
        deptSummary,
        currentMonth,
        currentYear
      }
    });
  } catch (err) {
    log(`Dashboard error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 404 handler ──────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler ─────────────────────────────────
app.use((err, req, res, next) => {
  log(`Unhandled error: ${err.message}\n${err.stack}`);
  res.status(500).json({ success: false, message: 'Internal server error', detail: err.message });
});

// ── Start server ─────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5000;
app.listen(PORT, '0.0.0.0', () => {
  log(`🚀 Server running on port ${PORT}`);
  log(`❤️  Health check: /api/health`);
  log(`🔍 View logs:    /api/debug/logs`);
});

// ── Catch uncaught exceptions ────────────────────────────
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}`);
});
process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${reason}`);
});
