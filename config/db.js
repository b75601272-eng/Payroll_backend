const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

// ── Logger ───────────────────────────────────────────────
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(path.join(logDir, 'app.log'), line); } catch (_) {}
}

// ── Validate env ─────────────────────────────────────────
const required = ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME'];
const missing  = required.filter(k => !process.env[k]);
if (missing.length) {
  log(`FATAL: Missing env variables: ${missing.join(', ')}`);
  process.exit(1);
}

log(`DB connecting → host=${process.env.DB_HOST} db=${process.env.DB_NAME}`);

// ── Pool ─────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:      { rejectUnauthorized: false },  // required for Render PostgreSQL
  max:                10,
  idleTimeoutMillis:  30000,
  connectionTimeoutMillis: 10000
});

// ── Test connection + create tables ─────────────────────
async function initDB() {
  let client;
  try {
    client = await pool.connect();
    log('✅ PostgreSQL connected successfully');

    // Create all tables if they don't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id            SERIAL PRIMARY KEY,
        employee_id   VARCHAR(20) UNIQUE NOT NULL,
        name          VARCHAR(150) NOT NULL,
        email         VARCHAR(200) UNIQUE NOT NULL,
        phone         VARCHAR(20),
        department_id INT REFERENCES departments(id) ON DELETE SET NULL,
        designation   VARCHAR(100),
        base_salary   DECIMAL(12,2) NOT NULL DEFAULT 0,
        hra_percent   DECIMAL(5,2)  DEFAULT 40,
        da_percent    DECIMAL(5,2)  DEFAULT 20,
        ta_fixed      DECIMAL(10,2) DEFAULT 1600,
        ma_fixed      DECIMAL(10,2) DEFAULT 1250,
        joining_date  DATE NOT NULL,
        status        VARCHAR(20)   DEFAULT 'active',
        bank_account  VARCHAR(30),
        bank_name     VARCHAR(100),
        pan_number    VARCHAR(20),
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tax_settings (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        tax_type    VARCHAR(10)  NOT NULL,
        rate        DECIMAL(5,2) NOT NULL,
        min_salary  DECIMAL(12,2) DEFAULT 0,
        max_salary  DECIMAL(12,2),
        is_active   BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_records (
        id               SERIAL PRIMARY KEY,
        employee_id      INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        month            INT NOT NULL,
        year             INT NOT NULL,
        base_salary      DECIMAL(12,2) NOT NULL,
        hra              DECIMAL(12,2) DEFAULT 0,
        da               DECIMAL(12,2) DEFAULT 0,
        ta               DECIMAL(12,2) DEFAULT 0,
        ma               DECIMAL(12,2) DEFAULT 0,
        other_allowances DECIMAL(12,2) DEFAULT 0,
        gross_salary     DECIMAL(12,2) NOT NULL,
        pt_deduction     DECIMAL(10,2) DEFAULT 0,
        ss_deduction     DECIMAL(10,2) DEFAULT 0,
        it_deduction     DECIMAL(10,2) DEFAULT 0,
        other_deductions DECIMAL(10,2) DEFAULT 0,
        total_deductions DECIMAL(12,2) DEFAULT 0,
        net_salary       DECIMAL(12,2) NOT NULL,
        payment_status   VARCHAR(20)   DEFAULT 'pending',
        payment_date     DATE,
        remarks          TEXT,
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id, month, year)
      );
    `);

    log('✅ All tables ready');

    // Seed default data only if empty
    const { rows: deptRows } = await client.query('SELECT COUNT(*) as c FROM departments');
    if (parseInt(deptRows[0].c) === 0) {
      await client.query(`
        INSERT INTO departments (name) VALUES
          ('Engineering'),('Marketing'),('Human Resources'),('Finance'),('Operations')
      `);
      log('✅ Default departments seeded');
    }

    const { rows: taxRows } = await client.query('SELECT COUNT(*) as c FROM tax_settings');
    if (parseInt(taxRows[0].c) === 0) {
      await client.query(`
        INSERT INTO tax_settings (name, tax_type, rate, min_salary, max_salary) VALUES
          ('Professional Tax',   'PT', 2.00,  10000,  NULL),
          ('Social Security',    'SS', 1.75,  0,      NULL),
          ('Income Tax (0%)',    'IT', 0.00,  0,      250000),
          ('Income Tax (5%)',    'IT', 5.00,  250001, 500000),
          ('Income Tax (10%)',   'IT', 10.00, 500001, 750000),
          ('Income Tax (15%)',   'IT', 15.00, 750001, 1000000),
          ('Income Tax (20%)',   'IT', 20.00, 1000001,NULL)
      `);
      log('✅ Default tax settings seeded');
    }

    const { rows: empRows } = await client.query('SELECT COUNT(*) as c FROM employees');
    if (parseInt(empRows[0].c) === 0) {
      await client.query(`
        INSERT INTO employees (employee_id,name,email,phone,department_id,designation,base_salary,joining_date) VALUES
          ('EMP001','Rahul Sharma', 'rahul.sharma@company.com', '9876543210',1,'Software Engineer',65000,'2023-01-15'),
          ('EMP002','Priya Patel',  'priya.patel@company.com',  '9876543211',2,'Marketing Manager', 55000,'2022-06-01'),
          ('EMP003','Amit Kumar',   'amit.kumar@company.com',   '9876543212',4,'Accountant',         45000,'2021-09-10'),
          ('EMP004','Sunita Reddy', 'sunita.reddy@company.com', '9876543213',3,'HR Executive',       40000,'2023-03-20'),
          ('EMP005','Vikram Singh', 'vikram.singh@company.com', '9876543214',1,'Senior Developer',   85000,'2020-11-05')
      `);
      log('✅ Sample employees seeded');
    }

  } catch (err) {
    log(`DB INIT ERROR: ${err.message}`);
    if (err.message.includes('connect')) {
      log('→ Check DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in environment variables');
    }
  } finally {
    if (client) client.release();
  }
}

initDB();

pool.on('error', (err) => log(`DB pool error: ${err.message}`));

module.exports = { pool, log };
