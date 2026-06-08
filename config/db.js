const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

// ── Logger ──────────────────────────────────────────────
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function writeLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(path.join(logDir, 'app.log'), line);
  } catch (_) {}
}

// ── Validate env vars ────────────────────────────────────
const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  writeLog(`FATAL: Missing env variables: ${missing.join(', ')}`);
  writeLog('Copy .env.example to .env and fill in your database credentials');
  process.exit(1);
}

writeLog(`DB connecting → host=${process.env.DB_HOST} db=${process.env.DB_NAME} user=${process.env.DB_USER}`);

// ── Pool ────────────────────────────────────────────────
const pool = mysql.createPool({
  host:            process.env.DB_HOST,
  port:            parseInt(process.env.DB_PORT) || 3306,
  user:            process.env.DB_USER,
  password:        process.env.DB_PASSWORD,
  database:        process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  connectTimeout:     30000,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 10000
});

const promisePool = pool.promise();

// ── Test connection on startup ───────────────────────────
pool.getConnection((err, connection) => {
  if (err) {
    writeLog(`DB CONNECTION FAILED: ${err.message}`);
    writeLog(`Error code: ${err.code}`);
    if (err.code === 'ENOTFOUND') {
      writeLog('→ DB_HOST is wrong. Check phpMyAdmin URL bar for correct hostname.');
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      writeLog('→ DB_USER or DB_PASSWORD is wrong.');
    } else if (err.code === 'ER_BAD_DB_ERROR') {
      writeLog('→ DB_NAME does not exist. Create the database in InfinityFree first.');
    } else if (err.code === 'ETIMEDOUT') {
      writeLog('→ Connection timed out. InfinityFree may be blocking external connections.');
      writeLog('→ Try setting DB_HOST to the IP address instead of hostname.');
    }
    return;
  }
  writeLog('✅ MySQL connected successfully');
  connection.query('SELECT 1 AS ping', (qErr, rows) => {
    connection.release();
    if (qErr) {
      writeLog(`DB query test failed: ${qErr.message}`);
    } else {
      writeLog('✅ Database query test passed');
    }
  });
});

// ── Handle pool errors gracefully ───────────────────────
pool.on('error', (err) => {
  writeLog(`DB pool error: ${err.message}`);
});

module.exports = { pool: promisePool, writeLog };
