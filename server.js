const express = require('express');
const mariadb = require('mariadb');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const Groq = require('groq-sdk');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { sendQueueNotificationEmail } = require('./mailHelper');

dotenv.config();
const app = express();
const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;

app.use(session({
  name: 'careflow.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax'
  }
}));
app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});
app.use(express.json());
app.use(passport.initialize());


const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  bigIntAsNumber: true
});

async function testDb() {
  let conn;

  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT 1 AS connected');
    console.log('DB connected:', rows);
  } catch (err) {
    console.error('DB connection failed:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

testDb();
// console.log(process.env.DB_HOST, process.env.DB_PORT, process.env.DB_USER, process.env.DB_PASSWORD, process.env.DB_NAME);

console.log("this is the right file. ");

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

function normalizeAge(age) {
  const value = Number(age);
  return Number.isInteger(value) && value >= 0 && value <= 130 ? value : null;
}

function normalizeGender(gender) {
  const allowed = new Set(['Female', 'Male', 'Non-binary', 'Prefer not to say']);
  const value = String(gender || '').trim();
  return allowed.has(value) ? value : null;
}

function normalizeRoomNumber(roomNumber) {
  const value = String(roomNumber || '').trim();
  if (!value || value.length > 30) return null;
  return value;
}

function formatSubdepartmentDestination(name, roomNumber) {
  const cleanName = String(name || '').trim();
  const cleanRoom = String(roomNumber || '').trim();
  if (cleanName && cleanRoom) return `${cleanName}, Room ${cleanRoom}`;
  return cleanName || (cleanRoom ? `Room ${cleanRoom}` : '');
}

const QUEUE_INSERT_COLUMNS = new Set([
  'full_name',
  'user_id',
  'department_id',
  'counter_id',
  'subdepartment_id',
  'transfer_group_id',
  'code',
  'category',
  'status',
  'visit_description',
  'ai_suggested_department',
  'ai_category',
  'ai_priority_level',
  'ai_reason',
  'is_priority',
  'is_emergency',
  'created_at',
  'called_at',
  'finished_at',
  'referred_from_queue_id',
  'transfer_reason',
  'transferred_by_user_id',
  'transferred_at',
  'preferred_doctor_user_id',
  'age',
  'gender',
  'visit_id'
]);

function buildQueueInsert(fields) {
  const columns = Object.keys(fields).filter((column) => fields[column] !== undefined);
  const values = columns.map((column) => fields[column]);

  if (!columns.length) {
    throw new Error('Queue insert requires at least one column.');
  }

  const invalidColumn = columns.find((column) => !QUEUE_INSERT_COLUMNS.has(column));
  if (invalidColumn) {
    throw new Error(`Invalid queues column: ${invalidColumn}`);
  }

  if (columns.length !== values.length) {
    throw new Error(`Queue insert mismatch: ${columns.length} columns for ${values.length} values.`);
  }

  const columnSql = columns.map((column) => `\`${column}\``).join(', ');
  const placeholders = columns.map(() => '?').join(', ');

  return {
    sql: `INSERT INTO queues (${columnSql}) VALUES (${placeholders})`,
    values
  };
}

function insertQueue(conn, fields) {
  const insert = buildQueueInsert(fields);
  return conn.execute(insert.sql, insert.values);
}

function googleAuthConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CALLBACK_URL
  );
}

function redirectPathForRole(role) {
  if (role === 'doctor') return '/doctor';
  return ['owner', 'admin', 'staff'].includes(role) ? '/' : '/queue';
}

async function buildUniqueUsername(conn, email) {
  const prefix = String(email || 'google-user')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32) || 'googleuser';
  let username = prefix;
  let suffix = 0;

  while (true) {
    const [existing] = await conn.execute(
      'SELECT user_id FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    if (!existing) return username;

    suffix += 1;
    username = `${prefix}${suffix}`;
  }
}

async function findOrCreateGoogleUser(profile) {
  const email = normalizeEmail(profile.emails && profile.emails[0] && profile.emails[0].value);
  const googleId = profile.id ? String(profile.id) : null;
  const displayName = String(profile.displayName || '').trim();
  const emailVerified = profile._json && profile._json.email_verified !== false;

  if (!email || !googleId || !emailVerified) {
    const err = new Error('Google account must provide a verified email');
    err.statusCode = 400;
    throw err;
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [existingByGoogleId] = await conn.execute(
      `SELECT user_id, role, department_id
       FROM users
       WHERE google_id = ?
       FOR UPDATE`,
      [googleId]
    );

    if (existingByGoogleId) {
      await conn.execute(
        `UPDATE users
         SET email = COALESCE(email, ?),
             auth_provider = CASE
               WHEN auth_provider = 'local' THEN 'google'
               ELSE auth_provider
             END
         WHERE user_id = ?`,
        [email, existingByGoogleId.user_id]
      );
      await conn.commit();
      return existingByGoogleId;
    }

    const [existingByEmail] = await conn.execute(
      `SELECT user_id, role, department_id
       FROM users
       WHERE email = ?
       FOR UPDATE`,
      [email]
    );

    if (existingByEmail) {
      await conn.execute(
        `UPDATE users
         SET google_id = ?,
             auth_provider = CASE
               WHEN auth_provider = 'local' THEN 'google'
               ELSE auth_provider
             END
         WHERE user_id = ?`,
        [googleId, existingByEmail.user_id]
      );
      await conn.commit();
      return existingByEmail;
    }

    const username = await buildUniqueUsername(conn, email);
    const passwordHash = await bcrypt.hash(`google:${googleId}:${Date.now()}`, 10);
    const result = await conn.execute(
      `INSERT INTO users
       (username, email, google_id, auth_provider, password_hash, full_name, role)
       VALUES (?, ?, ?, 'google', ?, ?, 'patient')`,
      [username, email, googleId, passwordHash, displayName || username]
    );

    await conn.commit();

    return {
      user_id: Number(result.insertId),
      role: 'patient',
      department_id: null
    };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

async function logEmailNotification({ queueId, actorUserId, departmentId, action, details }) {
  let conn;

  try {
    conn = await pool.getConnection();
    await logQueueAction(conn, {
      queue_id: queueId,
      actor_user_id: actorUserId,
      department_id: departmentId,
      action,
      details
    });
  } catch (err) {
    console.error('Queue email notification log failed:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

function queueNotificationEmail(notification) {
  if (!notification || !notification.to) return;

  setImmediate(async () => {
    try {
      await sendQueueNotificationEmail(notification);
      await logEmailNotification({
        queueId: notification.queueId,
        actorUserId: notification.actorUserId,
        departmentId: notification.departmentId,
        action: 'email_notification_sent',
        details: {
          type: notification.type,
          to: notification.to,
          queue_code: notification.queueCode
        }
      });
    } catch (err) {
      console.error('Queue email notification failed:', err.message);
      await logEmailNotification({
        queueId: notification.queueId,
        actorUserId: notification.actorUserId,
        departmentId: notification.departmentId,
        action: 'email_notification_failed',
        details: {
          type: notification.type,
          to: notification.to,
          queue_code: notification.queueCode,
          error: err.message
        }
      });
    }
  });
}

if (googleAuthConfigured()) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      await ensureAuthSchema();
      const user = await findOrCreateGoogleUser(profile);
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));
} else {
  console.warn('Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL to enable it.');
}

function reqOwner(req, res, next) {
  if (!req.session || req.session.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access only' });
  }

  next();
}

function reqAdmin(req, res, next) {
  if (!req.session || !['owner', 'admin'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Admin access only' });
  }

  next();
}

function reqStaffOrAdmin(req, res, next) {
  if (!req.session || !['owner', 'admin', 'staff'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Staff access only' });
  }

  next();
}

function reqDoctor(req, res, next) {
  if (!req.session || req.session.role !== 'doctor') {
    return res.status(403).json({ error: 'Doctor access only' });
  }

  next();
}

function reqLogin(req, res, next) {
  if (!req.session || !req.session.uid) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return res.redirect('/login');
  }
  next();
}

function canAccessDepartment(req, departmentId) {
  if (['owner', 'admin'].includes(req.session.role)) {
    return true;
  }

  if (['staff', 'doctor'].includes(req.session.role)) {
    return Number(req.session.department_id) === Number(departmentId);
  }

  return false;
}

function normalizeSchedulePayload(body) {
  const departmentId = Number(body.departmentId || body.department_id);
  const dayOfWeek = Number(body.dayOfWeek ?? body.day_of_week);
  const isClosed = !!body.isClosed || body.is_closed === true || body.is_closed === 'true' || body.is_closed === 1 || body.is_closed === '1';
  const opensAt = body.opensAt || body.opens_at || null;
  const closesAt = body.closesAt || body.closes_at || null;
  const note = body.note ? String(body.note).trim().slice(0, 255) : null;
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

  if (!departmentId) {
    return { error: 'Department is required' };
  }

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return { error: 'Day of week is required' };
  }

  if (!isClosed) {
    if (!opensAt || !closesAt) {
      return { error: 'Open and close times are required' };
    }

    if (!timePattern.test(opensAt) || !timePattern.test(closesAt)) {
      return { error: 'Use valid open and close times' };
    }

    if (closesAt <= opensAt) {
      return { error: 'Close time must be after open time' };
    }
  }

  return {
    departmentId,
    dayOfWeek,
    opensAt: isClosed ? null : opensAt,
    closesAt: isClosed ? null : closesAt,
    isClosed,
    note
  };
}

async function logQueueAction(conn, { queue_id = null, actor_user_id = null, department_id = null, action, details = null }) {
  if (!conn) throw new Error('Database connection is required for queue logging');
  if (!action) throw new Error('Queue log action is required');

  const detailText = details && typeof details === 'object'
    ? JSON.stringify(details)
    : details;

  await conn.execute(
    `INSERT INTO queue_logs
     (queue_id, actor_user_id, department_id, action, details)
     VALUES (?, ?, ?, ?, ?)`,
    [
      queue_id || null,
      actor_user_id || null,
      department_id || null,
      action,
      detailText || null
    ]
  );
}

function queueCodeSql(departmentAlias = 'd', visitAlias = 'v', queueAlias = 'q') {
  return `COALESCE(NULLIF(${queueAlias}.code, ''), CONCAT(${departmentAlias}.code, LPAD(${visitAlias}.global_number, 3, '0')))`;
}

function formatQueueCode(departmentCode, globalNumber) {
  return String(departmentCode || '') + String(Number(globalNumber || 0)).padStart(3, '0');
}

async function createVisit(conn, userId) {
  await conn.execute(
    `INSERT INTO visit_daily_counters (date, last_number)
     VALUES (CURDATE(), 1)
     ON DUPLICATE KEY UPDATE last_number = last_number + 1`
  );

  const [counter] = await conn.execute(
    `SELECT last_number
     FROM visit_daily_counters
     WHERE date = CURDATE()
     FOR UPDATE`
  );

  const globalNumber = Number(counter.last_number);

  const insert = await conn.execute(
    `INSERT INTO visits (user_id, visit_date, global_number, status)
     VALUES (?, CURDATE(), ?, 'active')`,
    [userId, globalNumber]
  );

  return {
    visit_id: Number(insert.insertId),
    global_number: globalNumber
  };
}

async function getOrCreateActiveVisit(conn, userId) {
  const [activeVisit] = await conn.execute(
    `SELECT visit_id, global_number
     FROM visits
     WHERE user_id = ?
       AND status = 'active'
     ORDER BY created_at DESC, visit_id DESC
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );

  if (activeVisit) {
    return {
      visit_id: Number(activeVisit.visit_id),
      global_number: Number(activeVisit.global_number)
    };
  }

  return createVisit(conn, userId);
}

async function updateVisitStatus(conn, visitId) {
  if (!visitId) return;

  const [summary] = await conn.execute(
    `SELECT
        SUM(status IN ('waiting', 'serving')) AS active_count,
        SUM(status = 'cancelled') AS cancelled_count,
        SUM(status IN ('done', 'no_show', 'void')) AS terminal_count
     FROM queues
     WHERE visit_id = ?`,
    [visitId]
  );

  const [subdepartmentSummary] = await conn.execute(
    `SELECT COUNT(*) AS active_count
     FROM queue_subdepartment_requirements r
     JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
     JOIN queues q ON q.queue_id = qt.queue_id
     WHERE q.visit_id = ?
       AND qt.status = 'in_subdepartment'
       AND r.status IN ('queued', 'serving')`,
    [visitId]
  );

  const activeCount = Number(summary && summary.active_count || 0)
    + Number(subdepartmentSummary && subdepartmentSummary.active_count || 0);
  const cancelledCount = Number(summary && summary.cancelled_count || 0);
  const terminalCount = Number(summary && summary.terminal_count || 0);
  const status = activeCount > 0
    ? 'active'
    : cancelledCount > 0 && terminalCount === 0
      ? 'cancelled'
      : terminalCount > 0
        ? 'completed'
        : 'active';

  await conn.execute(
    `UPDATE visits
     SET status = ?
     WHERE visit_id = ?`,
    [status, visitId]
  );
}

let queueTransferSchemaReady = false;
let authSchemaReady = false;
let subdepartmentSchemaReady = false;
let preferredDoctorSchemaReady = false;
let departmentSchemaReady = false;

function normalizeDepartmentImageUrl(value) {
  const imageUrl = String(value || '').trim();
  if (!imageUrl) return null;

  if (imageUrl.length > 1000) {
    return null;
  }

  if (/["'()\\<>\n\r]/.test(imageUrl)) {
    return null;
  }

  if (/^https?:\/\/\S+$/i.test(imageUrl) || /^\/[^\s]*$/.test(imageUrl)) {
    return imageUrl;
  }

  return null;
}

async function ensureDepartmentSchema() {
  if (departmentSchemaReady) return;

  let conn;

  try {
    conn = await pool.getConnection();

    const [imageColumn] = await conn.execute(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'departments'
         AND column_name = 'image_url'
       LIMIT 1`
    );

    if (!imageColumn) {
      await conn.execute('ALTER TABLE departments ADD COLUMN image_url VARCHAR(1000) NULL AFTER queue_status');
    }

    departmentSchemaReady = true;
  } catch (err) {
    console.error('Department schema setup failed:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

async function ensureAuthSchema() {
  if (authSchemaReady) return;

  let conn;

  try {
    conn = await pool.getConnection();

    const requiredColumns = [
      ['email', 'VARCHAR(255) NULL'],
      ['google_id', 'VARCHAR(255) NULL'],
      ['auth_provider', "VARCHAR(50) DEFAULT 'local'"],
      ['gender', 'VARCHAR(30) NULL']
    ];

    for (const [columnName, definition] of requiredColumns) {
      const [column] = await conn.execute(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'users'
           AND column_name = ?
         LIMIT 1`,
        [columnName]
      );

      if (!column) {
        await conn.execute(`ALTER TABLE users ADD COLUMN ${columnName} ${definition}`);
      }
    }

    const uniqueIndexes = [
      ['unique_users_email', 'email'],
      ['unique_users_google_id', 'google_id']
    ];

    for (const [indexName, columnName] of uniqueIndexes) {
      const [index] = await conn.execute(
        `SELECT 1
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = 'users'
           AND index_name = ?
         LIMIT 1`,
        [indexName]
      );

      if (!index) {
        await conn.execute(`CREATE UNIQUE INDEX ${indexName} ON users(${columnName})`);
      }
    }

    authSchemaReady = true;
  } catch (err) {
    console.error('Auth schema setup failed:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

let demographicSchemaReady = false;

async function ensureDemographicSchema() {
  if (demographicSchemaReady) return;

  let conn;

  try {
    conn = await pool.getConnection();

    const queueColumns = [
      ['age', 'INT NULL'],
      ['gender', 'VARCHAR(30) NULL']
    ];

    for (const [columnName, definition] of queueColumns) {
      const [column] = await conn.execute(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'queues'
           AND column_name = ?
         LIMIT 1`,
        [columnName]
      );

      if (!column) {
        await conn.execute(`ALTER TABLE queues ADD COLUMN ${columnName} ${definition}`);
      }
    }

    demographicSchemaReady = true;
  } catch (err) {
    console.error('Demographic schema setup failed:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

async function ensurePreferredDoctorSchema() {
  if (preferredDoctorSchemaReady) return;

  let conn;

  try {
    conn = await pool.getConnection();

    const [column] = await conn.execute(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'queues'
         AND column_name = 'preferred_doctor_user_id'
       LIMIT 1`
    );

    if (!column) {
      await conn.execute('ALTER TABLE queues ADD COLUMN preferred_doctor_user_id INT NULL AFTER transferred_at');
    }

    const [index] = await conn.execute(
      `SELECT 1
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = 'queues'
         AND index_name = 'idx_queues_preferred_doctor'
       LIMIT 1`
    );

    if (!index) {
      await conn.execute('CREATE INDEX idx_queues_preferred_doctor ON queues(preferred_doctor_user_id)');
    }

    const [fk] = await conn.execute(
      `SELECT 1
       FROM information_schema.table_constraints
       WHERE constraint_schema = DATABASE()
         AND table_name = 'queues'
         AND constraint_name = 'fk_queues_preferred_doctor'
       LIMIT 1`
    );

    if (!fk) {
      await conn.execute(
        `ALTER TABLE queues
         ADD CONSTRAINT fk_queues_preferred_doctor
         FOREIGN KEY (preferred_doctor_user_id)
         REFERENCES users(user_id)
         ON DELETE SET NULL`
      );
    }

    preferredDoctorSchemaReady = true;
  } catch (err) {
    console.error('Preferred doctor schema setup failed:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

async function ensureSubdepartmentSchema() {
  if (subdepartmentSchemaReady) return;

  let conn;

  try {
    conn = await pool.getConnection();

    const [roomColumn] = await conn.execute(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'subdepartments'
         AND column_name = 'room_number'
       LIMIT 1`
    );

    if (!roomColumn) {
      await conn.execute('ALTER TABLE subdepartments ADD COLUMN room_number VARCHAR(30) NULL AFTER name');
    }

    subdepartmentSchemaReady = true;
  } catch (err) {
    console.error('Subdepartment schema setup failed:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

async function ensureQueueTransferSchema() {
  if (queueTransferSchemaReady) return;

  let conn;

  try {
    conn = await pool.getConnection();

    const requiredColumns = [
      ['referred_from_queue_id', 'INT NULL'],
      ['transfer_reason', 'TEXT NULL'],
      ['transferred_by_user_id', 'INT NULL'],
      ['transferred_at', 'DATETIME NULL'],
      ['age', 'INT NULL'],
      ['gender', 'VARCHAR(30) NULL']
    ];

    for (const [columnName, definition] of requiredColumns) {
      const [column] = await conn.execute(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'queues'
           AND column_name = ?
         LIMIT 1`,
        [columnName]
      );

      if (!column) {
        await conn.execute(`ALTER TABLE queues ADD COLUMN ${columnName} ${definition}`);
      }
    }

    const [referredFromFk] = await conn.execute(
      `SELECT 1
       FROM information_schema.table_constraints
       WHERE constraint_schema = DATABASE()
         AND table_name = 'queues'
         AND constraint_name = 'fk_queues_referred_from'
       LIMIT 1`
    );

    if (!referredFromFk) {
      await conn.execute(
        `ALTER TABLE queues
         ADD CONSTRAINT fk_queues_referred_from
         FOREIGN KEY (referred_from_queue_id)
         REFERENCES queues(queue_id)
         ON DELETE SET NULL`
      );
    }

    const [transferredByFk] = await conn.execute(
      `SELECT 1
       FROM information_schema.table_constraints
       WHERE constraint_schema = DATABASE()
         AND table_name = 'queues'
         AND constraint_name = 'fk_queues_transferred_by'
       LIMIT 1`
    );

    if (!transferredByFk) {
      await conn.execute(
        `ALTER TABLE queues
         ADD CONSTRAINT fk_queues_transferred_by
         FOREIGN KEY (transferred_by_user_id)
         REFERENCES users(user_id)
         ON DELETE SET NULL`
      );
    }

    const [referredFromIndex] = await conn.execute(
      `SELECT 1
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = 'queues'
         AND index_name = 'idx_queue_referred_from'
       LIMIT 1`
    );

    if (!referredFromIndex) {
      await conn.execute('CREATE INDEX idx_queue_referred_from ON queues(referred_from_queue_id)');
    }

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS queue_transfers (
         transfer_id INT AUTO_INCREMENT PRIMARY KEY,
         queue_id INT NOT NULL,
         from_department_id INT NOT NULL,
         to_department_id INT NOT NULL,
         status ENUM('waiting_department_call','in_subdepartment','completed','cancelled') NOT NULL DEFAULT 'waiting_department_call',
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         called_at DATETIME NULL,
         completed_at DATETIME NULL,
         KEY idx_queue_transfers_queue (queue_id),
         KEY idx_queue_transfers_status (status),
         KEY idx_queue_transfers_target_status (to_department_id, status),
         CONSTRAINT fk_queue_transfers_queue
           FOREIGN KEY (queue_id) REFERENCES queues(queue_id) ON DELETE CASCADE,
         CONSTRAINT fk_queue_transfers_from_department
           FOREIGN KEY (from_department_id) REFERENCES departments(department_id) ON DELETE RESTRICT,
         CONSTRAINT fk_queue_transfers_to_department
           FOREIGN KEY (to_department_id) REFERENCES departments(department_id) ON DELETE RESTRICT
       ) ENGINE=InnoDB`
    );

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS queue_subdepartment_requirements (
         requirement_id INT AUTO_INCREMENT PRIMARY KEY,
         transfer_id INT NOT NULL,
         subdepartment_id INT NOT NULL,
         status ENUM('pending','queued','serving','done','skipped') NOT NULL DEFAULT 'pending',
         queued_at DATETIME NULL,
         called_at DATETIME NULL,
         finished_at DATETIME NULL,
         KEY idx_queue_subdepartment_requirements_transfer_status (transfer_id, status),
         KEY idx_queue_subdepartment_requirements_subdepartment_status (subdepartment_id, status),
         CONSTRAINT fk_queue_subdepartment_requirements_transfer
           FOREIGN KEY (transfer_id) REFERENCES queue_transfers(transfer_id) ON DELETE CASCADE,
         CONSTRAINT fk_queue_subdepartment_requirements_subdepartment
           FOREIGN KEY (subdepartment_id) REFERENCES subdepartments(subdepartment_id) ON DELETE RESTRICT
       ) ENGINE=InnoDB`
    );

    const transferRequirementIndexes = [
      {
        name: 'idx_qsr_subdepartment_status_queued',
        sql: 'CREATE INDEX idx_qsr_subdepartment_status_queued ON queue_subdepartment_requirements(subdepartment_id, status, queued_at)'
      },
      {
        name: 'idx_qsr_transfer_status_subdepartment',
        sql: 'CREATE INDEX idx_qsr_transfer_status_subdepartment ON queue_subdepartment_requirements(transfer_id, status, subdepartment_id)'
      }
    ];

    for (const index of transferRequirementIndexes) {
      const [existingIndex] = await conn.execute(
        `SELECT 1
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = 'queue_subdepartment_requirements'
           AND index_name = ?
         LIMIT 1`,
        [index.name]
      );

      if (!existingIndex) {
        await conn.execute(index.sql);
      }
    }

    queueTransferSchemaReady = true;
  } catch (err) {
    console.error('Queue transfer schema setup failed:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

function buildTransferVisitDescription(sourceDescription, reason) {
  const cleanSource = String(sourceDescription || '').trim();
  const cleanReason = String(reason || '').trim();

  if (!cleanReason) return cleanSource || 'Transferred from completed queue';
  if (!cleanSource) return `Referral note: ${cleanReason}`;
  return `${cleanSource}\n\nReferral note: ${cleanReason}`;
}

async function performQueueTransfer(req, { queue_id, target_department_id, reason }) {
  const sourceQueueId = Number(queue_id);
  const targetDepartmentId = Number(target_department_id);
  const transferReason = String(reason || '').trim();

  if (!sourceQueueId) {
    return { status: 400, body: { success: false, message: 'queue_id is required.' } };
  }

  if (!targetDepartmentId) {
    return { status: 400, body: { success: false, message: 'target_department_id is required.' } };
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [sourceQueue] = await conn.execute(
      `SELECT q.queue_id,
              q.visit_id,
              ${queueCodeSql('d', 'v')} AS code,
              v.global_number,
              q.user_id,
              q.department_id,
              q.full_name,
              q.category,
              q.visit_description,
              q.status,
              q.is_priority,
              q.is_emergency,
              q.ai_suggested_department,
              q.ai_category,
              q.ai_priority_level,
              q.ai_reason,
              d.name AS source_department_name
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE q.queue_id = ?
       FOR UPDATE`,
      [sourceQueueId]
    );

    if (!sourceQueue) {
      await conn.rollback();
      return { status: 404, body: { success: false, message: 'Source queue was not found.' } };
    }

    if (!canAccessDepartment(req, sourceQueue.department_id)) {
      await conn.rollback();
      return { status: 403, body: { success: false, message: 'You cannot transfer this queue entry.' } };
    }

    if (sourceQueue.status !== 'done') {
      await conn.rollback();
      return { status: 400, body: { success: false, message: 'Only completed queues can be transferred.' } };
    }

    if (Number(sourceQueue.department_id) === targetDepartmentId) {
      await conn.rollback();
      return { status: 400, body: { success: false, message: 'Transfer to the same department is not allowed.' } };
    }

    const [existingTransfer] = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE q.referred_from_queue_id = ?
       LIMIT 1`,
      [sourceQueueId]
    );

    if (existingTransfer) {
      await conn.rollback();
      return {
        status: 409,
        body: {
          success: false,
          message: 'This queue has already been transferred.',
          queue_id: existingTransfer.queue_id,
          code: existingTransfer.code
        }
      };
    }

    const [targetDepartment] = await conn.execute(
      `SELECT department_id, name, code, queue_status
       FROM departments
       WHERE department_id = ?
       FOR UPDATE`,
      [targetDepartmentId]
    );

    if (!targetDepartment) {
      await conn.rollback();
      return { status: 404, body: { success: false, message: 'Target department was not found.' } };
    }

    if (targetDepartment.queue_status !== 'open') {
      await conn.rollback();
      return {
        status: 400,
        body: {
          success: false,
          message: 'Target department is not accepting new queues.',
          department_status: targetDepartment.queue_status
        }
      };
    }

    const code = formatQueueCode(targetDepartment.code, sourceQueue.global_number);
    const visitDescription = buildTransferVisitDescription(sourceQueue.visit_description, transferReason);

    const insert = await insertQueue(conn, {
      full_name: sourceQueue.full_name,
      user_id: sourceQueue.user_id,
      department_id: targetDepartmentId,
      visit_id: sourceQueue.visit_id,
      code,
      category: sourceQueue.category,
      status: 'waiting',
      visit_description: visitDescription,
      is_priority: sourceQueue.is_priority || 0,
      is_emergency: sourceQueue.is_emergency || 0,
      ai_suggested_department: sourceQueue.ai_suggested_department,
      ai_category: sourceQueue.ai_category,
      ai_priority_level: sourceQueue.ai_priority_level,
      ai_reason: sourceQueue.ai_reason,
      referred_from_queue_id: sourceQueue.queue_id,
      transfer_reason: transferReason || null,
      transferred_by_user_id: req.session.uid,
      transferred_at: new Date()
    });

    const newQueue = {
      queue_id: Number(insert.insertId),
      code,
      visit_id: sourceQueue.visit_id,
      full_name: sourceQueue.full_name,
      user_id: sourceQueue.user_id,
      department_id: targetDepartmentId,
      department_name: targetDepartment.name,
      category: sourceQueue.category,
      status: 'waiting',
      visit_description: visitDescription,
      referred_from_queue_id: sourceQueue.queue_id,
      transfer_reason: transferReason || null,
      transferred_by_user_id: req.session.uid
    };

    await logQueueAction(conn, {
      queue_id: sourceQueue.queue_id,
      actor_user_id: req.session.uid,
      department_id: sourceQueue.department_id,
      action: 'transferred',
      details: {
        source_queue_id: sourceQueue.queue_id,
        source_queue_code: sourceQueue.code,
        target_queue_id: newQueue.queue_id,
        target_queue_code: code,
        source_department_id: sourceQueue.department_id,
        source_department: sourceQueue.source_department_name,
        target_department_id: targetDepartmentId,
        target_department: targetDepartment.name,
        reason: transferReason || null
      }
    });

    await logQueueAction(conn, {
      queue_id: newQueue.queue_id,
      actor_user_id: req.session.uid,
      department_id: targetDepartmentId,
      action: 'queue_created_from_transfer',
      details: {
        source_queue_id: sourceQueue.queue_id,
        source_queue_code: sourceQueue.code,
        source_department_id: sourceQueue.department_id,
        source_department: sourceQueue.source_department_name,
        target_queue_code: code,
        reason: transferReason || null
      }
    });

    await updateVisitStatus(conn, sourceQueue.visit_id);

    await conn.commit();

    return {
      status: 200,
      body: {
        success: true,
        message: 'Patient transferred successfully.',
        queue: newQueue
      }
    };
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Queue transfer failed:', err);
    return {
      status: 500,
      body: {
        success: false,
        message: err.message || 'Queue transfer failed.'
      }
    };
  } finally {
    if (conn) conn.release();
  }
}

async function getCounterForAccess(conn, req, counterId) {
  const [counter] = await conn.execute(
    `SELECT c.counter_id, c.department_id, c.name, c.status, c.current_queue_id,
            d.name AS department_name, d.code AS department_code
     FROM counters c
     JOIN departments d ON d.department_id = c.department_id
     WHERE c.counter_id = ?
       AND c.deleted_at IS NULL
     LIMIT 1`,
    [counterId]
  );

  if (!counter) {
    return { errorStatus: 404, error: 'Counter not found' };
  }

  if (!canAccessDepartment(req, counter.department_id)) {
    return { errorStatus: 403, error: 'You cannot access this counter' };
  }

  return { counter };
}

async function getSubdepartmentForAccess(conn, req, subdepartmentId) {
  const [subdepartment] = await conn.execute(
    `SELECT sd.subdepartment_id, sd.department_id, sd.name, sd.room_number, sd.status, sd.current_queue_id,
            d.name AS department_name, d.code AS department_code
     FROM subdepartments sd
     JOIN departments d ON d.department_id = sd.department_id
     WHERE sd.subdepartment_id = ?
       AND sd.deleted_at IS NULL
     LIMIT 1`,
    [subdepartmentId]
  );

  if (!subdepartment) {
    return { errorStatus: 404, error: 'Subdepartment not found' };
  }

  if (!canAccessDepartment(req, subdepartment.department_id)) {
    return { errorStatus: 403, error: 'You cannot access this subdepartment' };
  }

  return { subdepartment };
}

async function getDoctorTransferDestinations(conn) {
  const departments = await conn.execute(
    `SELECT department_id, name, code, queue_status
     FROM departments
     WHERE queue_status = 'open'
       AND (UPPER(code) = 'LB' OR LOWER(name) = 'laboratory')
     ORDER BY name ASC`
  );

  const subdepartments = await conn.execute(
    `SELECT sd.subdepartment_id, sd.department_id, sd.name, sd.room_number, sd.status, sd.current_queue_id
     FROM subdepartments sd
     JOIN departments d ON d.department_id = sd.department_id
     WHERE d.queue_status = 'open'
       AND (UPPER(d.code) = 'LB' OR LOWER(d.name) = 'laboratory')
       AND sd.status = 'open'
       AND sd.deleted_at IS NULL
     ORDER BY sd.department_id ASC, sd.name ASC, sd.subdepartment_id ASC`
  );

  return { departments, subdepartments };
}

async function getQueueForTransfer(conn, queueId, lock = false) {
  const [queue] = await conn.execute(
    `SELECT q.queue_id,
            q.visit_id,
            ${queueCodeSql('d', 'v')} AS code,
            v.global_number,
            q.user_id,
            q.department_id,
            q.counter_id,
            q.subdepartment_id,
            q.full_name,
            q.category,
            q.visit_description,
            q.status,
            q.is_priority,
            q.is_emergency,
            q.age,
            q.gender,
            q.ai_suggested_department,
            q.ai_category,
            q.ai_priority_level,
            q.ai_reason,
            q.transfer_reason,
            d.name AS department_name,
            d.code AS department_code
     FROM queues q
     JOIN departments d ON d.department_id = q.department_id
     JOIN visits v ON v.visit_id = q.visit_id
     WHERE q.queue_id = ?
     ${lock ? 'FOR UPDATE' : ''}`,
    [queueId]
  );

  return queue || null;
}

async function getActiveQueueTransfer(conn, queueId, lock = false) {
  const [transfer] = await conn.execute(
    `SELECT transfer_id, queue_id, from_department_id, to_department_id,
            status, created_at, called_at, completed_at
     FROM queue_transfers
     WHERE queue_id = ?
       AND status IN ('waiting_department_call', 'in_subdepartment')
     ORDER BY transfer_id DESC
     LIMIT 1
     ${lock ? 'FOR UPDATE' : ''}`,
    [queueId]
  );

  return transfer || null;
}

async function insertTransferredQueue(conn, {
  sourceQueue,
  targetDepartment,
  reason = '',
  actorUserId = null
}) {
  const transferReason = String(reason || '').trim();
  const visitDescription = buildTransferVisitDescription(sourceQueue.visit_description, transferReason);
  const code = formatQueueCode(targetDepartment.code, sourceQueue.global_number);

  const insert = await insertQueue(conn, {
    full_name: sourceQueue.full_name,
    user_id: sourceQueue.user_id,
    department_id: targetDepartment.department_id,
    counter_id: null,
    subdepartment_id: null,
    visit_id: sourceQueue.visit_id,
    code,
    category: sourceQueue.category,
    status: 'waiting',
    visit_description: visitDescription,
    is_priority: sourceQueue.is_priority || 0,
    is_emergency: sourceQueue.is_emergency || 0,
    age: sourceQueue.age,
    gender: sourceQueue.gender,
    ai_suggested_department: sourceQueue.ai_suggested_department,
    ai_category: sourceQueue.ai_category,
    ai_priority_level: sourceQueue.ai_priority_level,
    ai_reason: sourceQueue.ai_reason,
    referred_from_queue_id: sourceQueue.queue_id,
    transfer_reason: transferReason || null,
    transferred_by_user_id: actorUserId || null,
    transferred_at: new Date()
  });

  return {
    queue_id: Number(insert.insertId),
    code,
    visit_id: sourceQueue.visit_id,
    full_name: sourceQueue.full_name,
    user_id: sourceQueue.user_id,
    department_id: targetDepartment.department_id,
    department_name: targetDepartment.name,
    counter_id: null,
    subdepartment_id: null,
    category: sourceQueue.category,
    status: 'waiting',
    visit_description: visitDescription,
    referred_from_queue_id: sourceQueue.queue_id,
    transfer_reason: transferReason || null,
    transferred_by_user_id: actorUserId || null
  };
}

async function skipUnavailablePendingSubdepartmentRequirements(conn, transferId) {
  await conn.execute(
    `UPDATE queue_subdepartment_requirements r
     LEFT JOIN subdepartments sd ON sd.subdepartment_id = r.subdepartment_id
     SET r.status = 'skipped',
         r.finished_at = NOW()
     WHERE r.transfer_id = ?
       AND r.status = 'pending'
       AND (sd.subdepartment_id IS NULL OR sd.deleted_at IS NOT NULL OR sd.status <> 'open')`,
    [transferId]
  );
}

async function queueSubdepartmentRequirement(conn, requirement, actorUserId = null, source = 'assignment') {
  if (!requirement || !requirement.requirement_id) return null;

  const queuedRequirements = await conn.execute(
    `SELECT requirement_id, subdepartment_id
     FROM queue_subdepartment_requirements
     WHERE transfer_id = ?
       AND status = 'queued'
     FOR UPDATE`,
    [requirement.transfer_id]
  );

  const queuedElsewhere = queuedRequirements.filter(row => Number(row.requirement_id) !== Number(requirement.requirement_id));
  if (queuedElsewhere.length) {
    await conn.execute(
      `UPDATE queue_subdepartment_requirements
       SET status = 'pending',
           queued_at = NULL
       WHERE transfer_id = ?
         AND status = 'queued'
         AND requirement_id <> ?`,
      [requirement.transfer_id, requirement.requirement_id]
    );
  }

  await conn.execute(
    `UPDATE queue_subdepartment_requirements
     SET status = 'queued',
         queued_at = COALESCE(queued_at, NOW())
     WHERE requirement_id = ?
       AND status IN ('pending', 'queued')`,
    [requirement.requirement_id]
  );

  await logQueueAction(conn, {
    queue_id: requirement.queue_id,
    actor_user_id: actorUserId,
    department_id: requirement.department_id,
    action: queuedElsewhere.length ? 'transfer_subdepartment_rerouted' : 'transfer_subdepartment_queued',
    details: {
      transfer_id: requirement.transfer_id,
      requirement_id: requirement.requirement_id,
      subdepartment_id: requirement.subdepartment_id,
      previous_subdepartment_ids: queuedElsewhere.map(row => row.subdepartment_id),
      active_count_before_queue: Number(requirement.active_count || 0),
      source
    }
  });

  return {
    requirement_id: requirement.requirement_id,
    transfer_id: requirement.transfer_id,
    queue_id: requirement.queue_id,
    code: requirement.code,
    full_name: requirement.full_name,
    department_id: requirement.department_id,
    subdepartment_id: requirement.subdepartment_id,
    subdepartment_name: requirement.subdepartment_name,
    subdepartment_room_number: requirement.subdepartment_room_number,
    subdepartment_destination: formatSubdepartmentDestination(requirement.subdepartment_name, requirement.subdepartment_room_number),
    status: 'waiting'
  };
}

async function rebalanceSubdepartmentQueues(conn, parentDepartmentId, actorUserId = null) {
  const departmentId = Number(parentDepartmentId);
  if (!departmentId) return [];

  const subdepartments = await conn.execute(
    `SELECT subdepartment_id, department_id, name, room_number, current_queue_id
     FROM subdepartments
     WHERE department_id = ?
       AND status = 'open'
       AND deleted_at IS NULL
     ORDER BY subdepartment_id ASC
     FOR UPDATE`,
    [departmentId]
  );

  const assignments = [];

  for (const subdepartment of subdepartments) {
    const activeRows = await conn.execute(
      `SELECT r.requirement_id
       FROM queue_subdepartment_requirements r
       JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
       WHERE r.subdepartment_id = ?
         AND qt.status = 'in_subdepartment'
         AND r.status IN ('queued', 'serving')
       LIMIT 1
       FOR UPDATE`,
      [subdepartment.subdepartment_id]
    );

    if (activeRows.length) continue;

    const [candidate] = await conn.execute(
      `SELECT r.requirement_id,
              r.transfer_id,
              r.subdepartment_id,
              q.queue_id,
              q.department_id,
              q.full_name,
              ${queueCodeSql('d', 'v')} AS code,
              sd.name AS subdepartment_name,
              sd.room_number AS subdepartment_room_number,
              0 AS active_count
       FROM queue_subdepartment_requirements r
       JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
       JOIN queues q ON q.queue_id = qt.queue_id
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       JOIN subdepartments sd ON sd.subdepartment_id = r.subdepartment_id
       WHERE r.subdepartment_id = ?
         AND r.status = 'pending'
         AND qt.status = 'in_subdepartment'
         AND qt.to_department_id = ?
         AND q.department_id = ?
         AND sd.status = 'open'
         AND sd.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM queue_subdepartment_requirements serving_r
           WHERE serving_r.transfer_id = r.transfer_id
             AND serving_r.status = 'serving'
         )
       ORDER BY q.is_emergency DESC,
                q.is_priority DESC,
                COALESCE(r.queued_at, q.created_at) ASC,
                q.queue_id ASC
       LIMIT 1
       FOR UPDATE`,
      [subdepartment.subdepartment_id, departmentId, departmentId]
    );

    if (!candidate) continue;

    const assigned = await queueSubdepartmentRequirement(conn, candidate, actorUserId, 'rebalance');
    if (assigned) assignments.push(assigned);
  }

  return assignments;
}

async function finishTransferItemForQueue(conn, queueId, status, actorUserId = null, subdepartmentId = null) {
  const terminalStatus = status === 'skipped' ? 'skipped' : 'done';
  const queue = await getQueueForTransfer(conn, queueId, true);
  if (!queue) return null;

  const transfer = await getActiveQueueTransfer(conn, queueId, true);
  if (!transfer) return null;

  if (!queue.subdepartment_id && transfer.status === 'waiting_department_call') {
    await conn.execute(
      `UPDATE queue_transfers
       SET status = ?,
           completed_at = NOW()
       WHERE transfer_id = ?`,
      [terminalStatus === 'done' ? 'completed' : 'cancelled', transfer.transfer_id]
    );

    await conn.execute(
      `UPDATE queue_subdepartment_requirements
       SET status = 'skipped',
           finished_at = NOW()
       WHERE transfer_id = ?
         AND status = 'pending'`,
      [transfer.transfer_id]
    );

    return null;
  }

  const [requirement] = await conn.execute(
    `SELECT requirement_id, transfer_id, subdepartment_id
     FROM queue_subdepartment_requirements
     WHERE transfer_id = ?
       ${subdepartmentId ? 'AND subdepartment_id = ?' : ''}
       AND status IN ('queued', 'serving')
     ORDER BY requirement_id ASC
     LIMIT 1
     FOR UPDATE`,
    subdepartmentId ? [transfer.transfer_id, subdepartmentId] : [transfer.transfer_id]
  );

  if (!requirement) return null;

  await conn.execute(
    `UPDATE queue_subdepartment_requirements
     SET status = ?,
         finished_at = NOW()
     WHERE requirement_id = ?`,
    [terminalStatus, requirement.requirement_id]
  );

  const [nextRequirement] = await conn.execute(
    `SELECT r.requirement_id,
            r.transfer_id,
            r.subdepartment_id,
            q.queue_id,
            q.department_id,
            q.full_name,
            ${queueCodeSql('d', 'v')} AS code,
            sd.name AS subdepartment_name,
            sd.room_number AS subdepartment_room_number,
            (
              SELECT COUNT(*)
              FROM queue_subdepartment_requirements active_r
              WHERE active_r.subdepartment_id = r.subdepartment_id
                AND active_r.status IN ('queued', 'serving')
            ) AS active_count
     FROM queue_subdepartment_requirements r
     JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
     JOIN queues q ON q.queue_id = qt.queue_id
     JOIN departments d ON d.department_id = q.department_id
     JOIN visits v ON v.visit_id = q.visit_id
     JOIN subdepartments sd ON sd.subdepartment_id = r.subdepartment_id
     WHERE r.transfer_id = ?
       AND r.status = 'pending'
       AND sd.deleted_at IS NULL
       AND sd.status = 'open'
     ORDER BY active_count ASC,
              r.requirement_id ASC,
              r.subdepartment_id ASC
     LIMIT 1
     FOR UPDATE`,
    [transfer.transfer_id]
  );

  if (!nextRequirement) {
    await skipUnavailablePendingSubdepartmentRequirements(conn, transfer.transfer_id);

    await conn.execute(
      `UPDATE queue_transfers
       SET status = 'completed',
           completed_at = NOW()
       WHERE transfer_id = ?`,
      [transfer.transfer_id]
    );

    await conn.execute(
      `UPDATE queues
       SET status = 'done',
           finished_at = NOW(),
           subdepartment_id = NULL
       WHERE queue_id = ?
         AND status IN ('waiting', 'serving')`,
      [queueId]
    );

    return null;
  }

  return queueSubdepartmentRequirement(conn, nextRequirement, actorUserId, 'finish_transfer_item');
}

async function assignNextPendingSubdepartment(conn, transferId, actorUserId = null) {
  const [transfer] = await conn.execute(
    `SELECT qt.transfer_id, qt.queue_id, qt.to_department_id, qt.status,
            q.full_name,
            ${queueCodeSql('d', 'v')} AS code
     FROM queue_transfers qt
     JOIN queues q ON q.queue_id = qt.queue_id
     JOIN departments d ON d.department_id = q.department_id
     JOIN visits v ON v.visit_id = q.visit_id
     WHERE qt.transfer_id = ?
     LIMIT 1
     FOR UPDATE`,
    [transferId]
  );

  if (!transfer || !['waiting_department_call', 'in_subdepartment'].includes(transfer.status)) {
    return null;
  }

  const [activeRequirement] = await conn.execute(
    `SELECT r.requirement_id,
            r.transfer_id,
            r.subdepartment_id,
            r.status,
            qt.queue_id,
            qt.to_department_id AS department_id,
            q.full_name,
            ${queueCodeSql('d', 'v')} AS code,
            sd.name AS subdepartment_name,
            sd.room_number AS subdepartment_room_number
     FROM queue_subdepartment_requirements r
     JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
     JOIN queues q ON q.queue_id = qt.queue_id
     JOIN departments d ON d.department_id = q.department_id
     JOIN visits v ON v.visit_id = q.visit_id
     JOIN subdepartments sd ON sd.subdepartment_id = r.subdepartment_id
     WHERE r.transfer_id = ?
       AND r.status IN ('queued', 'serving')
     ORDER BY (r.status = 'serving') DESC, r.requirement_id ASC
     LIMIT 1
     FOR UPDATE`,
    [transferId]
  );

  if (activeRequirement) {
    await conn.execute(
      `UPDATE queue_subdepartment_requirements
       SET status = 'pending',
           queued_at = NULL
       WHERE transfer_id = ?
         AND status = 'queued'
         AND requirement_id <> ?`,
      [transferId, activeRequirement.requirement_id]
    );

    return {
      queue_id: activeRequirement.queue_id,
      code: activeRequirement.code,
      full_name: activeRequirement.full_name,
      department_id: activeRequirement.department_id,
      subdepartment_id: activeRequirement.subdepartment_id,
      subdepartment_name: activeRequirement.subdepartment_name,
      subdepartment_room_number: activeRequirement.subdepartment_room_number,
      subdepartment_destination: formatSubdepartmentDestination(activeRequirement.subdepartment_name, activeRequirement.subdepartment_room_number),
      status: activeRequirement.status === 'serving' ? 'serving' : 'waiting'
    };
  }

  const [nextRequirement] = await conn.execute(
    `SELECT r.requirement_id,
            r.transfer_id,
            r.subdepartment_id,
            qt.queue_id,
            qt.to_department_id AS department_id,
            q.full_name,
            ${queueCodeSql('d', 'v')} AS code,
            sd.name AS subdepartment_name,
            sd.room_number AS subdepartment_room_number,
            (
              SELECT COUNT(*)
              FROM queue_subdepartment_requirements active_r
              WHERE active_r.subdepartment_id = r.subdepartment_id
                AND active_r.status IN ('queued', 'serving')
            ) AS active_count
     FROM queue_subdepartment_requirements r
     JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
     JOIN queues q ON q.queue_id = qt.queue_id
     JOIN departments d ON d.department_id = q.department_id
     JOIN visits v ON v.visit_id = q.visit_id
     JOIN subdepartments sd ON sd.subdepartment_id = r.subdepartment_id
     WHERE r.transfer_id = ?
       AND r.status = 'pending'
       AND sd.deleted_at IS NULL
       AND sd.status = 'open'
     ORDER BY active_count ASC,
              r.requirement_id ASC,
              r.subdepartment_id ASC
     LIMIT 1
     FOR UPDATE`,
    [transferId]
  );

  if (!nextRequirement) {
    await skipUnavailablePendingSubdepartmentRequirements(conn, transferId);

    await conn.execute(
      `UPDATE queue_transfers
       SET status = 'completed',
           completed_at = NOW()
       WHERE transfer_id = ?`,
      [transferId]
    );
    return null;
  }

  return queueSubdepartmentRequirement(conn, nextRequirement, actorUserId, 'assign_next_pending');
}

async function activateTransferOnDepartmentCall(conn, queueId, actorUserId = null) {
  const transfer = await getActiveQueueTransfer(conn, queueId, true);
  if (!transfer || transfer.status !== 'waiting_department_call') {
    return null;
  }

  await conn.execute(
    `UPDATE queues
     SET status = 'done',
         called_at = NOW(),
         finished_at = NOW(),
         counter_id = NULL,
         subdepartment_id = NULL
     WHERE queue_id = ?`,
    [queueId]
  );

  await conn.execute(
    `UPDATE queue_transfers
     SET status = 'in_subdepartment',
         called_at = NOW()
     WHERE transfer_id = ?`,
    [transfer.transfer_id]
  );

  const assignedQueue = await assignNextPendingSubdepartment(conn, transfer.transfer_id, actorUserId);
  return {
    transfer_id: transfer.transfer_id,
    assigned_queue: assignedQueue
  };
}

function normalizeCounterIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .map(counterId => Number(counterId))
    .filter(counterId => Number.isInteger(counterId) && counterId > 0))];
}

function normalizeSubdepartmentIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .map(subdepartmentId => Number(subdepartmentId))
    .filter(subdepartmentId => Number.isInteger(subdepartmentId) && subdepartmentId > 0))];
}

async function performSubdepartmentTransfer(req, { queue_id, target_department_id, subdepartment_ids, reason }) {
  const sourceQueueId = Number(queue_id);
  const targetDepartmentId = Number(target_department_id);
  const subdepartmentIds = normalizeSubdepartmentIds(subdepartment_ids);
  const transferReason = String(reason || '').trim();

  if (!sourceQueueId || !targetDepartmentId) {
    return { status: 400, body: { success: false, message: 'queue_id and target_department_id are required.' } };
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const sourceQueue = await getQueueForTransfer(conn, sourceQueueId, true);
    if (!sourceQueue) {
      await conn.rollback();
      return { status: 404, body: { success: false, message: 'Source queue was not found.' } };
    }

    if (!canAccessDepartment(req, sourceQueue.department_id)) {
      await conn.rollback();
      return { status: 403, body: { success: false, message: 'You cannot transfer this queue entry.' } };
    }

    if (!['serving', 'done'].includes(sourceQueue.status)) {
      await conn.rollback();
      return { status: 400, body: { success: false, message: 'Only a serving or completed queue can be transferred.' } };
    }

    if (Number(sourceQueue.department_id) === targetDepartmentId) {
      await conn.rollback();
      return { status: 400, body: { success: false, message: 'Transfer to the same department is not allowed.' } };
    }

    const [targetDepartment] = await conn.execute(
      `SELECT department_id, name, code, queue_status
       FROM departments
       WHERE department_id = ?
       FOR UPDATE`,
      [targetDepartmentId]
    );

    if (!targetDepartment) {
      await conn.rollback();
      return { status: 404, body: { success: false, message: 'Target department was not found.' } };
    }

    if (targetDepartment.queue_status !== 'open') {
      await conn.rollback();
      return {
        status: 400,
        body: {
          success: false,
          message: 'Target department is not accepting new queues.'
        }
      };
    }

    const departmentSubdepartments = await conn.execute(
      `SELECT subdepartment_id, status
       FROM subdepartments
       WHERE department_id = ?
         AND deleted_at IS NULL`,
      [targetDepartmentId]
    );
    const validSubdepartmentIds = new Map(
      departmentSubdepartments.map(row => [Number(row.subdepartment_id), row.status])
    );

    if (validSubdepartmentIds.size && !subdepartmentIds.length) {
      await conn.rollback();
      return { status: 400, body: { success: false, message: 'Select at least one subdepartment for this department.' } };
    }

    const invalidSubdepartment = subdepartmentIds.find(subdepartmentId => !validSubdepartmentIds.has(subdepartmentId));
    if (invalidSubdepartment) {
      await conn.rollback();
      return { status: 400, body: { success: false, message: 'Selected subdepartment does not belong to the target department.' } };
    }

    const closedSubdepartment = subdepartmentIds.find(subdepartmentId => validSubdepartmentIds.get(subdepartmentId) !== 'open');
    if (closedSubdepartment) {
      await conn.rollback();
      return { status: 400, body: { success: false, message: 'Selected subdepartment is not open.' } };
    }

    const [existingTransfer] = await conn.execute(
      `SELECT queue_id
       FROM queues
       WHERE referred_from_queue_id = ?
       LIMIT 1`,
      [sourceQueueId]
    );

    if (existingTransfer) {
      await conn.rollback();
      return { status: 409, body: { success: false, message: 'This queue has already been transferred.' } };
    }

    if (sourceQueue.status === 'serving') {
      await conn.execute(
        `UPDATE queues
         SET status = 'done',
             finished_at = NOW()
         WHERE queue_id = ?`,
        [sourceQueue.queue_id]
      );

      if (sourceQueue.counter_id) {
        await conn.execute(
          `UPDATE counters
           SET current_queue_id = NULL
           WHERE counter_id = ?
             AND current_queue_id = ?`,
          [sourceQueue.counter_id, sourceQueue.queue_id]
        );
      }

      if (sourceQueue.subdepartment_id) {
        await conn.execute(
          `UPDATE subdepartments
           SET current_queue_id = NULL
           WHERE subdepartment_id = ?
             AND current_queue_id = ?`,
          [sourceQueue.subdepartment_id, sourceQueue.queue_id]
        );
      }
    }

    const newQueue = await insertTransferredQueue(conn, {
      sourceQueue,
      targetDepartment,
      reason: transferReason,
      actorUserId: req.session.uid
    });

    let transferId = null;
    let assignedSubdepartmentQueue = null;
    if (subdepartmentIds.length) {
      const transferInsert = await conn.execute(
        `INSERT INTO queue_transfers
         (queue_id, from_department_id, to_department_id, status, called_at)
         VALUES (?, ?, ?, 'in_subdepartment', NOW())`,
        [newQueue.queue_id, sourceQueue.department_id, targetDepartmentId]
      );
      transferId = Number(transferInsert.insertId);

      for (const subdepartmentId of subdepartmentIds) {
        await conn.execute(
          `INSERT INTO queue_subdepartment_requirements
           (transfer_id, subdepartment_id, status)
           VALUES (?, ?, 'pending')`,
          [transferId, subdepartmentId]
        );
      }

      await conn.execute(
        `UPDATE queues
         SET status = 'done',
             called_at = NOW(),
             finished_at = NOW(),
             counter_id = NULL,
             subdepartment_id = NULL
         WHERE queue_id = ?`,
        [newQueue.queue_id]
      );
      newQueue.status = 'done';

      assignedSubdepartmentQueue = await assignNextPendingSubdepartment(conn, transferId, req.session.uid);
      await rebalanceSubdepartmentQueues(conn, targetDepartmentId, req.session.uid);
    }

    await logQueueAction(conn, {
      queue_id: sourceQueue.queue_id,
      actor_user_id: req.session.uid,
      department_id: sourceQueue.department_id,
      action: 'transferred',
      details: {
        target_queue_id: newQueue.queue_id,
        target_department_id: targetDepartmentId,
        transfer_id: transferId,
        subdepartment_ids: subdepartmentIds,
        assigned_subdepartment_id: assignedSubdepartmentQueue ? assignedSubdepartmentQueue.subdepartment_id : null,
        target_queue_code: newQueue.code
      }
    });

    await updateVisitStatus(conn, sourceQueue.visit_id);
    await conn.commit();

    return {
      status: 200,
      body: {
        success: true,
        message: assignedSubdepartmentQueue
          ? `Patient transferred and queued to ${assignedSubdepartmentQueue.subdepartment_name}.`
          : 'Patient transferred successfully.',
        transfer_id: transferId,
        queue: newQueue,
        assigned_subdepartment_queue: assignedSubdepartmentQueue
      }
    };
  } catch (err) {
    if (conn) await conn.rollback();
    return { status: 500, body: { success: false, message: err.message, error: err.message } };
  } finally {
    if (conn) conn.release();
  }
}

ensureQueueTransferSchema();
ensureAuthSchema();
ensureDemographicSchema();
ensurePreferredDoctorSchema();
ensureSubdepartmentSchema();
ensureDepartmentSchema();

const AI_HISTORY_ALLOWED_STATUSES = ['waiting', 'serving', 'done', 'cancelled', 'no_show', 'void'];
const AI_HISTORY_DEFAULT_STATUSES = ['done', 'cancelled', 'no_show', 'void'];
const AI_HISTORY_STOP_WORDS = new Set([
  'a',
  'an',
  'ago',
  'and',
  'around',
  'at',
  'checked',
  'check',
  'for',
  'from',
  'in',
  'of',
  'on',
  'patient',
  'patients',
  'queue',
  'the',
  'to',
  'visit',
  'visited',
  'with'
]);

let queueLogsTableExistsCache = null;

function isValidDateFilter(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getLocalDateForAi() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIME_ZONE || process.env.TZ || 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatUtcDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function parseDateOnly(dateString) {
  if (!isValidDateFilter(dateString)) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function shiftDateString(dateString, { days = 0, months = 0, years = 0 } = {}) {
  const date = parseDateOnly(dateString);
  if (!date) return null;
  date.setUTCFullYear(date.getUTCFullYear() + years);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

function startOfMonth(dateString) {
  const date = parseDateOnly(dateString);
  if (!date) return null;
  date.setUTCDate(1);
  return formatUtcDate(date);
}

function endOfMonth(dateString) {
  const date = parseDateOnly(dateString);
  if (!date) return null;
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return formatUtcDate(date);
}

function cleanKeyword(keyword) {
  return String(keyword || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function normalizeKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];

  const seen = new Set();
  const normalized = [];

  for (const keyword of keywords) {
    const cleaned = cleanKeyword(keyword);
    const lowered = cleaned.toLowerCase();

    if (!cleaned || AI_HISTORY_STOP_WORDS.has(lowered) || seen.has(lowered)) {
      continue;
    }

    seen.add(lowered);
    normalized.push(cleaned);

    if (normalized.length >= 8) break;
  }

  return normalized;
}

function normalizeAiSearchFilters(raw) {
  const filters = raw && typeof raw === 'object' ? raw : {};
  const status = typeof filters.status === 'string'
    ? filters.status.trim().toLowerCase()
    : null;

  return {
    date_from: isValidDateFilter(filters.date_from) ? filters.date_from : null,
    date_to: isValidDateFilter(filters.date_to) ? filters.date_to : null,
    keywords: normalizeKeywords(filters.keywords),
    status: AI_HISTORY_ALLOWED_STATUSES.includes(status) ? status : null,
    department: typeof filters.department === 'string'
      ? cleanKeyword(filters.department) || null
      : null
  };
}

function extractFirstJsonObject(text) {
  const source = String(text || '');

  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;

        if (depth === 0) {
          const candidate = source.slice(start, index + 1);

          try {
            JSON.parse(candidate);
            return candidate;
          } catch (err) {
            break;
          }
        }
      }
    }
  }

  return null;
}

function parseGroqJson(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('Groq returned an empty response');
  }

  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch (err) {
    console.warn('Groq JSON parsing failed, attempting recovery');
    const recovered = extractFirstJsonObject(trimmed);
    if (!recovered) throw err;
    return JSON.parse(recovered);
  }
}

function extractFallbackKeywords(prompt) {
  return normalizeKeywords(
    String(prompt || '')
      .split(/[^a-zA-Z0-9]+/)
      .map(word => word.trim())
      .filter(word => word.length >= 2)
      .filter(word => !/^\d+$/.test(word))
  );
}

function extractFallbackDateRange(prompt) {
  const text = String(prompt || '').toLowerCase();
  const today = getLocalDateForAi();

  if (text.includes('today')) {
    return { date_from: today, date_to: today };
  }

  if (text.includes('yesterday')) {
    const yesterday = shiftDateString(today, { days: -1 });
    return { date_from: yesterday, date_to: yesterday };
  }

  if (text.includes('last week')) {
    return {
      date_from: shiftDateString(today, { days: -7 }),
      date_to: today
    };
  }

  if (text.includes('last month')) {
    const previousMonth = shiftDateString(today, { months: -1 });
    return {
      date_from: startOfMonth(previousMonth),
      date_to: endOfMonth(previousMonth)
    };
  }

  if (text.includes('last year')) {
    const previousYear = String(Number(today.slice(0, 4)) - 1);
    return {
      date_from: `${previousYear}-01-01`,
      date_to: `${previousYear}-12-31`
    };
  }

  const yearsAgoMatch = text.match(/\b(\d{1,2})\s+years?\s+ago\b/);
  if (yearsAgoMatch) {
    const target = shiftDateString(today, { years: -Number(yearsAgoMatch[1]) });
    return { date_from: target, date_to: target };
  }

  const explicitYearMatch = text.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  if (explicitYearMatch) {
    const year = explicitYearMatch[1];
    return {
      date_from: `${year}-01-01`,
      date_to: `${year}-12-31`
    };
  }

  return { date_from: null, date_to: null };
}

function extractFallbackStatus(prompt) {
  const text = String(prompt || '').toLowerCase();

  if (/\b(no[\s_-]?show|skipped|skip)\b/.test(text)) return 'no_show';
  if (/\b(cancelled|canceled|cancel)\b/.test(text)) return 'cancelled';
  if (/\bvoid(ed)?\b/.test(text)) return 'void';
  if (/\b(serving|called|in progress)\b/.test(text)) return 'serving';
  if (/\b(waiting|pending)\b/.test(text)) return 'waiting';
  if (/\b(done|completed|finished|checked|seen)\b/.test(text)) return 'done';
  return null;
}

async function detectDepartmentFromPrompt(conn, prompt) {
  const text = String(prompt || '').toLowerCase();
  const departments = await conn.execute(
    `SELECT name, code
     FROM departments
     ORDER BY LENGTH(name) DESC, name ASC`
  );

  for (const department of departments) {
    const name = String(department.name || '').toLowerCase();
    const code = String(department.code || '').toLowerCase();
    const codePattern = code
      ? new RegExp(`(^|[^a-z0-9])${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i')
      : null;

    if ((name && text.includes(name)) || (codePattern && codePattern.test(text))) {
      return department.name;
    }
  }

  return null;
}

async function buildFallbackSearchFilters(conn, prompt) {
  const dateRange = extractFallbackDateRange(prompt);

  return {
    date_from: dateRange.date_from,
    date_to: dateRange.date_to,
    keywords: extractFallbackKeywords(prompt),
    status: extractFallbackStatus(prompt),
    department: await detectDepartmentFromPrompt(conn, prompt)
  };
}

async function hasQueueLogsTable(conn) {
  if (queueLogsTableExistsCache !== null) {
    return queueLogsTableExistsCache;
  }

  const rows = await conn.execute(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = 'queue_logs'
     LIMIT 1`
  );

  queueLogsTableExistsCache = !!rows.length;
  return queueLogsTableExistsCache;
}

function buildHistorySearchQuery({ filters, session, includeQueueLogs, limit = 100 }) {
  const where = [];
  const params = [];
  const joins = [
    'JOIN departments d ON d.department_id = q.department_id',
    'JOIN visits v ON v.visit_id = q.visit_id'
  ];
  joins.push('LEFT JOIN queues tq ON tq.referred_from_queue_id = q.queue_id');
  joins.push('LEFT JOIN departments td ON td.department_id = tq.department_id');
  joins.push('LEFT JOIN visits tv ON tv.visit_id = tq.visit_id');

  if (includeQueueLogs) {
    joins.push('LEFT JOIN queue_logs ql ON ql.queue_id = q.queue_id');
  }

  if (session.role === 'staff') {
    where.push('q.department_id = ?');
    params.push(session.department_id);
  } else if (filters.department) {
    const like = `%${filters.department}%`;
    where.push('(d.name LIKE ? OR d.code LIKE ?)');
    params.push(like, like);
  }

  if (filters.status) {
    where.push('q.status = ?');
    params.push(filters.status);
  } else {
    where.push(`q.status IN (${AI_HISTORY_DEFAULT_STATUSES.map(() => '?').join(', ')})`);
    params.push(...AI_HISTORY_DEFAULT_STATUSES);
  }

  if (filters.date_from) {
    const fromDateTime = `${filters.date_from} 00:00:00`;
    const clauses = ['q.created_at >= ?', 'q.called_at >= ?', 'q.finished_at >= ?'];
    params.push(fromDateTime, fromDateTime, fromDateTime);

    if (includeQueueLogs) {
      clauses.push('ql.created_at >= ?');
      params.push(fromDateTime);
    }

    where.push(`(${clauses.join(' OR ')})`);
  }

  if (filters.date_to) {
    const toDateTime = `${filters.date_to} 23:59:59`;
    const clauses = ['q.created_at <= ?', 'q.called_at <= ?', 'q.finished_at <= ?'];
    params.push(toDateTime, toDateTime, toDateTime);

    if (includeQueueLogs) {
      clauses.push('ql.created_at <= ?');
      params.push(toDateTime);
    }

    where.push(`(${clauses.join(' OR ')})`);
  }

  if (filters.keywords.length) {
    for (const keyword of filters.keywords) {
      const like = `%${keyword}%`;
      const clauses = [
        `${queueCodeSql('d', 'v')} LIKE ?`,
        'q.full_name LIKE ?',
        'q.category LIKE ?',
        'q.visit_description LIKE ?',
        'q.status LIKE ?',
        'd.name LIKE ?',
        'd.code LIKE ?'
      ];
      params.push(like, like, like, like, like, like, like);

      if (includeQueueLogs) {
        clauses.push('ql.action LIKE ?');
        clauses.push('ql.details LIKE ?');
        params.push(like, like);
      }

      where.push(`(${clauses.join(' OR ')})`);
    }
  }

  return {
    sql: `SELECT DISTINCT
            q.queue_id,
            ${queueCodeSql('d', 'v')} AS code,
            q.full_name,
            d.name AS department_name,
            q.department_id,
            q.category,
            q.status,
            q.visit_description,
            q.referred_from_queue_id,
            q.transfer_reason,
            q.transferred_by_user_id,
            q.transferred_at,
            tq.queue_id AS transferred_queue_id,
            ${queueCodeSql('td', 'tv', 'tq')} AS transferred_queue_code,
            q.created_at,
            q.called_at,
            q.finished_at
          FROM queues q
          ${joins.join('\n          ')}
          WHERE ${where.length ? where.join(' AND ') : '1=1'}
          ORDER BY COALESCE(q.finished_at, q.called_at, q.created_at) DESC,
                   q.queue_id DESC
          LIMIT ${Number(limit)}`,
    params
  };
}

async function promptToQueueSearchFilters(prompt) {
  if (!groq) {
    const err = new Error('GROQ_API_KEY is not configured');
    err.statusCode = 503;
    throw err;
  }

  console.info('Calling Groq for queue history search');

  const today = getLocalDateForAi();
  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You convert clinic queue history search requests into strict JSON filters.',
          'Return JSON only.',
          'Do not explain.',
          'Do not write SQL.',
          'Use null when a field is unknown.',
          'Do not invent departments.',
          `Current date is the server date: ${today}.`
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          'Return exactly this JSON shape:',
          '{',
          '  "date_from": null,',
          '  "date_to": null,',
          '  "keywords": [],',
          '  "status": null,',
          '  "department": null',
          '}',
          'Allowed status values: waiting, serving, done, cancelled, no_show, void, null.',
          `Prompt: ${prompt}`
        ].join('\n')
      }
    ]
  });

  const filters = normalizeAiSearchFilters(parseGroqJson(completion.choices?.[0]?.message?.content));

  if (!filters.keywords.length && !filters.status && !filters.department && !filters.date_from && !filters.date_to) {
    filters.keywords = extractFallbackKeywords(prompt);
  }

  return filters;
}

const AI_VISIT_ALLOWED_CATEGORIES = ['general', 'support', 'priority', 'complaint'];
const AI_VISIT_ALLOWED_PRIORITY_LEVELS = ['normal', 'priority', 'urgent_review'];

function normalizeVisitConcernClassification(raw, availableDepartments) {
  const departmentSet = new Set((availableDepartments || []).map(name => String(name || '').trim().toLowerCase()));
  const suggestion = raw && typeof raw === 'object' ? raw : {};
  const suggestedDepartmentRaw = typeof suggestion.suggested_department === 'string'
    ? suggestion.suggested_department.trim()
    : '';
  const suggestedDepartment = suggestedDepartmentRaw && departmentSet.has(suggestedDepartmentRaw.toLowerCase())
    ? suggestedDepartmentRaw
    : null;
  const categoryRaw = typeof suggestion.category === 'string'
    ? suggestion.category.trim().toLowerCase()
    : '';
  const priorityRaw = typeof suggestion.priority_level === 'string'
    ? suggestion.priority_level.trim().toLowerCase()
    : '';
  const reason = typeof suggestion.reason === 'string'
    ? suggestion.reason.trim().replace(/\s+/g, ' ').slice(0, 180)
    : '';

  return {
    suggested_department: suggestedDepartment,
    category: AI_VISIT_ALLOWED_CATEGORIES.includes(categoryRaw) ? categoryRaw : 'general',
    priority_level: AI_VISIT_ALLOWED_PRIORITY_LEVELS.includes(priorityRaw) ? priorityRaw : 'normal',
    reason
  };
}

async function classifyVisitConcern({ concern, availableDepartments }) {
  if (!groq) return null;

  const concernText = String(concern || '').trim();
  if (!concernText) return null;

  const departmentNames = (availableDepartments || [])
    .map(name => String(name || '').trim())
    .filter(Boolean);

  if (!departmentNames.length) return null;

  try {
    console.info('Calling Groq for visit concern classification');
    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You classify clinic queue visit concerns into a suggested department and priority level.',
            'Return JSON only.',
            'Do not diagnose.',
            'Do not recommend treatment.',
            'If the concern sounds severe, use urgent_review, not emergency.',
            'Use only the provided department names.',
            'If unsure, use null for suggested_department.',
            'Keep the reason short.'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            'Return exactly this JSON shape:',
            '{',
            '  "suggested_department": null,',
            '  "category": "general",',
            '  "priority_level": "normal",',
            '  "reason": ""',
            '}',
            `Allowed departments: ${JSON.stringify(departmentNames)}`,
            `Allowed category values: ${JSON.stringify(AI_VISIT_ALLOWED_CATEGORIES)}`,
            `Concern: ${concernText}`
          ].join('\n')
        }
      ]
    });

    const parsed = parseGroqJson(completion.choices?.[0]?.message?.content);
    return normalizeVisitConcernClassification(parsed, departmentNames);
  } catch (err) {
    console.error('Groq visit concern classification failed:', err.message);
    return null;
  }
}

function normalizeDoctorTransferSuggestion(raw, { departments = [], subdepartments = [] } = {}) {
  const suggestion = raw && typeof raw === 'object' ? raw : {};
  const departmentById = new Map(departments.map(dept => [Number(dept.department_id), dept]));
  const departmentByName = new Map(departments.map(dept => [String(dept.name || '').trim().toLowerCase(), dept]));
  const subdepartmentById = new Map(subdepartments.map(sd => [Number(sd.subdepartment_id), sd]));
  const subdepartmentByName = new Map(subdepartments.map(sd => [String(sd.name || '').trim().toLowerCase(), sd]));

  let department = null;
  const suggestedDepartmentId = Number(suggestion.target_department_id);
  if (departmentById.has(suggestedDepartmentId)) {
    department = departmentById.get(suggestedDepartmentId);
  } else if (typeof suggestion.target_department_name === 'string') {
    department = departmentByName.get(suggestion.target_department_name.trim().toLowerCase()) || null;
  }

  const rawSubdepartmentValues = Array.isArray(suggestion.subdepartment_ids)
    ? suggestion.subdepartment_ids
    : Array.isArray(suggestion.subdepartments)
      ? suggestion.subdepartments
      : [];

  const subdepartmentIds = [];
  for (const value of rawSubdepartmentValues) {
    const numericId = Number(value);
    let subdepartment = subdepartmentById.get(numericId) || null;
    if (!subdepartment && typeof value === 'string') {
      subdepartment = subdepartmentByName.get(value.trim().toLowerCase()) || null;
    }
    if (
      subdepartment &&
      department &&
      Number(subdepartment.department_id) === Number(department.department_id) &&
      !subdepartmentIds.includes(Number(subdepartment.subdepartment_id))
    ) {
      subdepartmentIds.push(Number(subdepartment.subdepartment_id));
    }
  }

  const reason = typeof suggestion.reason === 'string'
    ? suggestion.reason.trim().replace(/\s+/g, ' ').slice(0, 500)
    : '';

  return {
    target_department_id: department ? Number(department.department_id) : null,
    target_department_name: department ? department.name : null,
    subdepartment_ids: subdepartmentIds,
    subdepartments: subdepartmentIds
      .map(id => subdepartmentById.get(id))
      .filter(Boolean)
      .map(sd => ({
        subdepartment_id: Number(sd.subdepartment_id),
        name: sd.name,
        room_number: sd.room_number || null
      })),
    reason
  };
}

async function suggestDoctorTransfer({ patientNote, checklist, doctorNote, departments, subdepartments }) {
  if (!groq) return null;

  const availableDepartments = (departments || []).map(dept => ({
    department_id: Number(dept.department_id),
    name: dept.name
  }));
  const availableSubdepartments = (subdepartments || []).map(sd => ({
    subdepartment_id: Number(sd.subdepartment_id),
    department_id: Number(sd.department_id),
    name: sd.name,
    room_number: sd.room_number || null
  }));

  if (!availableDepartments.length) return null;

  try {
    console.info('Calling Groq for doctor transfer suggestion');
    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You assist clinic queue routing after a normal check-up checklist.',
            'Return JSON only.',
            'Do not diagnose.',
            'Do not recommend treatment or medication.',
            'Only suggest a transfer destination from the allowed departments and subdepartments.',
            'If there is not enough information, use null for target_department_id and an empty subdepartment_ids array.',
            'Keep the reason short and phrase it as a referral/routing suggestion.'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            'Return exactly this JSON shape:',
            '{',
            '  "target_department_id": null,',
            '  "target_department_name": null,',
            '  "subdepartment_ids": [],',
            '  "reason": ""',
            '}',
            `Allowed departments: ${JSON.stringify(availableDepartments)}`,
            `Allowed subdepartments: ${JSON.stringify(availableSubdepartments)}`,
            `Patient submitted note: ${String(patientNote || '').trim() || 'None'}`,
            `Checklist: ${JSON.stringify(checklist || {})}`,
            `Doctor additional note: ${String(doctorNote || '').trim() || 'None'}`
          ].join('\n')
        }
      ]
    });

    return normalizeDoctorTransferSuggestion(parseGroqJson(completion.choices?.[0]?.message?.content), {
      departments,
      subdepartments
    });
  } catch (err) {
    console.error('Groq doctor transfer suggestion failed:', err.message);
    return null;
  }
}

async function getDepartmentNames(conn) {
  const departmentRows = await conn.execute(
    `SELECT name
     FROM departments
     ORDER BY name ASC`
  );

  return departmentRows
    .map(row => String(row.name || '').trim())
    .filter(Boolean);
}

function normalizeVisitConcernPayload(rawAi, availableDepartments) {
  if (!rawAi || typeof rawAi !== 'object') {
    return null;
  }

  return normalizeVisitConcernClassification(rawAi, availableDepartments);
}



app.post('/api/queue', async (req, res) => {
  console.log(req.body);

  const uid = req.session.uid;
  if (!uid) return res.status(401).json({ error: 'Not logged in' });
  const createsWalkInQueue = ['owner', 'admin', 'staff', 'doctor'].includes(req.session.role);
  const enforceUserActiveQueue = !createsWalkInQueue;
  const { categCheck } = req.body;
  let categoryComplete = {
    A: 'Aisthecategory',
    B: 'Bisthecategory',
    C: 'Cisthecategory'
  };
  let departmentName = categoryComplete[categCheck];

  let conn;

  try {
    conn = await pool.getConnection();

    await conn.beginTransaction();

    const [userLock] = await conn.execute(
      `SELECT user_id
       FROM users
       WHERE user_id = ?
       FOR UPDATE`,
      [uid]
    );

    if (!userLock) {
      await conn.rollback();
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
        error: 'Unauthorized'
      });
    }

    const [department] = await conn.execute(
      `SELECT department_id, code, queue_status
	       FROM departments
	       WHERE name = ?
	       FOR UPDATE`,
      [departmentName]
    );

    if (!department) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Department not found',
        error: 'Department not found'
      });
    }

    if (enforceUserActiveQueue) {
      const [activeQueue] = await conn.execute(
        `SELECT q.queue_id,
                ${queueCodeSql('d', 'v')} AS code
         FROM queues q
         JOIN departments d ON d.department_id = q.department_id
         JOIN visits v ON v.visit_id = q.visit_id
         WHERE q.user_id = ?
           AND q.status IN ('waiting', 'serving')
         ORDER BY q.created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [uid]
      );

      if (activeQueue) {
        await conn.rollback();
        return res.status(409).json({
          success: false,
          message: 'You already have an active queue.',
          error: 'You already have an active queue.',
          queue_id: activeQueue.queue_id,
          code: activeQueue.code
        });
      }
    }

    if (department.queue_status !== 'open') {
      await conn.rollback();
      return res.status(403).json({
        success: false,
        message: 'Queue is currently closed.',
        error: 'Queue is currently closed.',
        department_status: department.queue_status
      });
    }

    const visit = createsWalkInQueue
      ? await createVisit(conn, uid)
      : await getOrCreateActiveVisit(conn, uid);
    const code = formatQueueCode(department.code, visit.global_number);

    const dbres = await insertQueue(conn, {
      full_name: null,
      user_id: uid,
      department_id: department.department_id,
      visit_id: visit.visit_id,
      code,
      category: 'general'
    });

    await logQueueAction(conn, {
      queue_id: dbres.insertId,
      actor_user_id: uid,
      department_id: department.department_id,
      action: enforceUserActiveQueue ? 'queue_created' : 'admin_added_queue',
      details: {
        code,
        source: enforceUserActiveQueue ? 'patient' : 'admin'
      }
    });

    await conn.commit();

    res.json({
      success: true,
      queueID: Number(dbres.insertId),
      code
    });
  }
  catch (err) {
    if (conn) await conn.rollback();
    res.status(500).json({ error: err.message });
  }
  finally {
    if (conn) conn.release();
  }
});

app.post('/api/owner/admins', reqLogin, reqOwner, async (req, res) => {
  const fullName = String(req.body.fullName || '').trim();
  const contact = String(req.body.contact || '').trim();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!fullName || !username || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [existingUser] = await conn.execute(
      `SELECT user_id
       FROM users
       WHERE username = ?
       LIMIT 1`,
      [username]
    );

    if (existingUser) {
      return res.status(409).json({ error: 'Username is already in use' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await conn.execute(
      `INSERT INTO users
       (username, contact_number, password_hash, full_name, role)
       VALUES (?, ?, ?, ?, 'admin')`,
      [username, contact || null, hashed, fullName]
    );

    return res.json({
      success: true,
      user_id: Number(result.insertId)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/admin/staff', reqLogin, reqAdmin, async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT
          u.user_id,
          u.full_name,
          u.username,
          u.contact_number,
          u.role,
          u.department_id,
          d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.department_id = u.department_id
       WHERE u.role IN ('admin', 'staff', 'doctor')
       ORDER BY FIELD(u.role, 'admin', 'staff', 'doctor'), u.full_name ASC, u.username ASC`
    );

    return res.json({
      success: true,
      staff: rows,
      current_user_id: Number(req.session.uid)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/departments/status', reqLogin, async (req, res) => {
  let conn;

  try {
    await ensureDepartmentSchema();
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT
	          d.department_id,
	          d.name,
	          d.code,
	          d.queue_status,
	          d.image_url,
	          COUNT(CASE WHEN q.status IN ('waiting', 'serving') THEN 1 END) AS active_count
	       FROM departments d
	       LEFT JOIN queues q ON q.department_id = d.department_id
	       GROUP BY d.department_id, d.name, d.code, d.queue_status, d.image_url
	       ORDER BY d.name ASC`
    );

    const schedules = await conn.execute(
      `SELECT
          schedule_id,
          department_id,
          day_of_week,
          TIME_FORMAT(opens_at, '%H:%i') AS opens_at,
          TIME_FORMAT(closes_at, '%H:%i') AS closes_at,
          is_closed,
          note
       FROM department_schedules
       ORDER BY department_id ASC, day_of_week ASC`
    );

    const schedulesByDepartment = schedules.reduce((acc, schedule) => {
      const key = String(schedule.department_id);
      if (!acc[key]) acc[key] = [];
      acc[key].push(schedule);
      return acc;
    }, {});

    const departments = rows.map(row => ({
      ...row,
      schedules: schedulesByDepartment[String(row.department_id)] || []
    }));

    return res.json({
      success: true,
      departments
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/admin/departments', reqLogin, reqAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const code = String(req.body.code || '').trim().toUpperCase();
  const status = String(req.body.queue_status || req.body.status || 'open').trim().toLowerCase();
  const imageUrl = normalizeDepartmentImageUrl(req.body.image_url || req.body.imageUrl);

  if (!name || !code) {
    return res.status(400).json({ error: 'Department name and code are required' });
  }

  if (!['open', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Department status must be open or closed' });
  }

  if ((req.body.image_url || req.body.imageUrl) && !imageUrl) {
    return res.status(400).json({ error: 'Photo URL must be a valid http(s) URL or app path' });
  }

  let conn;

  try {
    await ensureDepartmentSchema();
    conn = await pool.getConnection();

    const [existing] = await conn.execute(
      `SELECT department_id
       FROM departments
       WHERE LOWER(name) = LOWER(?)
          OR UPPER(code) = UPPER(?)
       LIMIT 1`,
      [name, code]
    );

    if (existing) {
      return res.status(409).json({ error: 'Department name or code is already in use' });
    }

    const result = await conn.execute(
      `INSERT INTO departments (name, code, queue_status, image_url)
       VALUES (?, ?, ?, ?)`,
      [name, code, status, imageUrl]
    );

    return res.json({
      success: true,
      department_id: Number(result.insertId),
      department: {
        department_id: Number(result.insertId),
        name,
        code,
        queue_status: status,
        image_url: imageUrl
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/admin/departments/:department_id', reqLogin, reqAdmin, async (req, res) => {
  const departmentId = Number(req.params.department_id);
  const name = String(req.body.name || '').trim();
  const code = String(req.body.code || '').trim().toUpperCase();
  const status = String(req.body.queue_status || req.body.status || 'open').trim().toLowerCase();
  const rawImageUrl = req.body.image_url || req.body.imageUrl || '';
  const imageUrl = normalizeDepartmentImageUrl(rawImageUrl);

  if (!departmentId) {
    return res.status(400).json({ error: 'Valid department is required' });
  }

  if (!name || !code) {
    return res.status(400).json({ error: 'Department name and code are required' });
  }

  if (!['open', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Department status must be open or closed' });
  }

  if (rawImageUrl && !imageUrl) {
    return res.status(400).json({ error: 'Photo URL must be a valid http(s) URL or app path' });
  }

  let conn;

  try {
    await ensureDepartmentSchema();
    conn = await pool.getConnection();

    const [department] = await conn.execute(
      `SELECT department_id
       FROM departments
       WHERE department_id = ?
       LIMIT 1`,
      [departmentId]
    );

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    const [existing] = await conn.execute(
      `SELECT department_id
       FROM departments
       WHERE department_id <> ?
         AND (LOWER(name) = LOWER(?)
          OR UPPER(code) = UPPER(?))
       LIMIT 1`,
      [departmentId, name, code]
    );

    if (existing) {
      return res.status(409).json({ error: 'Department name or code is already in use' });
    }

    await conn.execute(
      `UPDATE departments
       SET name = ?,
           code = ?,
           queue_status = ?,
           image_url = ?
       WHERE department_id = ?`,
      [name, code, status, imageUrl, departmentId]
    );

    return res.json({
      success: true,
      department: {
        department_id: departmentId,
        name,
        code,
        queue_status: status,
        image_url: imageUrl
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/departments/:department_id/subdepartments', reqLogin, async (req, res) => {
  const departmentId = Number(req.params.department_id);

  if (!departmentId) {
    return res.status(400).json({ success: false, error: 'Valid department_id is required' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [department] = await conn.execute(
      `SELECT department_id, name
       FROM departments
       WHERE department_id = ?`,
      [departmentId]
    );

    if (!department) {
      return res.status(404).json({ success: false, error: 'Department not found' });
    }

    const subdepartments = await conn.execute(
      `SELECT subdepartment_id, department_id, name, room_number, status
       FROM subdepartments
       WHERE department_id = ?
         AND deleted_at IS NULL
       ORDER BY name ASC, subdepartment_id ASC`,
      [departmentId]
    );

    return res.json({
      success: true,
      department_id: departmentId,
      department,
      subdepartments
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/departments/:department_id/doctors', reqLogin, async (req, res) => {
  const departmentId = Number(req.params.department_id);

  if (!departmentId) {
    return res.status(400).json({ success: false, error: 'Valid department_id is required' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [department] = await conn.execute(
      `SELECT department_id, name
       FROM departments
       WHERE department_id = ?`,
      [departmentId]
    );

    if (!department) {
      return res.status(404).json({ success: false, error: 'Department not found' });
    }

    const doctors = await conn.execute(
      `SELECT user_id, department_id, full_name, username
       FROM users
       WHERE role = 'doctor'
         AND department_id = ?
       ORDER BY COALESCE(NULLIF(full_name, ''), username) ASC, user_id ASC`,
      [departmentId]
    );

    return res.json({
      success: true,
      department_id: departmentId,
      department,
      doctors
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/admin/departments/:department_id/queue-status', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id } = req.params;
  const { queueOpen, queue_status } = req.body;

  if (!canAccessDepartment(req, department_id)) {
    return res.status(403).json({ error: 'You cannot update this department' });
  }

  const normalizedStatus = queue_status ? String(queue_status).trim().toLowerCase() : '';
  if (normalizedStatus && !['open', 'closed'].includes(normalizedStatus)) {
    return res.status(400).json({ error: 'Department status must be open or closed' });
  }

  const queueStatus = normalizedStatus || (queueOpen === false ? 'closed' : 'open');

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const result = await conn.execute(
      `UPDATE departments
	       SET queue_status = ?
	       WHERE department_id = ?`,
      [queueStatus, department_id]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Department not found' });
    }

    await logQueueAction(conn, {
      actor_user_id: req.session.uid,
      department_id,
      action: 'status_changed',
      details: {
        scope: 'department_queue_status',
        queue_status: queueStatus
      }
    });

    await conn.commit();

    return res.json({
      success: true,
      department_id: Number(department_id),
      queue_status: queueStatus
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/admin/staff', reqLogin, reqAdmin, async (req, res) => {
  const fullName = String(req.body.fullName || '').trim();
  const contact = String(req.body.contact || '').trim();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const departmentId = req.body.departmentId;
  const role = ['staff', 'doctor'].includes(req.body.role) ? req.body.role : 'staff';

  if (!fullName || !username || !password || !departmentId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [existingUser] = await conn.execute(
      `SELECT user_id
       FROM users
       WHERE username = ?
       LIMIT 1`,
      [username]
    );

    if (existingUser) {
      return res.status(409).json({ error: 'Username is already in use' });
    }

    const [department] = await conn.execute(
      `SELECT department_id FROM departments WHERE department_id = ?`,
      [departmentId]
    );

    if (!department) {
      return res.status(400).json({ error: 'Department not found' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await conn.execute(
      `INSERT INTO users
       (username, contact_number, password_hash, full_name, role, department_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, contact || null, hashed, fullName, role, departmentId]
    );

    return res.json({
      success: true,
      user_id: Number(result.insertId)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/admin/staff/:user_id', reqLogin, reqAdmin, async (req, res) => {
  const { user_id } = req.params;
  const fullName = String(req.body.fullName || '').trim();
  const contact = String(req.body.contact || '').trim();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '').trim();
  const departmentId = req.body.departmentId || null;

  if (!fullName || !role) {
    return res.status(400).json({ error: 'Name and role are required' });
  }

  if (!['admin', 'staff', 'doctor'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin, staff, or doctor' });
  }

  if (['staff', 'doctor'].includes(role) && !departmentId) {
    return res.status(400).json({ error: 'Staff and doctor accounts require an assigned department' });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [account] = await conn.execute(
      `SELECT user_id, role
       FROM users
       WHERE user_id = ? AND role IN ('admin', 'staff', 'doctor')
       FOR UPDATE`,
      [user_id]
    );

    if (!account) {
      await conn.rollback();
      return res.status(404).json({ error: 'Staff account not found' });
    }

    if (Number(account.user_id) === Number(req.session.uid) && account.role !== role) {
      await conn.rollback();
      return res.status(400).json({ error: 'You cannot change your own role from Staff Management' });
    }

    if (account.role === 'admin' && role !== 'admin') {
      const [adminCountRow] = await conn.execute(
        `SELECT COUNT(*) AS admin_count
         FROM users
         WHERE role IN ('owner', 'admin')`
      );

      if (Number(adminCountRow.admin_count) <= 1) {
        await conn.rollback();
        return res.status(400).json({ error: 'Cannot remove the last remaining admin' });
      }
    }

    if (departmentId) {
      const [department] = await conn.execute(
        `SELECT department_id FROM departments WHERE department_id = ?`,
        [departmentId]
      );

      if (!department) {
        await conn.rollback();
        return res.status(400).json({ error: 'Department not found' });
      }
    }

    const fields = [
      'full_name = ?',
      'contact_number = ?',
      'role = ?',
      'department_id = ?'
    ];
    const values = [
      fullName,
      contact || null,
      role,
      ['staff', 'doctor'].includes(role) ? departmentId : (departmentId || null)
    ];

    if (password) {
      fields.push('password_hash = ?');
      values.push(await bcrypt.hash(password, 10));
    }

    values.push(user_id);

    await conn.execute(
      `UPDATE users
       SET ${fields.join(', ')}
       WHERE user_id = ? AND role IN ('admin', 'staff', 'doctor')`,
      values
    );

    await conn.commit();
    return res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();

    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username or contact number is already in use' });
    }

    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.delete('/api/admin/staff', reqLogin, reqAdmin, async (req, res) => {
  const userIds = Array.isArray(req.body.user_ids)
    ? req.body.user_ids.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0)
    : [];
  const uniqueUserIds = [...new Set(userIds)];

  if (!uniqueUserIds.length) {
    return res.status(400).json({ error: 'Select at least one staff account to delete' });
  }

  if (uniqueUserIds.includes(Number(req.session.uid))) {
    return res.status(400).json({ error: 'You cannot delete your own account from Staff Management' });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const placeholders = uniqueUserIds.map(() => '?').join(', ');
    const selectedAccounts = await conn.execute(
      `SELECT user_id, username, full_name, role
       FROM users
       WHERE user_id IN (${placeholders}) AND role IN ('admin', 'staff', 'doctor')
       FOR UPDATE`,
      uniqueUserIds
    );

    if (selectedAccounts.length !== uniqueUserIds.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'One or more selected accounts cannot be deleted' });
    }

    const deletingAdminCount = selectedAccounts
      .filter(account => ['owner', 'admin'].includes(account.role))
      .length;

    if (deletingAdminCount > 0) {
      const [adminCountRow] = await conn.execute(
        `SELECT COUNT(*) AS admin_count
         FROM users
         WHERE role IN ('owner', 'admin')`
      );

      if (Number(adminCountRow.admin_count) - deletingAdminCount < 1) {
        await conn.rollback();
        return res.status(400).json({ error: 'Cannot delete the last remaining admin' });
      }
    }

    const accountsWithHistory = await conn.execute(
      `SELECT
          u.user_id,
          u.username,
          u.full_name,
          COUNT(DISTINCT v.visit_id) AS visit_count,
          COUNT(DISTINCT q.queue_id) AS queue_count
       FROM users u
       LEFT JOIN visits v ON v.user_id = u.user_id
       LEFT JOIN queues q ON q.visit_id = v.visit_id
       WHERE u.user_id IN (${placeholders})
       GROUP BY u.user_id, u.username, u.full_name
       HAVING visit_count > 0 OR queue_count > 0`,
      uniqueUserIds
    );

    if (accountsWithHistory.length) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        error: 'One or more selected accounts have queue history and cannot be permanently deleted.',
        blocking_accounts: accountsWithHistory.map(account => ({
          user_id: Number(account.user_id),
          username: account.username,
          full_name: account.full_name,
          visit_count: Number(account.visit_count || 0),
          queue_count: Number(account.queue_count || 0)
        }))
      });
    }

    // The users table has no deleted_at/status column, so this is a guarded permanent delete.
    const result = await conn.execute(
      `DELETE FROM users
       WHERE user_id IN (${placeholders}) AND role IN ('admin', 'staff', 'doctor')`,
      uniqueUserIds
    );

    await conn.commit();
    return res.json({
      success: true,
      deleted_count: Number(result.affectedRows || 0)
    });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/admin/staff/:user_id/department', reqLogin, reqAdmin, async (req, res) => {
  const { user_id } = req.params;
  const { departmentId } = req.body;

  if (!departmentId) {
    return res.status(400).json({ error: 'Department is required' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [staff] = await conn.execute(
      `SELECT user_id, role, department_id FROM users WHERE user_id = ?`,
      [user_id]
    );

    if (!staff || !['staff', 'doctor'].includes(staff.role)) {
      return res.status(400).json({ error: 'User is not a staff or doctor account' });
    }

    if (req.session.role === 'staff' && Number(staff.department_id) !== Number(req.session.department_id)) {
      return res.status(403).json({ error: 'You cannot update this staff account' });
    }

    if (!canAccessDepartment(req, departmentId)) {
      return res.status(403).json({ error: 'You cannot assign this department' });
    }

    const [department] = await conn.execute(
      `SELECT department_id FROM departments WHERE department_id = ?`,
      [departmentId]
    );

    if (!department) {
      return res.status(400).json({ error: 'Department not found' });
    }

    await conn.execute(
      `UPDATE users
       SET department_id = ?
       WHERE user_id = ? AND role IN ('staff', 'doctor')`,
      [departmentId, user_id]
    );

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/logout', (req, res) => {
  console.log('logout hit');
  req.session.destroy(err => {
    if (err) {
      return res.status(500).send('Logout failed');
    }

    res.clearCookie('careflow.sid');
    return res.sendStatus(200);
  })
});

app.get('/auth/google', (req, res, next) => {
  if (!googleAuthConfigured()) {
    return res.status(503).send('Google authentication is not configured.');
  }

  return passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (!googleAuthConfigured()) {
    return res.status(503).send('Google authentication is not configured.');
  }

  return passport.authenticate('google', { session: false }, (err, user) => {
    if (err) {
      console.error('Google authentication failed:', err.message);
      return res.redirect('/login?google=failed');
    }

    if (!user) {
      return res.redirect('/login?google=failed');
    }

    req.session.uid = user.user_id;
    req.session.role = user.role;
    req.session.department_id = user.department_id;

    return res.redirect(redirectPathForRole(user.role));
  })(req, res, next);
});

app.post('/api/signup', async (req, res) => {
  console.log(req.body);
  const fullName = String(req.body.fullName || '').trim();
  const contact = String(req.body.contact || '').trim();
  const username = String(req.body.username || '').trim();
  const finalPassword = String(req.body.finalPassword || '');
  const age = normalizeAge(req.body.age);
  const gender = normalizeGender(req.body.gender);
  const email = normalizeEmail(req.body.email);

  if (!fullName || !username || !finalPassword) {
    return res.status(400).json({ error: 'Full name, username, and password are required' });
  }

  if (age === null || !gender) {
    return res.status(400).json({ error: 'Valid age and gender are required' });
  }

  const hashed = await bcrypt.hash(finalPassword, 10);

  let conn;
  try {
    conn = await pool.getConnection();
    await ensureAuthSchema();

    const [existingUser] = await conn.execute(
      `SELECT user_id
       FROM users
       WHERE username = ?
       LIMIT 1`,
      [username]
    );

    if (existingUser) {
      return res.status(409).json({ error: 'Username is already in use' });
    }

    await conn.execute(
      `INSERT INTO users
       (username, contact_number, email, password_hash, full_name, age, gender, auth_provider)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'local')`,
      [username, contact, email, hashed, fullName, age, gender]
    );
    res.json({ "success": true });
  }
  catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username is already in use' });
    }
    res.status(500).json({ error: err.message });
  }
  finally {
    if (conn) conn.release();
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  let conn;

  try {
    conn = await pool.getConnection();

    const [user] = await conn.execute(
      `SELECT user_id, username, password_hash, role, department_id
       FROM users
       WHERE username = ?`,
      [username]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.uid = user.user_id;
    req.session.role = user.role;
    req.session.department_id = user.department_id;

    return res.json({
      success: true,
      role: user.role,
      department_id: user.department_id
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/me', reqLogin, async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();

    const [user] = await conn.execute(
      `SELECT
          u.user_id,
          u.username,
          u.email,
          u.auth_provider,
          u.full_name,
          u.age,
          u.gender,
          u.role,
          u.department_id,
          d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.department_id = u.department_id
       WHERE u.user_id = ?`,
      [req.session.uid]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      success: true,
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        auth_provider: user.auth_provider,
        full_name: user.full_name,
        age: user.age,
        gender: user.gender,
        role: user.role,
        department_id: user.department_id,
        department_name: user.department_name
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/queue/status', reqLogin, async (req, res) => {
  const uid = req.session.uid;

  let conn;

  try {
    await ensurePreferredDoctorSchema();
    conn = await pool.getConnection();

    const [subdepartmentRow] = await conn.execute(
      `SELECT
          q.queue_id,
          r.requirement_id,
          r.transfer_id,
          ${queueCodeSql('d', 'v')} AS code,
          q.full_name,
          q.department_id,
          CASE WHEN r.status = 'serving' THEN 'serving' ELSE 'waiting' END AS status,
          q.is_priority,
          q.is_emergency,
          q.referred_from_queue_id,
          rd.name AS referred_from_department_name,
          q.ai_suggested_department,
          q.ai_category,
          q.ai_priority_level,
          q.ai_reason,
          q.preferred_doctor_user_id,
          COALESCE(pd.full_name, pd.username) AS preferred_doctor_name,
          d.name AS department_name,
          d.queue_status AS department_queue_status,
          r.subdepartment_id,
          sd.name AS subdepartment_name,
          sd.room_number AS subdepartment_room_number,
          CASE
            WHEN sd.room_number IS NOT NULL AND sd.room_number <> ''
              THEN CONCAT(sd.name, ', Room ', sd.room_number)
            ELSE sd.name
          END AS subdepartment_destination,
          (
            SELECT MAX(l.log_id)
            FROM queue_logs l
            WHERE l.queue_id = q.queue_id
              AND l.action IN ('transfer_subdepartment_queued', 'transfer_subdepartment_rerouted', 'subdepartment_called_next', 'recalled')
          ) AS routing_event_id,
          (
            SELECT COUNT(*)
            FROM queue_subdepartment_requirements r2
            JOIN queue_transfers qt2 ON qt2.transfer_id = r2.transfer_id
            JOIN queues q2 ON q2.queue_id = qt2.queue_id
            WHERE r2.subdepartment_id = r.subdepartment_id
              AND r2.status = 'queued'
              AND qt2.status = 'in_subdepartment'
              AND r.status = 'queued'
              AND (
                COALESCE(q2.is_emergency, 0) > COALESCE(q.is_emergency, 0)
                OR (
                  COALESCE(q2.is_emergency, 0) = COALESCE(q.is_emergency, 0)
                  AND COALESCE(q2.is_priority, 0) > COALESCE(q.is_priority, 0)
                )
                OR (
                  COALESCE(q2.is_emergency, 0) = COALESCE(q.is_emergency, 0)
                  AND COALESCE(q2.is_priority, 0) = COALESCE(q.is_priority, 0)
                  AND (
                    COALESCE(r2.queued_at, q2.created_at) < COALESCE(r.queued_at, q.created_at)
                    OR (COALESCE(r2.queued_at, q2.created_at) = COALESCE(r.queued_at, q.created_at) AND q2.queue_id < q.queue_id)
                  )
                )
              )
          ) AS ahead
       FROM queue_subdepartment_requirements r
       JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
       JOIN queues q ON q.queue_id = qt.queue_id
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       JOIN subdepartments sd ON sd.subdepartment_id = r.subdepartment_id
       LEFT JOIN queues rq ON rq.queue_id = q.referred_from_queue_id
       LEFT JOIN departments rd ON rd.department_id = rq.department_id
       LEFT JOIN users pd ON pd.user_id = q.preferred_doctor_user_id
       WHERE q.user_id = ?
         AND qt.status = 'in_subdepartment'
         AND r.status IN ('queued', 'serving')
       ORDER BY (r.status = 'serving') DESC,
                COALESCE(r.queued_at, q.created_at) DESC,
                q.queue_id DESC
       LIMIT 1`,
      [uid]
    );

    if (subdepartmentRow) {
      const queueStatus = subdepartmentRow.department_queue_status || 'open';
      const ahead = subdepartmentRow.status === 'waiting' ? Number(subdepartmentRow.ahead || 0) : 0;

      return res.json({
        success: true,
        queued: true,
        queue_open: queueStatus === 'open',
        queue_status: queueStatus,
        queue_id: subdepartmentRow.queue_id,
        requirement_id: subdepartmentRow.requirement_id,
        transfer_id: subdepartmentRow.transfer_id,
        code: subdepartmentRow.code,
        full_name: subdepartmentRow.full_name,
        status: subdepartmentRow.status,
        department_id: subdepartmentRow.department_id,
        department_name: subdepartmentRow.department_name,
        preferred_doctor_user_id: subdepartmentRow.preferred_doctor_user_id,
        preferred_doctor_name: subdepartmentRow.preferred_doctor_name,
        subdepartment_id: subdepartmentRow.subdepartment_id,
        subdepartment_name: subdepartmentRow.subdepartment_name,
        subdepartment_room_number: subdepartmentRow.subdepartment_room_number,
        subdepartment_destination: subdepartmentRow.subdepartment_destination,
        routing_event_id: subdepartmentRow.routing_event_id,
        referred_from_queue_id: subdepartmentRow.referred_from_queue_id,
        referred_from_department_name: subdepartmentRow.referred_from_department_name,
        referral_message: subdepartmentRow.referred_from_queue_id
          ? `You have been referred to ${subdepartmentRow.department_name}.`
          : null,
        ahead,
        position: subdepartmentRow.status === 'waiting' ? ahead + 1 : null,
        ai: subdepartmentRow.ai_suggested_department || subdepartmentRow.ai_category || subdepartmentRow.ai_priority_level || subdepartmentRow.ai_reason
          ? {
            suggested_department: subdepartmentRow.ai_suggested_department || null,
            category: subdepartmentRow.ai_category || 'general',
            priority_level: subdepartmentRow.ai_priority_level || 'normal',
            reason: subdepartmentRow.ai_reason || ''
          }
          : null
      });
    }

    const [row] = await conn.execute(
      `SELECT
          q.queue_id,
          ${queueCodeSql('d', 'v')} AS code,
          q.full_name,
          q.department_id,
          q.status,
          q.is_priority,
          q.is_emergency,
          q.referred_from_queue_id,
          rd.name AS referred_from_department_name,
          q.ai_suggested_department,
          q.ai_category,
          q.ai_priority_level,
          q.ai_reason,
          q.preferred_doctor_user_id,
          COALESCE(pd.full_name, pd.username) AS preferred_doctor_name,
          d.name AS department_name,
          d.queue_status AS department_queue_status,
          (
            SELECT COUNT(*)
            FROM queues q2
            WHERE q2.department_id = q.department_id
              AND q2.status = 'waiting'
              AND (
                COALESCE(q2.is_emergency, 0) > COALESCE(q.is_emergency, 0)
                OR (
                  COALESCE(q2.is_emergency, 0) = COALESCE(q.is_emergency, 0)
                  AND COALESCE(q2.is_priority, 0) > COALESCE(q.is_priority, 0)
                )
                OR (
                  COALESCE(q2.is_emergency, 0) = COALESCE(q.is_emergency, 0)
                  AND COALESCE(q2.is_priority, 0) = COALESCE(q.is_priority, 0)
                  AND (
                    q2.created_at < q.created_at
                    OR (q2.created_at = q.created_at AND q2.queue_id < q.queue_id)
                  )
                )
              )
          ) AS ahead
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       LEFT JOIN queues rq ON rq.queue_id = q.referred_from_queue_id
       LEFT JOIN departments rd ON rd.department_id = rq.department_id
       LEFT JOIN users pd ON pd.user_id = q.preferred_doctor_user_id
       WHERE q.user_id = ?
         AND q.status IN ('waiting', 'serving')
       ORDER BY q.created_at DESC
       LIMIT 1`,
      [uid]
    );

    if (row) {
      const queueStatus = row.department_queue_status || 'open';
      const ahead = row.status === 'waiting' ? Number(row.ahead || 0) : 0;

      return res.json({
        success: true,
        queued: true,
        queue_open: queueStatus === 'open',
        queue_status: queueStatus,
        queue_id: row.queue_id,
        code: row.code,
        full_name: row.full_name,
        status: row.status,
        department_id: row.department_id,
        department_name: row.department_name,
        preferred_doctor_user_id: row.preferred_doctor_user_id,
        preferred_doctor_name: row.preferred_doctor_name,
        referred_from_queue_id: row.referred_from_queue_id,
        referred_from_department_name: row.referred_from_department_name,
        referral_message: row.referred_from_queue_id
          ? `You have been referred to ${row.department_name}.`
          : null,
        ahead,
        position: row.status === 'waiting' ? ahead + 1 : null,
        ai: row.ai_suggested_department || row.ai_category || row.ai_priority_level || row.ai_reason
          ? {
            suggested_department: row.ai_suggested_department || null,
            category: row.ai_category || 'general',
            priority_level: row.ai_priority_level || 'normal',
            reason: row.ai_reason || ''
          }
          : null
      });
    }

    const [departmentStatus] = await conn.execute(
      `SELECT
          CASE
            WHEN SUM(queue_status = 'open') > 0 THEN 'open'
            ELSE 'closed'
          END AS queue_status
       FROM departments`
    );

    const queueStatus = departmentStatus && departmentStatus.queue_status
      ? departmentStatus.queue_status
      : 'open';

    return res.json({
      success: true,
      queued: false,
      queue_open: queueStatus === 'open',
      queue_status: queueStatus
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/queue/cancel', reqLogin, async (req, res) => {
  const uid = req.session.uid;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [userLock] = await conn.execute(
      `SELECT user_id
       FROM users
       WHERE user_id = ?
       FOR UPDATE`,
      [uid]
    );

    if (!userLock) {
      await conn.rollback();
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
        error: 'Unauthorized'
      });
    }

    const [queue] = await conn.execute(
      `SELECT q.queue_id,
              q.visit_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.status,
              q.department_id,
              qt.transfer_id,
              active_r.status AS active_requirement_status
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       LEFT JOIN queue_transfers qt ON qt.queue_id = q.queue_id
        AND qt.status = 'in_subdepartment'
       LEFT JOIN queue_subdepartment_requirements active_r ON active_r.transfer_id = qt.transfer_id
        AND active_r.status IN ('queued', 'serving')
       WHERE q.user_id = ?
         AND (
           q.status IN ('waiting', 'serving')
           OR active_r.requirement_id IS NOT NULL
         )
       ORDER BY q.created_at DESC, q.queue_id DESC
       LIMIT 1
       FOR UPDATE`,
      [uid]
    );

    const cancellable = queue && (queue.status === 'waiting' || queue.active_requirement_status === 'queued');

    if (!cancellable) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: 'Only waiting queues can be cancelled.',
        error: 'Only waiting queues can be cancelled.'
      });
    }

    await conn.execute(
      `UPDATE queues
       SET status = 'cancelled',
           finished_at = COALESCE(finished_at, NOW())
       WHERE queue_id = ?
         AND status IN ('waiting', 'done')`,
      [queue.queue_id]
    );

    if (queue.transfer_id) {
      await conn.execute(
        `UPDATE queue_subdepartment_requirements
         SET status = 'skipped',
             finished_at = COALESCE(finished_at, NOW())
         WHERE transfer_id = ?
           AND status IN ('pending', 'queued')`,
        [queue.transfer_id]
      );

      await conn.execute(
        `UPDATE queue_transfers
         SET status = 'cancelled',
             completed_at = COALESCE(completed_at, NOW())
         WHERE transfer_id = ?`,
        [queue.transfer_id]
      );
    }

    await logQueueAction(conn, {
      queue_id: queue.queue_id,
      actor_user_id: uid,
      department_id: queue.department_id,
      action: 'queue_cancelled',
      details: {
        code: queue.code,
        cancelled_by: 'patient'
      }
    });

    await updateVisitStatus(conn, queue.visit_id);

    await conn.commit();

    return res.json({
      success: true,
      message: 'Queue cancelled.',
      queue_id: queue.queue_id,
      code: queue.code
    });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({
      success: false,
      message: err.message,
      error: err.message
    });
  } finally {
    conn.release();
  }
});

app.get('/api/admin/notifications', reqLogin, reqStaffOrAdmin, async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();

    const isStaff = req.session.role === 'staff';
    const staffDepartmentId = req.session.department_id;

    const rows = await conn.execute(
      `SELECT
          q.queue_id,
          ${queueCodeSql('d', 'v')} AS code,
          q.full_name,
          q.category,
          q.is_priority,
          q.is_emergency,
          q.status,
          q.created_at,
          d.name AS department_name,
          TIMESTAMPDIFF(MINUTE, q.created_at, NOW()) AS waiting_minutes
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE q.status = 'waiting'
         AND (? = 0 OR q.department_id = ?)
       ORDER BY
         q.is_emergency DESC,
         q.is_priority DESC,
         q.created_at ASC
       LIMIT 8`,
      [
        isStaff ? 1 : 0,
        isStaff ? staffDepartmentId : 0
      ]
    );

    const notifications = rows.map(row => {
      if (row.is_emergency) {
        return {
          type: 'urgent',
          text: `Emergency queue ${row.code} is waiting in ${row.department_name}`,
          time: `${Number(row.waiting_minutes || 0)} minutes waiting`
        };
      }

      if (row.is_priority) {
        return {
          type: 'priority',
          text: `Priority queue ${row.code} is waiting in ${row.department_name}`,
          time: `${Number(row.waiting_minutes || 0)} minutes waiting`
        };
      }

      if (Number(row.waiting_minutes || 0) >= 30) {
        return {
          type: 'delay',
          text: `Queue ${row.code} has been waiting for more than 30 minutes`,
          time: `${Number(row.waiting_minutes || 0)} minutes waiting`
        };
      }

      return null;
    }).filter(Boolean);

    return res.json({
      success: true,
      notifications
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});


app.get('/api/admin/dashboard/bootstrap', reqLogin, reqStaffOrAdmin, async (req, res) => {
  let conn;

  try {
    await ensureDepartmentSchema();
    conn = await pool.getConnection();

    const isStaff = req.session.role === 'staff';
    const staffDepartmentId = req.session.department_id;

    if (isStaff && !staffDepartmentId) {
      return res.status(403).json({
        error: 'Staff account has no assigned department'
      });
    }

    const departments = await conn.execute(
      `SELECT d.department_id, d.name, d.code, d.queue_status, d.image_url,
              CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM subdepartments sd
                  WHERE sd.department_id = d.department_id
                    AND sd.deleted_at IS NULL
                )
                THEN (
                  SELECT COUNT(*)
                  FROM queue_subdepartment_requirements r
                  JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
                  WHERE qt.to_department_id = d.department_id
                    AND r.status IN ('queued', 'serving')
                )
                ELSE (
                  SELECT COUNT(*)
                  FROM queues q
                  WHERE q.department_id = d.department_id
                    AND q.status IN ('waiting', 'serving')
                )
              END AS queue_count
	       FROM departments d
	       WHERE (? = 0 OR d.department_id = ?)
	       ORDER BY d.name ASC`,
      [
        isStaff ? 1 : 0,
        isStaff ? staffDepartmentId : 0
      ]
    );

    const counters = await conn.execute(
      `SELECT c.counter_id, c.department_id, c.name, c.status, c.break_until,
	              c.current_queue_id, ${queueCodeSql('d', 'v')} AS current_queue_code
	       FROM counters c
	       LEFT JOIN queues q ON q.queue_id = c.current_queue_id
	       LEFT JOIN departments d ON d.department_id = q.department_id
	       LEFT JOIN visits v ON v.visit_id = q.visit_id
	       WHERE c.deleted_at IS NULL
	         AND (? = 0 OR c.department_id = ?)
	       ORDER BY c.department_id ASC, c.counter_id ASC`,
      [
        isStaff ? 1 : 0,
        isStaff ? staffDepartmentId : 0
      ]
    );

    const subdepartments = await conn.execute(
      `SELECT sd.subdepartment_id, sd.department_id, sd.name, sd.room_number, sd.status,
              sd.current_queue_id, ${queueCodeSql('d', 'v')} AS current_queue_code
       FROM subdepartments sd
       LEFT JOIN queues q ON q.queue_id = sd.current_queue_id
       LEFT JOIN departments d ON d.department_id = q.department_id
       LEFT JOIN visits v ON v.visit_id = q.visit_id
       WHERE sd.deleted_at IS NULL
         AND (? = 0 OR sd.department_id = ?)
       ORDER BY sd.department_id ASC, sd.name ASC, sd.subdepartment_id ASC`,
      [
        isStaff ? 1 : 0,
        isStaff ? staffDepartmentId : 0
      ]
    );

    const settingsRows = await conn.execute(
      `SELECT queue_status FROM system_settings WHERE id = 1 LIMIT 1`
    );

    const queueStatus = settingsRows.length ? settingsRows[0].queue_status : 'open';

    return res.json({
      success: true,
      role: req.session.role,
      assigned_department_id: req.session.department_id,
      departments,
      counters,
      subdepartments,
      queue_status: queueStatus
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/admin/dashboard/department/:department_id', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id } = req.params;

  if (!canAccessDepartment(req, department_id)) {
    return res.status(403).json({ error: 'You cannot access this department' });
  }

  let conn;

  try {
    await ensurePreferredDoctorSchema();
    conn = await pool.getConnection();

    const [subdepartmentCount] = await conn.execute(
      `SELECT COUNT(*) AS count
       FROM subdepartments
       WHERE department_id = ?
         AND deleted_at IS NULL`,
      [department_id]
    );

    if (Number(subdepartmentCount && subdepartmentCount.count || 0) > 0) {
      return res.json({ success: true, queues: [] });
    }

    const rows = await conn.execute(
      `SELECT
          q.queue_id,
          ${queueCodeSql('d', 'v')} AS code,
          q.full_name,
          q.status,
          q.category,
          q.visit_description,
          q.is_priority,
          q.is_emergency,
          q.ai_suggested_department,
          q.ai_category,
          q.ai_priority_level,
          q.ai_reason,
          q.created_at,
	          q.called_at,
	          q.finished_at,
	          COALESCE(q.age, u.age) AS age,
	          COALESCE(q.gender, u.gender) AS gender,
            q.preferred_doctor_user_id,
            COALESCE(pd.full_name, pd.username) AS preferred_doctor_name,
	          COALESCE(q.counter_id, c.counter_id) AS counter_id,
	          COALESCE(assigned_c.name, c.name) AS counter_name,
            COALESCE(q.subdepartment_id, active_req.subdepartment_id) AS subdepartment_id,
            COALESCE(sd.name, active_sd.name) AS subdepartment_name,
            COALESCE(sd.room_number, active_sd.room_number) AS subdepartment_room_number
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       LEFT JOIN users u ON u.user_id = q.user_id
       LEFT JOIN users pd ON pd.user_id = q.preferred_doctor_user_id
       LEFT JOIN counters c ON c.current_queue_id = q.queue_id
       LEFT JOIN counters assigned_c ON assigned_c.counter_id = q.counter_id
       LEFT JOIN subdepartments sd ON sd.subdepartment_id = q.subdepartment_id
       LEFT JOIN queue_transfers active_transfer
         ON active_transfer.queue_id = q.queue_id
        AND active_transfer.status = 'in_subdepartment'
       LEFT JOIN queue_subdepartment_requirements active_req
         ON active_req.transfer_id = active_transfer.transfer_id
        AND active_req.status IN ('queued', 'serving')
       LEFT JOIN subdepartments active_sd ON active_sd.subdepartment_id = active_req.subdepartment_id
       WHERE q.department_id = ?
         AND q.status IN ('waiting', 'serving')
       ORDER BY
         (q.status = 'serving') DESC,
         CASE WHEN q.status = 'serving' THEN q.called_at END DESC,
         q.is_emergency DESC,
         q.is_priority DESC,
         q.created_at ASC,
         q.queue_id ASC`,
      [department_id]
    );

    return res.json({
      success: true,
      queues: rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/admin/counters/:counter_id/status', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { counter_id } = req.params;
  const { available } = req.body;
  const status = available ? 'open' : 'break';
  let conn;
  try {
    conn = await pool.getConnection();

    const [counter] = await conn.execute(
      `SELECT counter_id, department_id
       FROM counters
       WHERE counter_id = ?
         AND deleted_at IS NULL`,
      [counter_id]
    );

    if (!counter) {
      return res.status(404).json({ error: 'Counter not found' });
    }

    if (!canAccessDepartment(req, counter.department_id)) {
      return res.status(403).json({ error: 'You cannot update this counter' });
    }

    await conn.execute(
      `UPDATE counters SET status = ? WHERE counter_id = ?`,
      [status, counter_id]
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/admin/ui-settings', reqLogin, reqAdmin, async (req, res) => {
  const { systemName, logoText, primaryColor, footerText } = req.body;

  let conn;

  try {
    conn = await pool.getConnection();

    await conn.execute(
      `INSERT INTO ui_settings
       (id, system_name, logo_text, primary_color, footer_text)
       VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         system_name = VALUES(system_name),
         logo_text = VALUES(logo_text),
         primary_color = VALUES(primary_color),
         footer_text = VALUES(footer_text)`,
      [
        systemName || 'CareFlow',
        logoText || 'CareFlow',
        primaryColor || '#1d9c6c',
        footerText || 'CareFlow Queue Management'
      ]
    );

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/ui-settings', reqLogin, async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();

    const [settings] = await conn.execute(
      `SELECT system_name, logo_text, primary_color, footer_text
       FROM ui_settings
       WHERE id = 1`
    );

    return res.json({
      success: true,
      settings: settings || {
        system_name: 'CareFlow',
        logo_text: 'CareFlow',
        primary_color: '#1d9c6c',
        footer_text: 'CareFlow Queue Management'
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/admin/counters', reqLogin, reqAdmin, async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT
          c.counter_id,
          c.department_id,
          d.name AS department_name,
          c.name,
          c.status,
          c.break_until,
          c.current_queue_id,
          ${queueCodeSql('qd', 'v')} AS current_queue_code
       FROM counters c
       JOIN departments d ON d.department_id = c.department_id
       LEFT JOIN queues q ON q.queue_id = c.current_queue_id
       LEFT JOIN departments qd ON qd.department_id = q.department_id
       LEFT JOIN visits v ON v.visit_id = q.visit_id
       WHERE c.deleted_at IS NULL
       ORDER BY d.name ASC, c.counter_id ASC`
    );

    return res.json({
      success: true,
      counters: rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/admin/counters', reqLogin, reqAdmin, async (req, res) => {
  const { name, departmentId, status } = req.body;

  if (!name || !departmentId) {
    return res.status(400).json({ error: 'Counter name and department are required' });
  }

  const allowedStatuses = ['open', 'break', 'closed'];
  const finalStatus = allowedStatuses.includes(status) ? status : 'open';

  let conn;

  try {
    conn = await pool.getConnection();

    const [department] = await conn.execute(
      `SELECT department_id FROM departments WHERE department_id = ?`,
      [departmentId]
    );

    if (!department) {
      return res.status(400).json({ error: 'Department not found' });
    }

    const result = await conn.execute(
      `INSERT INTO counters (department_id, name, status)
       VALUES (?, ?, ?)`,
      [departmentId, name, finalStatus]
    );

    return res.json({
      success: true,
      counter_id: Number(result.insertId)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/admin/counters/:counter_id', reqLogin, reqAdmin, async (req, res) => {
  const { counter_id } = req.params;
  const { name, departmentId, status } = req.body;

  if (!name || !departmentId || !status) {
    return res.status(400).json({ error: 'Counter name, department, and status are required' });
  }

  const allowedStatuses = ['open', 'break', 'closed'];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid counter status' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [department] = await conn.execute(
      `SELECT department_id FROM departments WHERE department_id = ?`,
      [departmentId]
    );

    if (!department) {
      return res.status(400).json({ error: 'Department not found' });
    }

    const result = await conn.execute(
      `UPDATE counters
       SET department_id = ?,
           name = ?,
           status = ?
       WHERE counter_id = ?
         AND deleted_at IS NULL`,
      [departmentId, name, status, counter_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Counter not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.delete('/api/admin/counters/:counter_id', reqLogin, reqAdmin, async (req, res) => {
  const { counter_id } = req.params;

  let conn;

  try {
    conn = await pool.getConnection();

    const [counter] = await conn.execute(
      `SELECT counter_id, current_queue_id
       FROM counters
       WHERE counter_id = ?
         AND deleted_at IS NULL`,
      [counter_id]
    );

    if (!counter) {
      return res.status(404).json({ error: 'Counter not found' });
    }

    if (counter.current_queue_id) {
      return res.status(400).json({
        error: 'Cannot delete a counter that is currently serving a queue'
      });
    }

    await conn.execute(
      `UPDATE counters
       SET status = 'closed',
           deleted_at = NOW()
       WHERE counter_id = ?
         AND deleted_at IS NULL`,
      [counter_id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/admin/subdepartments', reqLogin, reqAdmin, async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT
          sd.subdepartment_id,
          sd.department_id,
          sd.name,
          sd.room_number,
          sd.status,
          sd.current_queue_id,
          ${queueCodeSql('qd', 'v')} AS current_queue_code,
          d.name AS department_name
       FROM subdepartments sd
       JOIN departments d ON d.department_id = sd.department_id
       LEFT JOIN queues q ON q.queue_id = sd.current_queue_id
       LEFT JOIN departments qd ON qd.department_id = q.department_id
       LEFT JOIN visits v ON v.visit_id = q.visit_id
       WHERE sd.deleted_at IS NULL
       ORDER BY d.name ASC, sd.name ASC, sd.subdepartment_id ASC`
    );

    return res.json({ success: true, subdepartments: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/admin/subdepartments', reqLogin, reqAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const roomNumber = normalizeRoomNumber(req.body.roomNumber ?? req.body.room_number);
  const departmentId = Number(req.body.departmentId || req.body.department_id);
  const status = ['open', 'break', 'closed'].includes(req.body.status) ? req.body.status : 'open';

  if (!name || !roomNumber || !departmentId) {
    return res.status(400).json({ error: 'Subdepartment name, room number, and department are required' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [department] = await conn.execute(
      `SELECT department_id FROM departments WHERE department_id = ?`,
      [departmentId]
    );

    if (!department) {
      return res.status(400).json({ error: 'Department not found' });
    }

    const [existingRoom] = await conn.execute(
      `SELECT subdepartment_id
       FROM subdepartments
       WHERE department_id = ?
         AND room_number = ?
         AND deleted_at IS NULL
       LIMIT 1`,
      [departmentId, roomNumber]
    );

    if (existingRoom) {
      return res.status(400).json({ error: 'Room number is already assigned in this department' });
    }

    const result = await conn.execute(
      `INSERT INTO subdepartments (department_id, name, room_number, status)
       VALUES (?, ?, ?, ?)`,
      [departmentId, name, roomNumber, status]
    );

    return res.json({ success: true, subdepartment_id: Number(result.insertId) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/admin/subdepartments/:subdepartment_id', reqLogin, reqAdmin, async (req, res) => {
  const subdepartmentId = Number(req.params.subdepartment_id);
  const name = String(req.body.name || '').trim();
  const roomNumber = normalizeRoomNumber(req.body.roomNumber ?? req.body.room_number);
  const departmentId = Number(req.body.departmentId || req.body.department_id);
  const status = String(req.body.status || '').trim();

  if (!name || !roomNumber || !departmentId || !['open', 'break', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Subdepartment name, room number, department, and valid status are required' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [department] = await conn.execute(
      `SELECT department_id FROM departments WHERE department_id = ?`,
      [departmentId]
    );

    if (!department) {
      return res.status(400).json({ error: 'Department not found' });
    }

    const [existingRoom] = await conn.execute(
      `SELECT subdepartment_id
       FROM subdepartments
       WHERE department_id = ?
         AND room_number = ?
         AND subdepartment_id <> ?
         AND deleted_at IS NULL
       LIMIT 1`,
      [departmentId, roomNumber, subdepartmentId]
    );

    if (existingRoom) {
      return res.status(400).json({ error: 'Room number is already assigned in this department' });
    }

    const result = await conn.execute(
      `UPDATE subdepartments
       SET department_id = ?,
           name = ?,
           room_number = ?,
           status = ?
       WHERE subdepartment_id = ?
         AND deleted_at IS NULL`,
      [departmentId, name, roomNumber, status, subdepartmentId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Subdepartment not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.delete('/api/admin/subdepartments/:subdepartment_id', reqLogin, reqAdmin, async (req, res) => {
  const subdepartmentId = Number(req.params.subdepartment_id);
  let conn;

  try {
    conn = await pool.getConnection();

    const [subdepartment] = await conn.execute(
      `SELECT subdepartment_id, current_queue_id
       FROM subdepartments
       WHERE subdepartment_id = ?
         AND deleted_at IS NULL`,
      [subdepartmentId]
    );

    if (!subdepartment) {
      return res.status(404).json({ error: 'Subdepartment not found' });
    }

    if (subdepartment.current_queue_id) {
      return res.status(400).json({ error: 'Cannot delete a subdepartment that is currently serving a queue' });
    }

    await conn.execute(
      `UPDATE subdepartments
       SET deleted_at = NOW(),
           status = 'closed'
       WHERE subdepartment_id = ?`,
      [subdepartmentId]
    );

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/admin/schedules', reqLogin, reqAdmin, async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT
          s.schedule_id,
          s.department_id,
          d.name AS department_name,
          s.day_of_week,
          TIME_FORMAT(s.opens_at, '%H:%i') AS opens_at,
          TIME_FORMAT(s.closes_at, '%H:%i') AS closes_at,
          s.is_closed,
          s.note
       FROM department_schedules s
       JOIN departments d ON d.department_id = s.department_id
       ORDER BY d.name ASC, s.day_of_week ASC`
    );

    return res.json({
      success: true,
      schedules: rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/admin/schedules', reqLogin, reqAdmin, async (req, res) => {
  const schedule = normalizeSchedulePayload(req.body);

  if (schedule.error) {
    return res.status(400).json({ error: schedule.error });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [department] = await conn.execute(
      `SELECT department_id FROM departments WHERE department_id = ?`,
      [schedule.departmentId]
    );

    if (!department) {
      return res.status(400).json({ error: 'Department not found' });
    }

    await conn.execute(
      `INSERT INTO department_schedules
         (department_id, day_of_week, opens_at, closes_at, is_closed, note)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         opens_at = VALUES(opens_at),
         closes_at = VALUES(closes_at),
         is_closed = VALUES(is_closed),
         note = VALUES(note)`,
      [
        schedule.departmentId,
        schedule.dayOfWeek,
        schedule.opensAt,
        schedule.closesAt,
        schedule.isClosed ? 1 : 0,
        schedule.note
      ]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/admin/schedules/:schedule_id', reqLogin, reqAdmin, async (req, res) => {
  const { schedule_id } = req.params;
  const schedule = normalizeSchedulePayload(req.body);

  if (schedule.error) {
    return res.status(400).json({ error: schedule.error });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [department] = await conn.execute(
      `SELECT department_id FROM departments WHERE department_id = ?`,
      [schedule.departmentId]
    );

    if (!department) {
      return res.status(400).json({ error: 'Department not found' });
    }

    const result = await conn.execute(
      `UPDATE department_schedules
       SET department_id = ?,
           day_of_week = ?,
           opens_at = ?,
           closes_at = ?,
           is_closed = ?,
           note = ?
       WHERE schedule_id = ?`,
      [
        schedule.departmentId,
        schedule.dayOfWeek,
        schedule.opensAt,
        schedule.closesAt,
        schedule.isClosed ? 1 : 0,
        schedule.note,
        schedule_id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This department already has a schedule for that day' });
    }
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.delete('/api/admin/schedules/:schedule_id', reqLogin, reqAdmin, async (req, res) => {
  const { schedule_id } = req.params;

  let conn;

  try {
    conn = await pool.getConnection();

    const result = await conn.execute(
      `DELETE FROM department_schedules WHERE schedule_id = ?`,
      [schedule_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/admin/queue-status', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queueOpen } = req.body;
  const queueStatus = queueOpen ? 'open' : 'closed';
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO system_settings (id, queue_status)
       VALUES (1, ?)
       ON DUPLICATE KEY UPDATE queue_status = VALUES(queue_status)`,
      [queueStatus]
    );

    await logQueueAction(conn, {
      actor_user_id: req.session.uid,
      action: 'status_changed',
      details: {
        scope: 'global_queue_status',
        queue_status: queueStatus
      }
    });

    await conn.commit();
    return res.json({ success: true, queue_status: queueStatus });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});


app.patch('/api/admin/skip/:queue_id', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queue_id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [queue] = await conn.execute(
      `SELECT queue_id, visit_id, department_id
	       FROM queues
       WHERE queue_id = ?`,
      [queue_id]
    );

    if (!queue) {
      await conn.rollback();
      return res.status(404).json({ error: 'Queue entry not found' });
    }

    if (!canAccessDepartment(req, queue.department_id)) {
      await conn.rollback();
      return res.status(403).json({ error: 'You cannot update this queue entry' });
    }

    await conn.execute(
      `UPDATE queues
	       SET status = 'no_show',
	           finished_at = COALESCE(finished_at, NOW())
	       WHERE queue_id = ?
	         AND status IN ('waiting', 'serving')`,
      [queue_id]
    );

    await conn.execute(
      `UPDATE counters
	       SET current_queue_id = NULL
	       WHERE current_queue_id = ?`,
      [queue_id]
    );

    await conn.execute(
      `UPDATE subdepartments
       SET current_queue_id = NULL
       WHERE current_queue_id = ?`,
      [queue_id]
    );

    const advancedQueue = await finishTransferItemForQueue(conn, queue.queue_id, 'skipped', req.session.uid);
    await rebalanceSubdepartmentQueues(conn, queue.department_id, req.session.uid);

    await logQueueAction(conn, {
      queue_id,
      actor_user_id: req.session.uid,
      department_id: queue.department_id,
      action: 'skipped',
      details: {
        notes: req.body && req.body.notes ? req.body.notes : null,
        advanced_queue_id: advancedQueue ? advancedQueue.queue_id : null
      }
    });

    await updateVisitStatus(conn, queue.visit_id);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.patch('/api/admin/cancel/:queue_id', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queue_id } = req.params;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [queue] = await conn.execute(
      `SELECT queue_id, visit_id, department_id, status
       FROM queues
       WHERE queue_id = ?
       FOR UPDATE`,
      [queue_id]
    );

    if (!queue) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: 'Queue entry not found',
        error: 'Queue entry not found'
      });
    }

    if (!canAccessDepartment(req, queue.department_id)) {
      await conn.rollback();
      return res.status(403).json({
        success: false,
        message: 'You cannot cancel this queue entry',
        error: 'You cannot cancel this queue entry'
      });
    }

    if (queue.status !== 'waiting') {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: 'Only waiting queues can be cancelled.',
        error: 'Only waiting queues can be cancelled.'
      });
    }

    await conn.execute(
      `UPDATE queues
       SET status = 'cancelled',
           finished_at = COALESCE(finished_at, NOW())
       WHERE queue_id = ?
         AND status = 'waiting'`,
      [queue_id]
    );

    await logQueueAction(conn, {
      queue_id,
      actor_user_id: req.session.uid,
      department_id: queue.department_id,
      action: 'queue_cancelled',
      details: {
        cancelled_by: 'admin'
      }
    });

    await updateVisitStatus(conn, queue.visit_id);

    await conn.commit();

    return res.json({
      success: true,
      message: 'Queue cancelled.',
      queue_id: Number(queue_id)
    });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({
      success: false,
      message: err.message,
      error: err.message
    });
  } finally {
    conn.release();
  }
});

app.delete('/api/admin/delete/:queue_id', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queue_id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [queue] = await conn.execute(
      `SELECT queue_id, visit_id, department_id, status
       FROM queues
       WHERE queue_id = ?`,
      [queue_id]
    );

    if (!queue) {
      await conn.rollback();
      return res.status(404).json({ error: 'Queue entry not found' });
    }

    if (!canAccessDepartment(req, queue.department_id)) {
      await conn.rollback();
      return res.status(403).json({ error: 'You cannot delete this queue entry' });
    }

    await conn.execute(
      `UPDATE queues
       SET status = 'void',
           finished_at = COALESCE(finished_at, NOW())
       WHERE queue_id = ?
         AND status IN ('waiting', 'serving')`,
      [queue_id]
    );

    await conn.execute(
      `UPDATE counters
	       SET current_queue_id = NULL
	       WHERE current_queue_id = ?`,
      [queue_id]
    );

    await logQueueAction(conn, {
      queue_id,
      actor_user_id: req.session.uid,
      department_id: queue.department_id,
      action: 'deleted',
      details: {
        previous_status: queue.status,
        deleted_as: 'void'
      }
    });

    await updateVisitStatus(conn, queue.visit_id);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.post('/api/admin/served', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id } = req.body;
  if (!canAccessDepartment(req, department_id)) {
    return res.status(403).json({ error: 'You cannot update this department' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const servingRows = await conn.execute(
      `SELECT q.queue_id, q.visit_id, c.counter_id
	       FROM queues q
	       LEFT JOIN counters c ON c.current_queue_id = q.queue_id
	       WHERE q.department_id = ?
	         AND q.status = 'serving'`,
      [department_id]
    );

    await conn.execute(
      `UPDATE queues
	       SET status = 'done', finished_at = NOW()
	       WHERE department_id = ? AND status = 'serving'`,
      [department_id]
    );

    await conn.execute(
      `UPDATE counters
	       SET current_queue_id = NULL
	       WHERE department_id = ?
	         AND current_queue_id IS NOT NULL`,
      [department_id]
    );

    for (const row of servingRows) {
      await logQueueAction(conn, {
        queue_id: row.queue_id,
        actor_user_id: req.session.uid,
        department_id,
        action: 'served',
        details: {
          counter_id: row.counter_id || null
        }
      });
      await updateVisitStatus(conn, row.visit_id);
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.post('/api/admin/clear', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id } = req.body;
  if (!canAccessDepartment(req, department_id)) {
    return res.status(403).json({ error: 'You cannot update this department' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const rows = await conn.execute(
      `SELECT queue_id, visit_id
	       FROM queues
	       WHERE department_id = ? AND status = 'waiting'`,
      [department_id]
    );

    await conn.execute(
      `UPDATE queues SET status = 'void'
	       WHERE department_id = ? AND status = 'waiting'`,
      [department_id]
    );

    for (const row of rows) {
      await logQueueAction(conn, {
        queue_id: row.queue_id,
        actor_user_id: req.session.uid,
        department_id,
        action: 'cleared',
        details: {
          previous_status: 'waiting',
          new_status: 'void'
        }
      });
      await updateVisitStatus(conn, row.visit_id);
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});


app.post('/api/admin/next', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id, counter_id } = req.body;
  if (!canAccessDepartment(req, department_id)) {
    return res.status(403).json({
      success: false,
      message: 'You cannot update this department',
      error: 'You cannot update this department'
    });
  }

  const conn = await pool.getConnection();
  let notification = null;

  try {
    await conn.beginTransaction();

    const [departmentLock] = await conn.execute(
      `SELECT department_id
       FROM departments
       WHERE department_id = ?
       FOR UPDATE`,
      [department_id]
    );

    if (!departmentLock) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: 'Department not found',
        error: 'Department not found'
      });
    }

    const [subdepartmentConfig] = await conn.execute(
      `SELECT COUNT(*) AS count
       FROM subdepartments
       WHERE department_id = ?
         AND deleted_at IS NULL`,
      [department_id]
    );

    if (Number(subdepartmentConfig.count || 0) > 0) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Use subdepartment queues for this department',
        error: 'Use subdepartment queues for this department'
      });
    }

    let selectedCounter = null;

    if (counter_id) {
      const [counter] = await conn.execute(
        `SELECT counter_id, department_id, name, status, current_queue_id
	         FROM counters
	         WHERE counter_id = ?
	           AND department_id = ?
	           AND deleted_at IS NULL
	         FOR UPDATE`,
        [counter_id, department_id]
      );

      if (!counter) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: 'Counter not found for this department',
          error: 'Counter not found for this department'
        });
      }

      if (counter.status !== 'open') {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: 'Selected counter is not open',
          error: 'Selected counter is not open'
        });
      }

      selectedCounter = counter;
    } else {
      const [counter] = await conn.execute(
        `SELECT counter_id, department_id, name, status, current_queue_id
	         FROM counters
	         WHERE department_id = ?
	           AND status = 'open'
	           AND deleted_at IS NULL
	         ORDER BY counter_id ASC
	         LIMIT 1
	         FOR UPDATE`,
        [department_id]
      );

      selectedCounter = counter || null;
    }

    const [recentServing] = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.category,
              c.counter_id,
              c.name AS counter_name
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       LEFT JOIN counters c ON c.current_queue_id = q.queue_id
       WHERE q.department_id = ?
         AND q.status = 'serving'
         AND q.subdepartment_id IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM queue_transfers qt
           WHERE qt.queue_id = q.queue_id
             AND qt.status = 'in_subdepartment'
         )
         AND q.called_at >= NOW() - INTERVAL 2 SECOND
       ORDER BY q.called_at DESC, q.queue_id DESC
       LIMIT 1
       FOR UPDATE`,
      [department_id]
    );

    if (recentServing) {
      await conn.commit();
      return res.json({
        success: true,
        next: recentServing,
        message: 'Call Next is already processing the current queue.'
      });
    }

    const servingRows = await conn.execute(
      `SELECT q.queue_id,
              q.visit_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.department_id,
              d.name AS department_name,
              q.category,
              q.status,
              c.counter_id
	       FROM queues q
	       JOIN departments d ON d.department_id = q.department_id
	       JOIN visits v ON v.visit_id = q.visit_id
	       LEFT JOIN counters c ON c.current_queue_id = q.queue_id
	       WHERE q.department_id = ?
	         AND q.status = 'serving'
           AND q.subdepartment_id IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM queue_transfers qt
             WHERE qt.queue_id = q.queue_id
               AND qt.status = 'in_subdepartment'
           )
	       FOR UPDATE`,
      [department_id]
    );

    await conn.execute(
      `UPDATE queues
	       SET status = 'done',
	           finished_at = NOW()
	       WHERE department_id = ?
	         AND status = 'serving'
           AND subdepartment_id IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM queue_transfers qt
             WHERE qt.queue_id = queues.queue_id
               AND qt.status = 'in_subdepartment'
           )`,
      [department_id]
    );

    await conn.execute(
      `UPDATE counters
	       SET current_queue_id = NULL
	       WHERE department_id = ?
	         AND current_queue_id IS NOT NULL`,
      [department_id]
    );

    for (const row of servingRows) {
      await logQueueAction(conn, {
        queue_id: row.queue_id,
        actor_user_id: req.session.uid,
        department_id,
        action: 'served',
        details: {
          counter_id: row.counter_id || null,
          source: 'call_next'
        }
      });
      await updateVisitStatus(conn, row.visit_id);
    }

    const [next] = await conn.execute(
      `SELECT q.queue_id,
              q.visit_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.category,
              q.department_id,
              d.name AS department_name,
              u.email,
              COALESCE(q.full_name, u.full_name, u.username, 'Patient') AS patient_name
	       FROM queues q
	       JOIN departments d ON d.department_id = q.department_id
	       JOIN visits v ON v.visit_id = q.visit_id
	       LEFT JOIN users u ON u.user_id = q.user_id
	       WHERE q.department_id = ?
	         AND q.status = 'waiting'
           AND q.subdepartment_id IS NULL
	       ORDER BY q.is_emergency DESC,
	                q.is_priority DESC,
	                q.created_at ASC,
	                q.queue_id ASC
	       LIMIT 1
	       FOR UPDATE`,
      [department_id]
    );

    if (!next) {
      await conn.commit();
      return res.json({
        success: true,
        next: null,
        completed_queue: servingRows[0] ? {
          ...servingRows[0],
          status: 'done'
        } : null,
        message: 'Current patient marked as served. No waiting patients left.'
      });
    }

    const activatedTransfer = await activateTransferOnDepartmentCall(conn, next.queue_id, req.session.uid);
    let responseNext = next;
    let notificationCounterName = selectedCounter ? selectedCounter.name : null;
    let responseMessage = 'Queue called. Email notification sent if patient has an email.';

    if (activatedTransfer) {
      const assignedDestination = activatedTransfer.assigned_queue
        ? activatedTransfer.assigned_queue.subdepartment_destination
          || formatSubdepartmentDestination(
            activatedTransfer.assigned_queue.subdepartment_name,
            activatedTransfer.assigned_queue.subdepartment_room_number
          )
        : null;
      responseNext = {
        ...next,
        status: 'done',
        counter_id: null,
        counter_name: null,
        assigned_subdepartment_id: activatedTransfer.assigned_queue ? activatedTransfer.assigned_queue.subdepartment_id : null,
        assigned_subdepartment_name: activatedTransfer.assigned_queue ? activatedTransfer.assigned_queue.subdepartment_name : null,
        assigned_subdepartment_room_number: activatedTransfer.assigned_queue ? activatedTransfer.assigned_queue.subdepartment_room_number : null,
        assigned_subdepartment_destination: assignedDestination
      };
      notificationCounterName = assignedDestination;
      responseMessage = activatedTransfer.assigned_queue
        ? `Dispatched ${next.code} to ${assignedDestination}.`
        : `Dispatched ${next.code}. No open subdepartments were available.`;
      await updateVisitStatus(conn, next.visit_id);
    } else {
      await conn.execute(
        `UPDATE queues
	         SET status = 'serving',
	             called_at = NOW()
	         WHERE queue_id = ?`,
        [next.queue_id]
      );

      if (selectedCounter) {
        await conn.execute(
          `UPDATE counters
	           SET current_queue_id = ?
	           WHERE counter_id = ?`,
          [next.queue_id, selectedCounter.counter_id]
        );
      }
    }

    await logQueueAction(conn, {
      queue_id: next.queue_id,
      actor_user_id: req.session.uid,
      department_id,
      action: activatedTransfer ? 'dispatched_to_subdepartment' : 'called_next',
      details: {
        code: next.code,
        counter_id: responseNext.counter_id || null,
        counter_name: notificationCounterName,
        subdepartment_id: responseNext.assigned_subdepartment_id || responseNext.subdepartment_id || null,
        transfer_id: activatedTransfer ? activatedTransfer.transfer_id : null
      }
    });

    await conn.commit();

    notification = next.email ? {
      queueId: next.queue_id,
      actorUserId: req.session.uid,
      departmentId: next.department_id,
      to: next.email,
      patientName: next.patient_name,
      queueCode: next.code,
      departmentName: next.department_name,
      counterName: notificationCounterName,
      type: 'call'
    } : null;
    queueNotificationEmail(notification);

    return res.json({
      success: true,
      message: responseMessage,
      completed_queue: servingRows[0] ? {
        ...servingRows[0],
        status: 'done'
      } : null,
      next: activatedTransfer
        ? {
            ...responseNext,
            assigned_subdepartment: activatedTransfer.assigned_queue
              ? {
                  subdepartment_id: activatedTransfer.assigned_queue.subdepartment_id,
                  name: activatedTransfer.assigned_queue.subdepartment_name,
                  room_number: activatedTransfer.assigned_queue.subdepartment_room_number,
                  destination: responseNext.assigned_subdepartment_destination
                }
              : null
          }
        : {
            ...responseNext,
            counter_id: selectedCounter ? selectedCounter.counter_id : null,
            counter_name: selectedCounter ? selectedCounter.name : null
          }
    });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({
      success: false,
      message: err.message,
      error: err.message
    });
  } finally {
    conn.release();
  }
});

app.post('/api/admin/queues/:queue_id/recall', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queue_id } = req.params;
  let conn;
  let notification = null;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [queue] = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.department_id,
              q.status,
              d.name AS department_name,
              c.name AS counter_name,
              u.email,
              COALESCE(q.full_name, u.full_name, u.username, 'Patient') AS patient_name
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       LEFT JOIN users u ON u.user_id = q.user_id
       LEFT JOIN counters c ON c.current_queue_id = q.queue_id
       WHERE q.queue_id = ?
       FOR UPDATE`,
      [queue_id]
    );

    if (!queue) {
      await conn.rollback();
      return res.status(404).json({ error: 'Queue entry not found' });
    }

    if (!canAccessDepartment(req, queue.department_id)) {
      await conn.rollback();
      return res.status(403).json({ error: 'You cannot recall this queue entry' });
    }

    await logQueueAction(conn, {
      queue_id,
      actor_user_id: req.session.uid,
      department_id: queue.department_id,
      action: 'recalled',
      details: {
        status: queue.status
      }
    });

    await conn.commit();

    notification = queue.email ? {
      queueId: queue.queue_id,
      actorUserId: req.session.uid,
      departmentId: queue.department_id,
      to: queue.email,
      patientName: queue.patient_name,
      queueCode: queue.code,
      departmentName: queue.department_name,
      counterName: queue.counter_name,
      type: 'recall'
    } : null;
    queueNotificationEmail(notification);

    return res.json({
      success: true,
      message: 'Queue recalled. Email notification sent if patient has an email.'
    });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/doctor/bootstrap', reqLogin, reqDoctor, async (req, res) => {
  const assignedDepartmentId = Number(req.session.department_id);
  if (!assignedDepartmentId) {
    return res.status(403).json({ error: 'Doctor account has no assigned department' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [doctor] = await conn.execute(
      `SELECT user_id, username, full_name, department_id
       FROM users
       WHERE user_id = ?`,
      [req.session.uid]
    );

    const [assignedDepartment] = await conn.execute(
      `SELECT department_id, name, code, queue_status
       FROM departments
       WHERE department_id = ?`,
      [assignedDepartmentId]
    );

    const transferDestinations = await getDoctorTransferDestinations(conn);

    return res.json({
      success: true,
      doctor,
      assigned_department: assignedDepartment,
      departments: transferDestinations.departments,
      subdepartments: transferDestinations.subdepartments
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/doctor/queue', reqLogin, reqDoctor, async (req, res) => {
  const departmentId = Number(req.session.department_id);
  if (!departmentId) {
    return res.status(403).json({ error: 'Doctor account has no assigned department' });
  }

  let conn;

  try {
    await ensurePreferredDoctorSchema();
    conn = await pool.getConnection();

    const queues = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.status,
              q.category,
              q.visit_description,
              q.is_priority,
              q.is_emergency,
              q.created_at,
              q.called_at,
              q.finished_at,
              q.counter_id,
              c.name AS counter_name,
              q.subdepartment_id,
              sd.name AS subdepartment_name,
              sd.room_number AS subdepartment_room_number,
              q.preferred_doctor_user_id,
              COALESCE(pd.full_name, pd.username) AS preferred_doctor_name
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       LEFT JOIN counters c ON c.counter_id = q.counter_id
       LEFT JOIN subdepartments sd ON sd.subdepartment_id = q.subdepartment_id
       LEFT JOIN users pd ON pd.user_id = q.preferred_doctor_user_id
       WHERE q.department_id = ?
         AND q.status IN ('waiting', 'serving')
       ORDER BY
         (q.status = 'serving') DESC,
         q.is_emergency DESC,
         q.is_priority DESC,
         q.created_at ASC,
         q.queue_id ASC`,
      [departmentId]
    );

    return res.json({ success: true, queues });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/doctor/transfer-suggest', reqLogin, reqDoctor, async (req, res) => {
  const departmentId = Number(req.session.department_id);
  const queueId = Number(req.body.queue_id);
  const checklist = req.body.checklist && typeof req.body.checklist === 'object'
    ? req.body.checklist
    : {};
  const doctorNote = String(req.body.doctor_note || '').trim().slice(0, 1000);

  if (!departmentId) {
    return res.status(403).json({ success: false, message: 'Doctor account has no assigned department' });
  }

  if (!queueId) {
    return res.status(400).json({ success: false, message: 'queue_id is required' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [queue] = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.department_id,
              q.status,
              q.visit_description
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE q.queue_id = ?
         AND q.department_id = ?
         AND q.status IN ('serving', 'done')
       LIMIT 1`,
      [queueId, departmentId]
    );

    if (!queue) {
      return res.status(404).json({ success: false, message: 'Queue entry not found for this doctor.' });
    }

    const { departments, subdepartments } = await getDoctorTransferDestinations(conn);
    const suggestedDepartments = departments.filter(dept => Number(dept.department_id) !== departmentId);
    const suggestedDepartmentIds = new Set(suggestedDepartments.map(dept => Number(dept.department_id)));
    const suggestedSubdepartments = subdepartments.filter(sd => suggestedDepartmentIds.has(Number(sd.department_id)));

    const suggestion = await suggestDoctorTransfer({
      patientNote: queue.visit_description,
      checklist,
      doctorNote,
      departments: suggestedDepartments,
      subdepartments: suggestedSubdepartments
    });

    await logQueueAction(conn, {
      queue_id: queue.queue_id,
      actor_user_id: req.session.uid,
      department_id: departmentId,
      action: 'doctor_transfer_ai_suggested',
      details: {
        target_department_id: suggestion ? suggestion.target_department_id : null,
        subdepartment_ids: suggestion ? suggestion.subdepartment_ids : [],
        has_doctor_note: Boolean(doctorNote)
      }
    });

    return res.json({
      success: true,
      suggestion,
      message: suggestion && suggestion.target_department_id
        ? 'AI suggestion applied. Review before transferring.'
        : 'AI could not determine a transfer destination. You can still transfer manually.'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/doctor/next', reqLogin, reqDoctor, async (req, res) => {
  const departmentId = Number(req.session.department_id);
  if (!departmentId) {
    return res.status(403).json({ success: false, message: 'Doctor account has no assigned department' });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [subdepartmentConfig] = await conn.execute(
      `SELECT COUNT(*) AS count
       FROM subdepartments
       WHERE department_id = ?
         AND deleted_at IS NULL`,
      [departmentId]
    );

    if (Number(subdepartmentConfig.count || 0) > 0) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Use subdepartment queues for this department',
        error: 'Use subdepartment queues for this department'
      });
    }

    const [current] = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.category,
              q.visit_description,
              q.status,
              q.counter_id,
              c.name AS counter_name,
              q.subdepartment_id,
              sd.name AS subdepartment_name,
              sd.room_number AS subdepartment_room_number
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       LEFT JOIN counters c ON c.counter_id = q.counter_id
       LEFT JOIN subdepartments sd ON sd.subdepartment_id = q.subdepartment_id
       WHERE q.department_id = ?
         AND q.status = 'serving'
         AND q.subdepartment_id IS NULL
       ORDER BY q.called_at ASC, q.queue_id ASC
       LIMIT 1
       FOR UPDATE`,
      [departmentId]
    );

    if (current) {
      await conn.commit();
      return res.json({ success: true, next: current, message: 'A patient is already serving.' });
    }

    const [next] = await conn.execute(
      `SELECT q.queue_id,
              q.visit_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.category,
              q.visit_description,
              q.department_id,
              q.counter_id,
              q.subdepartment_id,
              d.name AS department_name,
              u.email,
              COALESCE(q.full_name, u.full_name, u.username, 'Patient') AS patient_name,
              c.name AS counter_name,
              sd.name AS subdepartment_name,
              sd.room_number AS subdepartment_room_number
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       LEFT JOIN users u ON u.user_id = q.user_id
       LEFT JOIN counters c ON c.counter_id = q.counter_id
       LEFT JOIN subdepartments sd ON sd.subdepartment_id = q.subdepartment_id
       WHERE q.department_id = ?
         AND q.status = 'waiting'
         AND q.subdepartment_id IS NULL
       ORDER BY q.is_emergency DESC,
                q.is_priority DESC,
                q.created_at ASC,
                q.queue_id ASC
       LIMIT 1
       FOR UPDATE`,
      [departmentId]
    );

    if (!next) {
      await conn.commit();
      return res.json({ success: true, next: null, message: 'No waiting patients.' });
    }

    const activatedTransfer = await activateTransferOnDepartmentCall(conn, next.queue_id, req.session.uid);
    let responseNext = next;
    let notificationCounterName = next.counter_name || next.subdepartment_name || null;
    let responseMessage = null;

    if (activatedTransfer) {
      const assignedDestination = activatedTransfer.assigned_queue
        ? activatedTransfer.assigned_queue.subdepartment_destination
          || formatSubdepartmentDestination(
            activatedTransfer.assigned_queue.subdepartment_name,
            activatedTransfer.assigned_queue.subdepartment_room_number
          )
        : null;
      responseNext = {
        ...next,
        status: 'done',
        counter_id: null,
        counter_name: null,
        assigned_subdepartment_id: activatedTransfer.assigned_queue ? activatedTransfer.assigned_queue.subdepartment_id : null,
        assigned_subdepartment_name: activatedTransfer.assigned_queue ? activatedTransfer.assigned_queue.subdepartment_name : null,
        assigned_subdepartment_room_number: activatedTransfer.assigned_queue ? activatedTransfer.assigned_queue.subdepartment_room_number : null,
        assigned_subdepartment_destination: assignedDestination
      };
      notificationCounterName = assignedDestination;
      responseMessage = activatedTransfer.assigned_queue
        ? `Dispatched ${next.code} to ${assignedDestination}.`
        : `Dispatched ${next.code}. No open subdepartments were available.`;
      await updateVisitStatus(conn, next.visit_id);
    } else {
      await conn.execute(
        `UPDATE queues
         SET status = 'serving',
             called_at = NOW()
         WHERE queue_id = ?`,
        [next.queue_id]
      );

      if (next.counter_id) {
        await conn.execute(
          `UPDATE counters
           SET current_queue_id = ?
           WHERE counter_id = ?`,
          [next.queue_id, next.counter_id]
        );
      }

      if (next.subdepartment_id) {
        await conn.execute(
          `UPDATE subdepartments
           SET current_queue_id = ?
           WHERE subdepartment_id = ?`,
          [next.queue_id, next.subdepartment_id]
        );
      }
    }

    await logQueueAction(conn, {
      queue_id: next.queue_id,
      actor_user_id: req.session.uid,
      department_id: departmentId,
      action: 'doctor_called_next',
      details: {
        counter_id: responseNext.counter_id || null,
        subdepartment_id: responseNext.assigned_subdepartment_id || responseNext.subdepartment_id || null,
        transfer_id: activatedTransfer ? activatedTransfer.transfer_id : null
      }
    });

    await conn.commit();

    if (next.email) {
      queueNotificationEmail({
        queueId: next.queue_id,
        actorUserId: req.session.uid,
        departmentId: next.department_id,
        to: next.email,
        patientName: next.patient_name,
        queueCode: next.code,
        departmentName: next.department_name,
        counterName: notificationCounterName,
        type: 'call'
      });
    }

    return res.json({ success: true, next: responseNext, message: responseMessage });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/doctor/done', reqLogin, reqDoctor, async (req, res) => {
  const departmentId = Number(req.session.department_id);
  const queueId = Number(req.body.queue_id);
  if (!departmentId) {
    return res.status(403).json({ success: false, message: 'Doctor account has no assigned department' });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const params = queueId ? [departmentId, queueId] : [departmentId];
    const [queue] = await conn.execute(
      `SELECT q.queue_id, q.visit_id, q.counter_id, q.subdepartment_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE q.department_id = ?
         AND q.status = 'serving'
         AND q.subdepartment_id IS NULL
         ${queueId ? 'AND q.queue_id = ?' : ''}
       ORDER BY q.called_at ASC, q.queue_id ASC
       LIMIT 1
       FOR UPDATE`,
      params
    );

    if (!queue) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'No serving patient found.' });
    }

    await conn.execute(
      `UPDATE queues
       SET status = 'done',
           finished_at = NOW()
       WHERE queue_id = ?`,
      [queue.queue_id]
    );

    if (queue.counter_id) {
      await conn.execute(
        `UPDATE counters
         SET current_queue_id = NULL
         WHERE counter_id = ?
           AND current_queue_id = ?`,
        [queue.counter_id, queue.queue_id]
      );
    }

    if (queue.subdepartment_id) {
      await conn.execute(
        `UPDATE subdepartments
         SET current_queue_id = NULL
         WHERE subdepartment_id = ?
           AND current_queue_id = ?`,
        [queue.subdepartment_id, queue.queue_id]
      );
    }

    const advancedQueue = await finishTransferItemForQueue(conn, queue.queue_id, 'done', req.session.uid);
    await rebalanceSubdepartmentQueues(conn, departmentId, req.session.uid);
    await updateVisitStatus(conn, queue.visit_id);
    await logQueueAction(conn, {
      queue_id: queue.queue_id,
      actor_user_id: req.session.uid,
      department_id: departmentId,
      action: 'doctor_marked_done',
      details: { advanced_queue_id: advancedQueue ? advancedQueue.queue_id : null }
    });

    await conn.commit();

    return res.json({
      success: true,
      completed_queue: { ...queue, status: 'done' },
      advanced_queue: advancedQueue
    });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/doctor/transfer', reqLogin, reqDoctor, async (req, res) => {
  const targetDepartmentId = Number(req.body.target_department_id);

  let conn;

  try {
    conn = await pool.getConnection();
    const { departments } = await getDoctorTransferDestinations(conn);
    const allowed = departments.some(dept => Number(dept.department_id) === targetDepartmentId);

    if (!allowed) {
      return res.status(400).json({
        success: false,
        message: 'Doctors can only transfer patients to open laboratory services.',
        error: 'Doctors can only transfer patients to open laboratory services.'
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }

  const result = await performSubdepartmentTransfer(req, {
    queue_id: req.body.queue_id,
    target_department_id: targetDepartmentId,
    subdepartment_ids: req.body.subdepartment_ids,
    reason: req.body.reason
  });

  return res.status(result.status).json(result.body);
});

app.get('/api/counters/:counter_id/queue', reqLogin, async (req, res) => {
  const counterId = Number(req.params.counter_id);
  let conn;

  try {
    conn = await pool.getConnection();
    const access = await getCounterForAccess(conn, req, counterId);
    if (access.error) {
      return res.status(access.errorStatus).json({ success: false, message: access.error });
    }

    const queues = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.status,
              q.category,
              q.visit_description,
              q.is_priority,
              q.is_emergency,
              q.created_at,
              q.called_at,
              q.finished_at,
              q.counter_id,
              c.name AS counter_name
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       JOIN counters c ON c.counter_id = q.counter_id
       WHERE q.counter_id = ?
         AND q.status IN ('waiting', 'serving')
       ORDER BY
         (q.status = 'serving') DESC,
         q.is_emergency DESC,
         q.is_priority DESC,
         q.created_at ASC,
         q.queue_id ASC`,
      [counterId]
    );

    return res.json({ success: true, counter: access.counter, queues });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/counters/:counter_id/next', reqLogin, async (req, res) => {
  const counterId = Number(req.params.counter_id);
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const access = await getCounterForAccess(conn, req, counterId);
    if (access.error) {
      await conn.rollback();
      return res.status(access.errorStatus).json({ success: false, message: access.error });
    }

    if (access.counter.status !== 'open') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Counter is not open.' });
    }

    const [current] = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.category,
              q.status,
              q.counter_id,
              c.name AS counter_name
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       JOIN counters c ON c.counter_id = q.counter_id
       WHERE q.counter_id = ?
         AND q.status = 'serving'
       LIMIT 1
       FOR UPDATE`,
      [counterId]
    );

    if (current) {
      await conn.commit();
      return res.json({ success: true, next: current, message: 'A patient is already serving.' });
    }

    const [next] = await conn.execute(
      `SELECT q.queue_id,
              q.visit_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.category,
              q.department_id,
              q.counter_id,
              d.name AS department_name,
              c.name AS counter_name,
              u.email,
              COALESCE(q.full_name, u.full_name, u.username, 'Patient') AS patient_name
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       JOIN counters c ON c.counter_id = q.counter_id
       LEFT JOIN users u ON u.user_id = q.user_id
       WHERE q.counter_id = ?
         AND q.status = 'waiting'
       ORDER BY q.is_emergency DESC,
                q.is_priority DESC,
                q.created_at ASC,
                q.queue_id ASC
       LIMIT 1
       FOR UPDATE`,
      [counterId]
    );

    if (!next) {
      await conn.commit();
      return res.json({ success: true, next: null, message: 'No waiting patients.' });
    }

    await conn.execute(
      `UPDATE queues
       SET status = 'serving',
           called_at = NOW()
       WHERE queue_id = ?`,
      [next.queue_id]
    );
    await conn.execute(
      `UPDATE counters
       SET current_queue_id = ?
       WHERE counter_id = ?`,
      [next.queue_id, counterId]
    );
    await logQueueAction(conn, {
      queue_id: next.queue_id,
      actor_user_id: req.session.uid,
      department_id: next.department_id,
      action: 'counter_called_next',
      details: { counter_id: counterId }
    });

    await conn.commit();

    if (next.email) {
      queueNotificationEmail({
        queueId: next.queue_id,
        actorUserId: req.session.uid,
        departmentId: next.department_id,
        to: next.email,
        patientName: next.patient_name,
        queueCode: next.code,
        departmentName: next.department_name,
        counterName: next.counter_name,
        type: 'call'
      });
    }

    return res.json({ success: true, next });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/counters/:counter_id/done', reqLogin, async (req, res) => {
  const counterId = Number(req.params.counter_id);
  const queueId = Number(req.body.queue_id);
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const access = await getCounterForAccess(conn, req, counterId);
    if (access.error) {
      await conn.rollback();
      return res.status(access.errorStatus).json({ success: false, message: access.error });
    }

    const params = queueId ? [counterId, queueId] : [counterId];
    const [queue] = await conn.execute(
      `SELECT q.queue_id, q.visit_id, q.department_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE q.counter_id = ?
         AND q.status = 'serving'
         ${queueId ? 'AND q.queue_id = ?' : ''}
       LIMIT 1
       FOR UPDATE`,
      params
    );

    if (!queue) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'No serving patient found.' });
    }

    await conn.execute(
      `UPDATE queues
       SET status = 'done',
           finished_at = NOW()
       WHERE queue_id = ?`,
      [queue.queue_id]
    );
    await conn.execute(
      `UPDATE counters
       SET current_queue_id = NULL
       WHERE counter_id = ?
         AND current_queue_id = ?`,
      [counterId, queue.queue_id]
    );

    const advancedQueue = await finishTransferItemForQueue(conn, queue.queue_id, 'done', req.session.uid);
    await rebalanceSubdepartmentQueues(conn, queue.department_id, req.session.uid);
    await updateVisitStatus(conn, queue.visit_id);
    await logQueueAction(conn, {
      queue_id: queue.queue_id,
      actor_user_id: req.session.uid,
      department_id: queue.department_id,
      action: 'counter_marked_done',
      details: { counter_id: counterId, advanced_queue_id: advancedQueue ? advancedQueue.queue_id : null }
    });

    await conn.commit();
    return res.json({ success: true, completed_queue: { ...queue, status: 'done' }, advanced_queue: advancedQueue });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/counters/:counter_id/skip/:queue_id', reqLogin, async (req, res) => {
  const counterId = Number(req.params.counter_id);
  const queueId = Number(req.params.queue_id);
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const access = await getCounterForAccess(conn, req, counterId);
    if (access.error) {
      await conn.rollback();
      return res.status(access.errorStatus).json({ success: false, message: access.error });
    }

    const [queue] = await conn.execute(
      `SELECT q.queue_id, q.visit_id, q.department_id, q.status,
              ${queueCodeSql('d', 'v')} AS code
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE q.queue_id = ?
         AND q.counter_id = ?
         AND q.status IN ('waiting', 'serving')
       FOR UPDATE`,
      [queueId, counterId]
    );

    if (!queue) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Queue entry not found for this counter.' });
    }

    await conn.execute(
      `UPDATE queues
       SET status = 'no_show',
           finished_at = NOW()
       WHERE queue_id = ?`,
      [queue.queue_id]
    );
    await conn.execute(
      `UPDATE counters
       SET current_queue_id = NULL
       WHERE counter_id = ?
         AND current_queue_id = ?`,
      [counterId, queue.queue_id]
    );

    const advancedQueue = await finishTransferItemForQueue(conn, queue.queue_id, 'skipped', req.session.uid);
    await rebalanceSubdepartmentQueues(conn, queue.department_id, req.session.uid);
    await updateVisitStatus(conn, queue.visit_id);
    await logQueueAction(conn, {
      queue_id: queue.queue_id,
      actor_user_id: req.session.uid,
      department_id: queue.department_id,
      action: 'counter_skipped',
      details: { counter_id: counterId, advanced_queue_id: advancedQueue ? advancedQueue.queue_id : null }
    });

    await conn.commit();
    return res.json({ success: true, skipped_queue: { ...queue, status: 'no_show' }, advanced_queue: advancedQueue });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/subdepartments/:subdepartment_id/queue', reqLogin, async (req, res) => {
  const subdepartmentId = Number(req.params.subdepartment_id);
  let conn;

  try {
    conn = await pool.getConnection();
    const access = await getSubdepartmentForAccess(conn, req, subdepartmentId);
    if (access.error) {
      return res.status(access.errorStatus).json({ success: false, message: access.error });
    }

    const queues = await conn.execute(
      `SELECT q.queue_id,
              r.requirement_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              r.status,
              q.category,
              q.visit_description,
              q.is_priority,
              q.is_emergency,
              COALESCE(r.queued_at, q.created_at) AS created_at,
              r.called_at,
              r.finished_at,
              r.subdepartment_id,
              sd.name AS subdepartment_name,
              sd.room_number AS subdepartment_room_number
       FROM queue_subdepartment_requirements r
       JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
       JOIN queues q ON q.queue_id = qt.queue_id
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       JOIN subdepartments sd ON sd.subdepartment_id = r.subdepartment_id
       WHERE r.subdepartment_id = ?
         AND r.status IN ('queued', 'serving')
       ORDER BY
         (r.status = 'serving') DESC,
         q.is_emergency DESC,
         q.is_priority DESC,
         COALESCE(r.queued_at, q.created_at) ASC,
         q.queue_id ASC`,
      [subdepartmentId]
    );

    return res.json({ success: true, subdepartment: access.subdepartment, queues });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/subdepartments/:subdepartment_id/next', reqLogin, async (req, res) => {
  const subdepartmentId = Number(req.params.subdepartment_id);
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const access = await getSubdepartmentForAccess(conn, req, subdepartmentId);
    if (access.error) {
      await conn.rollback();
      return res.status(access.errorStatus).json({ success: false, message: access.error });
    }

    if (access.subdepartment.status !== 'open') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Subdepartment is not open.' });
    }

    const [current] = await conn.execute(
      `SELECT q.queue_id,
              q.visit_id,
              q.department_id,
              r.requirement_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name
       FROM queue_subdepartment_requirements r
       JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
       JOIN queues q ON q.queue_id = qt.queue_id
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE r.subdepartment_id = ?
         AND r.status = 'serving'
       LIMIT 1
       FOR UPDATE`,
      [subdepartmentId]
    );

    let completedQueue = null;
    let advancedQueue = null;

    if (current) {
      await conn.execute(
        `UPDATE subdepartments
         SET current_queue_id = NULL
         WHERE subdepartment_id = ?
           AND current_queue_id = ?`,
        [subdepartmentId, current.queue_id]
      );

      advancedQueue = await finishTransferItemForQueue(conn, current.queue_id, 'done', req.session.uid, subdepartmentId);
      await updateVisitStatus(conn, current.visit_id);
      await logQueueAction(conn, {
        queue_id: current.queue_id,
        actor_user_id: req.session.uid,
        department_id: current.department_id,
        action: 'subdepartment_marked_done_by_next',
        details: { subdepartment_id: subdepartmentId, advanced_queue_id: advancedQueue ? advancedQueue.queue_id : null }
      });
      completedQueue = { ...current, status: 'done' };
    }

    await rebalanceSubdepartmentQueues(conn, access.subdepartment.department_id, req.session.uid);

    const [next] = await conn.execute(
      `SELECT q.queue_id,
              r.requirement_id,
              q.visit_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.category,
              q.department_id,
              r.subdepartment_id,
              d.name AS department_name,
              sd.name AS subdepartment_name,
              sd.room_number AS subdepartment_room_number,
              u.email,
              COALESCE(q.full_name, u.full_name, u.username, 'Patient') AS patient_name
       FROM queue_subdepartment_requirements r
       JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
       JOIN queues q ON q.queue_id = qt.queue_id
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       JOIN subdepartments sd ON sd.subdepartment_id = r.subdepartment_id
       LEFT JOIN users u ON u.user_id = q.user_id
       WHERE r.subdepartment_id = ?
         AND r.status = 'queued'
       ORDER BY q.is_emergency DESC,
                q.is_priority DESC,
                COALESCE(r.queued_at, q.created_at) ASC,
                q.queue_id ASC
       LIMIT 1
       FOR UPDATE`,
      [subdepartmentId]
    );

    if (!next) {
      await conn.commit();
      return res.json({
        success: true,
        next: null,
        completed_queue: completedQueue,
        advanced_queue: advancedQueue,
        message: completedQueue
          ? (advancedQueue
              ? `${completedQueue.code} completed. Queued next requirement in ${advancedQueue.subdepartment_name}.`
              : `${completedQueue.code} completed. No waiting patients.`)
          : 'No waiting patients.'
      });
    }

    await conn.execute(
      `UPDATE subdepartments
       SET current_queue_id = ?
       WHERE subdepartment_id = ?`,
      [next.queue_id, subdepartmentId]
    );
    await conn.execute(
      `UPDATE queue_subdepartment_requirements
       SET status = 'serving',
           called_at = NOW()
       WHERE requirement_id = ?`,
      [next.requirement_id]
    );

    await logQueueAction(conn, {
      queue_id: next.queue_id,
      actor_user_id: req.session.uid,
      department_id: next.department_id,
      action: 'subdepartment_called_next',
      details: { subdepartment_id: subdepartmentId }
    });

    await conn.commit();

    if (next.email) {
      queueNotificationEmail({
        queueId: next.queue_id,
        actorUserId: req.session.uid,
        departmentId: next.department_id,
        to: next.email,
        patientName: next.patient_name,
        queueCode: next.code,
        departmentName: next.department_name,
        counterName: formatSubdepartmentDestination(next.subdepartment_name, next.subdepartment_room_number),
        type: 'call'
      });
    }

    return res.json({
      success: true,
      next: { ...next, status: 'serving' },
      completed_queue: completedQueue,
      advanced_queue: advancedQueue,
      message: completedQueue
        ? `${completedQueue.code} completed. Now serving ${next.code}.`
        : `Now serving ${next.code}.`
    });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/subdepartments/:subdepartment_id/done', reqLogin, async (req, res) => {
  const subdepartmentId = Number(req.params.subdepartment_id);
  const queueId = Number(req.body.queue_id);
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const access = await getSubdepartmentForAccess(conn, req, subdepartmentId);
    if (access.error) {
      await conn.rollback();
      return res.status(access.errorStatus).json({ success: false, message: access.error });
    }

    const params = queueId ? [subdepartmentId, queueId] : [subdepartmentId];
    const [queue] = await conn.execute(
      `SELECT q.queue_id, q.visit_id, q.department_id,
              r.requirement_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name
       FROM queue_subdepartment_requirements r
       JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
       JOIN queues q ON q.queue_id = qt.queue_id
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE r.subdepartment_id = ?
         AND r.status = 'serving'
         ${queueId ? 'AND q.queue_id = ?' : ''}
       LIMIT 1
       FOR UPDATE`,
      params
    );

    if (!queue) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'No serving patient found.' });
    }

    await conn.execute(
      `UPDATE subdepartments
       SET current_queue_id = NULL
       WHERE subdepartment_id = ?
         AND current_queue_id = ?`,
      [subdepartmentId, queue.queue_id]
    );

    const advancedQueue = await finishTransferItemForQueue(conn, queue.queue_id, 'done', req.session.uid, subdepartmentId);
    await rebalanceSubdepartmentQueues(conn, access.subdepartment.department_id, req.session.uid);
    await updateVisitStatus(conn, queue.visit_id);
    await logQueueAction(conn, {
      queue_id: queue.queue_id,
      actor_user_id: req.session.uid,
      department_id: queue.department_id,
      action: 'subdepartment_marked_done',
      details: { subdepartment_id: subdepartmentId, advanced_queue_id: advancedQueue ? advancedQueue.queue_id : null }
    });

    await conn.commit();
    return res.json({ success: true, completed_queue: { ...queue, status: 'done' }, advanced_queue: advancedQueue });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/subdepartments/:subdepartment_id/skip/:queue_id', reqLogin, async (req, res) => {
  const subdepartmentId = Number(req.params.subdepartment_id);
  const queueId = Number(req.params.queue_id);
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const access = await getSubdepartmentForAccess(conn, req, subdepartmentId);
    if (access.error) {
      await conn.rollback();
      return res.status(access.errorStatus).json({ success: false, message: access.error });
    }

    const [queue] = await conn.execute(
      `SELECT q.queue_id, q.visit_id, q.department_id, r.status,
              r.requirement_id,
              ${queueCodeSql('d', 'v')} AS code
       FROM queue_subdepartment_requirements r
       JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
       JOIN queues q ON q.queue_id = qt.queue_id
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE q.queue_id = ?
         AND r.subdepartment_id = ?
         AND r.status IN ('queued', 'serving')
       FOR UPDATE`,
      [queueId, subdepartmentId]
    );

    if (!queue) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Queue entry not found for this subdepartment.' });
    }

    await conn.execute(
      `UPDATE subdepartments
       SET current_queue_id = NULL
       WHERE subdepartment_id = ?
         AND current_queue_id = ?`,
      [subdepartmentId, queue.queue_id]
    );

    const advancedQueue = await finishTransferItemForQueue(conn, queue.queue_id, 'skipped', req.session.uid, subdepartmentId);
    await rebalanceSubdepartmentQueues(conn, access.subdepartment.department_id, req.session.uid);
    await updateVisitStatus(conn, queue.visit_id);
    await logQueueAction(conn, {
      queue_id: queue.queue_id,
      actor_user_id: req.session.uid,
      department_id: queue.department_id,
      action: 'subdepartment_skipped',
      details: { subdepartment_id: subdepartmentId, advanced_queue_id: advancedQueue ? advancedQueue.queue_id : null }
    });

    await conn.commit();
    return res.json({ success: true, skipped_queue: { ...queue, status: 'no_show' }, advanced_queue: advancedQueue });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/admin/transfer', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const result = await performSubdepartmentTransfer(req, {
    queue_id: req.body.queue_id,
    target_department_id: req.body.target_department_id,
    subdepartment_ids: req.body.subdepartment_ids,
    reason: req.body.reason
  });

  return res.status(result.status).json(result.body);
});

app.patch('/api/admin/queues/:queue_id/transfer', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queue_id } = req.params;
  const { to_department_id, notes, subdepartment_ids } = req.body;

  const result = await performSubdepartmentTransfer(req, {
    queue_id,
    target_department_id: to_department_id,
    subdepartment_ids,
    reason: notes
  });

  return res.status(result.status).json(result.body);
});

app.get('/api/admin/queues/:queue_id/history', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queue_id } = req.params;
  let conn;

  try {
    conn = await pool.getConnection();

    const [queue] = await conn.execute(
      `SELECT queue_id, department_id
       FROM queues
       WHERE queue_id = ?`,
      [queue_id]
    );

    if (!queue) {
      return res.status(404).json({ error: 'Queue entry not found' });
    }

    if (!canAccessDepartment(req, queue.department_id)) {
      return res.status(403).json({ error: 'You cannot view this queue history' });
    }

    const logs = await conn.execute(
      `SELECT
          l.log_id,
          l.queue_id,
          l.action,
          l.details,
          l.details AS notes,
          l.created_at,
          u.full_name AS actor_name,
          d.name AS department_name,
          NULL AS counter_name,
          NULL AS from_department_name,
          NULL AS to_department_name
       FROM queue_logs l
       LEFT JOIN users u ON u.user_id = l.actor_user_id
       LEFT JOIN departments d ON d.department_id = l.department_id
       WHERE l.queue_id = ?
       ORDER BY l.created_at ASC, l.log_id ASC`,
      [queue_id]
    );

    return res.json({
      success: true,
      queue_id: Number(queue_id),
      logs
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/admin/status', reqLogin, async (req, res) => {
  console.log('admin counter reached');
  const uid = req.session.uid;

  let conn;

  try {
    conn = await pool.getConnection();
    const [rows] = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.category,
              q.status,
              q.department_id
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE q.user_id = ? AND q.status IN ('waiting', 'serving')
       ORDER BY q.created_at DESC LIMIT 1`,
      [uid]
    );

    if (rows) {
      return res.json({
        queued: true,
        queue_id: rows.queue_id,
        code: rows.code,
        full_name: rows.full_name,
        category: rows.category,
        department_id: rows.department_id
      });
    } else {
      return res.json({ queued: false, department_id: null });
    }

  } catch (err) {
    return res.json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/admin/history', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id, status, date_from, date_to, search } = req.query;
  const historyStatuses = ['done', 'no_show', 'void', 'cancelled'];
  const allowedStatuses = ['waiting', 'serving', ...historyStatuses];
  const filters = [];
  const params = [];

  if (req.session.role === 'staff') {
    if (!req.session.department_id) {
      return res.status(403).json({ error: 'Staff account has no assigned department' });
    }

    filters.push('q.department_id = ?');
    params.push(req.session.department_id);
  } else if (department_id) {
    if (!canAccessDepartment(req, department_id)) {
      return res.status(403).json({ error: 'You cannot access this department' });
    }

    filters.push('q.department_id = ?');
    params.push(department_id);
  }

  if (status) {
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid queue status filter' });
    }

    filters.push('q.status = ?');
    params.push(status);
  } else {
    filters.push(`q.status IN (${historyStatuses.map(() => '?').join(', ')})`);
    params.push(...historyStatuses);
  }

  if (date_from) {
    filters.push('q.created_at >= ?');
    params.push(`${date_from} 00:00:00`);
  }

  if (date_to) {
    filters.push('q.created_at <= ?');
    params.push(`${date_to} 23:59:59`);
  }

  if (search) {
    const like = `%${search}%`;
    filters.push(`(
      ${queueCodeSql('d', 'v')} LIKE ?
      OR q.full_name LIKE ?
      OR q.category LIKE ?
      OR q.visit_description LIKE ?
    )`);
    params.push(like, like, like, like);
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT
          q.queue_id,
          ${queueCodeSql('d', 'v')} AS code,
          q.full_name,
          d.name AS department_name,
          q.department_id,
          q.category,
          q.status,
          q.referred_from_queue_id,
          q.transfer_reason,
          q.transferred_by_user_id,
          q.transferred_at,
          tq.queue_id AS transferred_queue_id,
          ${queueCodeSql('td', 'tv', 'tq')} AS transferred_queue_code,
          q.created_at,
          q.called_at,
          q.finished_at
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       LEFT JOIN queues tq ON tq.referred_from_queue_id = q.queue_id
       LEFT JOIN departments td ON td.department_id = tq.department_id
       LEFT JOIN visits tv ON tv.visit_id = tq.visit_id
       WHERE ${filters.join(' AND ')}
       ORDER BY COALESCE(q.finished_at, q.called_at, q.created_at) DESC,
                q.queue_id DESC
       LIMIT 300`,
      params
    );

    return res.json({
      success: true,
      history: rows
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/admin/history/ai-search', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const prompt = String(req.body && req.body.prompt ? req.body.prompt : '').trim();

  if (!prompt) {
    return res.status(400).json({
      success: false,
      message: 'Prompt is required',
      error: 'Prompt is required'
    });
  }

  if (prompt.length > 500) {
    return res.status(400).json({
      success: false,
      message: 'Prompt is too long',
      error: 'Prompt is too long'
    });
  }

  if (req.session.role === 'staff' && !req.session.department_id) {
    return res.status(403).json({
      success: false,
      message: 'Staff account has no assigned department',
      error: 'Staff account has no assigned department'
    });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const includeQueueLogs = await hasQueueLogsTable(conn);
    let mode = 'ai';
    let message = null;
    let filters;

    try {
      filters = await promptToQueueSearchFilters(prompt);
    } catch (err) {
      console.error('Groq AI history search failed:', err.message);
      console.info('Using fallback mode for queue history search');
      mode = 'fallback';
      message = 'AI search was unavailable, so normal search was used.';
      filters = await buildFallbackSearchFilters(conn, prompt);
    }

    filters = normalizeAiSearchFilters(filters);

    const query = buildHistorySearchQuery({
      filters,
      session: req.session,
      includeQueueLogs,
      limit: 100
    });

    const results = await conn.execute(query.sql, query.params);
    let logs = [];

    if (includeQueueLogs && results.length) {
      const queueIds = results.map(record => record.queue_id);
      const logWhere = [`l.queue_id IN (${queueIds.map(() => '?').join(', ')})`];
      const logParams = [...queueIds];

      if (filters.keywords.length) {
        const clauses = [];

        for (const keyword of filters.keywords) {
          const like = `%${keyword}%`;
          clauses.push('(l.action LIKE ? OR l.details LIKE ?)');
          logParams.push(like, like);
        }

        logWhere.push(`(${clauses.join(' OR ')})`);
      }

      logs = await conn.execute(
        `SELECT
            l.log_id,
            l.queue_id,
            l.actor_user_id,
            l.department_id,
            l.action,
            l.details,
            l.created_at,
            u.full_name AS actor_name,
            d.name AS department_name
         FROM queue_logs l
         LEFT JOIN users u ON u.user_id = l.actor_user_id
         LEFT JOIN departments d ON d.department_id = l.department_id
         WHERE ${logWhere.join(' AND ')}
         ORDER BY l.created_at DESC, l.log_id DESC
         LIMIT 200`,
        logParams
      );
    }

    return res.json({
      success: true,
      mode,
      message,
      filters,
      results,
      history: results,
      logs
    });
  } catch (err) {
    console.error('Queue history search failed:', err);
    return res.status(500).json({
      success: false,
      message: 'Search failed. Please try a simpler search.',
      error: 'Search failed. Please try a simpler search.'
    });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/admin/:department_id', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id } = req.params;

  if (!canAccessDepartment(req, department_id)) {
    return res.status(403).json({ error: 'You cannot access this department' });
  }

  let conn;

  try {
    await ensurePreferredDoctorSchema();
    conn = await pool.getConnection();

    const [subdepartmentCount] = await conn.execute(
      `SELECT COUNT(*) AS count
       FROM subdepartments
       WHERE department_id = ?
         AND deleted_at IS NULL`,
      [department_id]
    );

    if (Number(subdepartmentCount && subdepartmentCount.count || 0) > 0) {
      return res.json([]);
    }

    const rows = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.department_id,
              q.full_name,
              q.category,
              q.preferred_doctor_user_id,
              COALESCE(pd.full_name, pd.username) AS preferred_doctor_name
            FROM queues q
            JOIN departments d ON d.department_id = q.department_id
            JOIN visits v ON v.visit_id = q.visit_id
            LEFT JOIN users pd ON pd.user_id = q.preferred_doctor_user_id
            WHERE q.department_id = ?
            AND q.status = 'waiting'
            ORDER BY q.is_emergency DESC,
                      q.is_priority DESC,
                      q.created_at ASC,
                      q.queue_id ASC`,
      [department_id]
    );

    res.json(rows);
    console.log(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });

  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/admin/dashboard/stats/:department_id', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id } = req.params;

  if (!canAccessDepartment(req, department_id)) {
    return res.status(403).json({ error: 'You cannot access this department' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

    const [subdepartmentCount] = await conn.execute(
      `SELECT COUNT(*) AS count
       FROM subdepartments
       WHERE department_id = ?
         AND deleted_at IS NULL`,
      [department_id]
    );

    if (Number(subdepartmentCount && subdepartmentCount.count || 0) > 0) {
      const [activeRequirements] = await conn.execute(
        `SELECT COUNT(*) AS count
         FROM queue_subdepartment_requirements r
         JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
         WHERE qt.to_department_id = ?
           AND r.status IN ('queued', 'serving')`,
        [department_id]
      );

      const [queuedRequirements] = await conn.execute(
        `SELECT COUNT(*) AS count
         FROM queue_subdepartment_requirements r
         JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
         WHERE qt.to_department_id = ?
           AND r.status = 'queued'`,
        [department_id]
      );

      const [doneRequirements] = await conn.execute(
        `SELECT COUNT(*) AS count
         FROM queue_subdepartment_requirements r
         JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
         WHERE qt.to_department_id = ?
           AND r.status = 'done'
           AND DATE(r.finished_at) = CURDATE()`,
        [department_id]
      );

      return res.json({
        success: true,
        stats: {
          in_queue: Number(activeRequirements.count || 0),
          waiting: Number(queuedRequirements.count || 0),
          served_today: Number(doneRequirements.count || 0),
          avg_wait_min: null
        }
      });
    }

    const [inQueue] = await conn.execute(
      `SELECT COUNT(*) AS count
       FROM queues
       WHERE department_id = ? AND status IN ('waiting', 'serving')`,
      [department_id]
    );

    const [waiting] = await conn.execute(
      `SELECT COUNT(*) AS count
       FROM queues
       WHERE department_id = ? AND status = 'waiting'`,
      [department_id]
    );

    const [servedToday] = await conn.execute(
      `SELECT COUNT(*) AS count
       FROM queues
       WHERE department_id = ? AND status = 'done' AND DATE(finished_at) = CURDATE()`,
      [department_id]
    );

    const [avgWait] = await conn.execute(
      `SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, called_at)) AS avg_wait_min
       FROM queues
       WHERE department_id = ?
         AND called_at IS NOT NULL
         AND DATE(created_at) = CURDATE()`,
      [department_id]
    );

    return res.json({
      success: true,
      stats: {
        in_queue: Number(inQueue.count || 0),
        waiting: Number(waiting.count || 0),
        served_today: Number(servedToday.count || 0),
        avg_wait_min: avgWait.avg_wait_min !== null ? Number(avgWait.avg_wait_min) : null
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/display/now-serving', async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();

    const departments = await conn.execute(
      `SELECT d.department_id, d.name, d.queue_status
       FROM departments d
       ORDER BY d.name ASC, d.department_id ASC`
    );

    const subdepartments = await conn.execute(
      `SELECT sd.subdepartment_id, sd.department_id, sd.name, sd.status, sd.room_number
       FROM subdepartments sd
       WHERE sd.deleted_at IS NULL
       ORDER BY sd.department_id ASC, sd.name ASC, sd.subdepartment_id ASC`
    );

    const queueRows = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.status,
              q.created_at,
              q.called_at,
              q.is_priority,
              q.is_emergency,
              q.department_id,
              d.name AS department_name,
              d.queue_status AS department_status,
              COALESCE(q.subdepartment_id, current_sd.subdepartment_id) AS subdepartment_id,
              COALESCE(assigned_c.name, current_c.name) AS counter_name,
              (
                SELECT MAX(l.log_id)
                FROM queue_logs l
                WHERE l.queue_id = q.queue_id
                  AND l.action IN ('called_next', 'counter_called_next', 'doctor_called_next', 'subdepartment_called_next', 'recalled')
              ) AS announcement_event_id
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       LEFT JOIN counters assigned_c ON assigned_c.counter_id = q.counter_id
       LEFT JOIN counters current_c ON current_c.current_queue_id = q.queue_id
       LEFT JOIN subdepartments current_sd ON current_sd.current_queue_id = q.queue_id
       WHERE q.status IN ('serving', 'waiting')
         AND NOT EXISTS (
           SELECT 1
           FROM queue_transfers active_qt
           JOIN queue_subdepartment_requirements active_r
             ON active_r.transfer_id = active_qt.transfer_id
           WHERE active_qt.queue_id = q.queue_id
             AND active_qt.status = 'in_subdepartment'
             AND active_r.status IN ('queued', 'serving')
         )
       UNION ALL
       SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              CASE WHEN r.status = 'serving' THEN 'serving' ELSE 'waiting' END AS status,
              COALESCE(r.queued_at, q.created_at) AS created_at,
              CASE WHEN r.status = 'serving' THEN COALESCE(r.called_at, q.called_at) ELSE NULL END AS called_at,
              q.is_priority,
              q.is_emergency,
              q.department_id,
              d.name AS department_name,
              d.queue_status AS department_status,
              r.subdepartment_id,
              NULL AS counter_name,
              (
                SELECT MAX(l.log_id)
                FROM queue_logs l
                WHERE l.queue_id = q.queue_id
                  AND l.action IN ('called_next', 'counter_called_next', 'doctor_called_next', 'subdepartment_called_next', 'recalled')
              ) AS announcement_event_id
       FROM queue_subdepartment_requirements r
       JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
       JOIN queues q ON q.queue_id = qt.queue_id
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       WHERE qt.status = 'in_subdepartment'
         AND r.status IN ('queued', 'serving')`
    );

    const departmentsById = new Map(departments.map(department => [
      Number(department.department_id),
      department
    ]));
    const subdepartmentsById = new Map(subdepartments.map(subdepartment => [
      Number(subdepartment.subdepartment_id),
      subdepartment
    ]));
    const openSubdepartmentsByDepartment = new Map();

    for (const subdepartment of subdepartments) {
      if (subdepartment.status === 'closed') continue;
      const departmentId = Number(subdepartment.department_id);
      if (!openSubdepartmentsByDepartment.has(departmentId)) {
        openSubdepartmentsByDepartment.set(departmentId, []);
      }
      openSubdepartmentsByDepartment.get(departmentId).push(subdepartment);
    }

    const columnsMap = new Map();

    const ensureColumn = ({ department, subdepartment = null, forceClosed = false }) => {
      const columnId = subdepartment
        ? `subdepartment:${subdepartment.subdepartment_id}`
        : `department:${department.department_id}`;

      if (!columnsMap.has(columnId)) {
        const departmentStatus = department.queue_status || 'open';
        const subdepartmentStatus = subdepartment ? subdepartment.status : '';
        const isClosed = forceClosed || departmentStatus === 'closed' || subdepartmentStatus === 'closed';
        const status = isClosed ? 'closed' : (subdepartmentStatus || departmentStatus || 'open');
        const subdepartmentName = subdepartment ? String(subdepartment.name || '').trim() : '';
        const roomNumber = subdepartment ? String(subdepartment.room_number || '').trim() : '';

        columnsMap.set(columnId, {
          column_id: columnId,
          department_id: department.department_id,
          subdepartment_id: subdepartment ? subdepartment.subdepartment_id : null,
          title: subdepartmentName ? `${department.name} - ${subdepartmentName}` : department.name,
          subtitle: roomNumber ? `Room ${roomNumber}` : '',
          status,
          department_name: department.name,
          serving: [],
          waiting: [],
          latest_called_at: null,
          latest_event_id: null,
          sort_department_name: department.name,
          sort_service_name: subdepartmentName || department.name,
          sort_id: subdepartment ? Number(subdepartment.subdepartment_id) : Number(department.department_id)
        });
      }

      return columnsMap.get(columnId);
    };

    for (const department of departments) {
      const departmentId = Number(department.department_id);
      if (department.queue_status === 'closed') continue;

      const openSubdepartments = openSubdepartmentsByDepartment.get(departmentId) || [];
      if (openSubdepartments.length) {
        openSubdepartments.forEach(subdepartment => ensureColumn({ department, subdepartment }));
      } else {
        ensureColumn({ department });
      }
    }

    const toTime = value => {
      const time = value ? new Date(value).getTime() : 0;
      return Number.isFinite(time) ? time : 0;
    };

    for (const row of queueRows) {
      const department = departmentsById.get(Number(row.department_id));
      if (!department) continue;

      const subdepartment = row.subdepartment_id
        ? subdepartmentsById.get(Number(row.subdepartment_id))
        : null;
      const column = ensureColumn({
        department,
        subdepartment,
        forceClosed: department.queue_status === 'closed' || (subdepartment && subdepartment.status === 'closed')
      });

      if (!column.subtitle && !subdepartment && row.counter_name) {
        column.subtitle = row.counter_name;
      }

      const item = {
        queue_id: row.queue_id,
        code: row.code,
        status: row.status,
        created_at: row.created_at,
        called_at: row.called_at,
        is_priority: Boolean(row.is_priority),
        is_emergency: Boolean(row.is_emergency),
        announcement_event_id: row.announcement_event_id
      };

      if (row.status === 'serving') {
        column.serving.push(item);
        if (toTime(row.called_at) > toTime(column.latest_called_at)) {
          column.latest_called_at = row.called_at;
        }
      } else {
        column.waiting.push(item);
      }

      if (Number(row.announcement_event_id || 0) > Number(column.latest_event_id || 0)) {
        column.latest_event_id = row.announcement_event_id;
      }
    }

    const sortQueues = rows => rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'serving' ? -1 : 1;
      if (a.status === 'serving') {
        const eventDiff = Number(b.announcement_event_id || 0) - Number(a.announcement_event_id || 0);
        if (eventDiff) return eventDiff;
        const calledDiff = toTime(b.called_at) - toTime(a.called_at);
        if (calledDiff) return calledDiff;
      }
      if (Boolean(a.is_emergency) !== Boolean(b.is_emergency)) return a.is_emergency ? -1 : 1;
      if (Boolean(a.is_priority) !== Boolean(b.is_priority)) return a.is_priority ? -1 : 1;
      const createdDiff = toTime(a.created_at) - toTime(b.created_at);
      if (createdDiff) return createdDiff;
      return Number(a.queue_id || 0) - Number(b.queue_id || 0);
    });

    const columns = [...columnsMap.values()].map(column => ({
      ...column,
      serving: sortQueues(column.serving),
      waiting: sortQueues(column.waiting)
    })).sort((a, b) => {
      const aEvent = Number(a.latest_event_id || 0);
      const bEvent = Number(b.latest_event_id || 0);
      if (aEvent || bEvent) {
        if (aEvent !== bEvent) return bEvent - aEvent;
      }

      const aCalled = toTime(a.latest_called_at);
      const bCalled = toTime(b.latest_called_at);
      if (aCalled || bCalled) {
        if (aCalled !== bCalled) return bCalled - aCalled;
      }

      const departmentCompare = String(a.sort_department_name || '').localeCompare(String(b.sort_department_name || ''));
      if (departmentCompare) return departmentCompare;

      const serviceCompare = String(a.sort_service_name || '').localeCompare(String(b.sort_service_name || ''));
      if (serviceCompare) return serviceCompare;

      return Number(a.sort_id || 0) - Number(b.sort_id || 0);
    }).map(({ sort_department_name, sort_service_name, sort_id, department_id, subdepartment_id, ...column }) => column);

    return res.json({
      success: true,
      columns
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/queue/:department_id', reqLogin, async (req, res) => {
  const { department_id } = req.params;
  const userID = req.session.uid;

  let conn;

  try {
    await ensurePreferredDoctorSchema();
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT q.queue_id,
              ${queueCodeSql('d', 'v')} AS code,
              q.full_name,
              q.status,
              q.user_id = ? AS is_current_user,
              q.preferred_doctor_user_id,
              COALESCE(pd.full_name, pd.username) AS preferred_doctor_name
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       JOIN visits v ON v.visit_id = q.visit_id
       LEFT JOIN users pd ON pd.user_id = q.preferred_doctor_user_id
       WHERE q.department_id = ?
         AND q.status = 'waiting'
       ORDER BY q.is_emergency DESC,
                q.is_priority DESC,
                q.created_at ASC,
                q.queue_id ASC`,
      [userID, department_id]
    );

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/queue/suggest', reqLogin, async (req, res) => {
  const concern = String(req.body && req.body.concern ? req.body.concern : '').trim();

  if (!concern) {
    return res.json({
      success: true,
      ai: null
    });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    const availableDepartments = await getDepartmentNames(conn);
    const ai = await classifyVisitConcern({ concern, availableDepartments });

    if (!ai) {
      return res.json({
        success: true,
        ai: null,
        message: 'AI suggestion is currently unavailable.'
      });
    }

    return res.json({
      success: true,
      ai
    });
  } catch (err) {
    console.error('Queue suggestion failed:', err.message);
    return res.json({
      success: true,
      ai: null,
      message: 'AI suggestion is currently unavailable.'
    });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/queue/create', reqLogin, async (req, res) => {
  const uid = req.session.uid;
  const { patientName, serviceType, concern, queueType, priority, ai: rawAiSuggestion } = req.body;
  const requestedSubdepartmentIds = normalizeSubdepartmentIds(req.body.subdepartment_ids);
  const preferredDoctorUserId = Number(req.body.preferred_doctor_user_id || 0);
  const age = normalizeAge(req.body.age);
  const gender = normalizeGender(req.body.gender);
  const createsWalkInQueue = ['owner', 'admin', 'staff', 'doctor'].includes(req.session.role);
  const enforceUserActiveQueue = !createsWalkInQueue;

  if (!patientName || !serviceType || age === null || !gender) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const categoryMap = {
    pwd: 'priority',
    regular: 'general'
  };

  const category = categoryMap[queueType] || 'general';
  const isPriority = priority === 'high' ? 1 : 0;
  const isEmergency = 0;

  await ensureDemographicSchema();
  await ensurePreferredDoctorSchema();

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [userLock] = await conn.execute(
      `SELECT user_id, age, gender
       FROM users
       WHERE user_id = ?
       FOR UPDATE`,
      [uid]
    );

    if (!userLock) {
      await conn.rollback();
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
        error: 'Unauthorized'
      });
    }

    if (enforceUserActiveQueue) {
      const [activeQueue] = await conn.execute(
        `SELECT q.queue_id,
                ${queueCodeSql('d', 'v')} AS code
         FROM queues q
         JOIN departments d ON d.department_id = q.department_id
         JOIN visits v ON v.visit_id = q.visit_id
         WHERE q.user_id = ?
           AND (
             q.status IN ('waiting', 'serving')
             OR EXISTS (
               SELECT 1
               FROM queue_transfers qt
               JOIN queue_subdepartment_requirements r ON r.transfer_id = qt.transfer_id
               WHERE qt.queue_id = q.queue_id
                 AND qt.status = 'in_subdepartment'
                 AND r.status IN ('pending', 'queued', 'serving')
             )
           )
         ORDER BY q.created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [uid]
      );

      if (activeQueue) {
        await conn.rollback();

        return res.status(409).json({
          success: false,
          message: 'You already have an active queue.',
          error: 'You already have an active queue.',
          queue_id: activeQueue.queue_id,
          code: activeQueue.code
        });
      }
    }

    const availableDepartments = await getDepartmentNames(conn);
    const aiSuggestion = normalizeVisitConcernPayload(rawAiSuggestion, availableDepartments);

    const [categ] = await conn.execute(
      `SELECT code, department_id, queue_status
	       FROM departments
	       WHERE name = ?
	       FOR UPDATE`,
      [serviceType]
    );

    if (!categ) {
      await conn.rollback();
      return res.status(400).json({ error: 'Department not found' });
    }

    if (categ.queue_status !== 'open') {
      await conn.rollback();

      return res.status(403).json({
        success: false,
        message: 'Queue is currently closed.',
        error: 'Queue is currently closed.',
        department_status: categ.queue_status
      });
    }

    let preferredDoctor = null;

    if (preferredDoctorUserId) {
      [preferredDoctor] = await conn.execute(
        `SELECT user_id, full_name, username, department_id
         FROM users
         WHERE user_id = ?
           AND role = 'doctor'
           AND department_id = ?
         LIMIT 1`,
        [preferredDoctorUserId, categ.department_id]
      );

      if (!preferredDoctor) {
        await conn.rollback();

        return res.status(400).json({
          success: false,
          message: 'Selected doctor does not belong to this department.',
          error: 'Selected doctor does not belong to this department.'
        });
      }
    }

    const departmentSubdepartments = await conn.execute(
      `SELECT subdepartment_id, status
       FROM subdepartments
       WHERE department_id = ?
         AND deleted_at IS NULL
       FOR UPDATE`,
      [categ.department_id]
    );
    const validSubdepartmentIds = new Map(
      departmentSubdepartments.map(row => [Number(row.subdepartment_id), row.status])
    );

    if (enforceUserActiveQueue && validSubdepartmentIds.size && !requestedSubdepartmentIds.length) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Select at least one required service for this department.',
        error: 'Select at least one required service for this department.'
      });
    }

    const invalidSubdepartment = requestedSubdepartmentIds.find(subdepartmentId => !validSubdepartmentIds.has(subdepartmentId));
    if (invalidSubdepartment) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Selected service does not belong to this department.',
        error: 'Selected service does not belong to this department.'
      });
    }

    const closedSubdepartment = requestedSubdepartmentIds.find(subdepartmentId => validSubdepartmentIds.get(subdepartmentId) !== 'open');
    if (closedSubdepartment) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Selected service is not currently open.',
        error: 'Selected service is not currently open.'
      });
    }

    const visit = createsWalkInQueue
      ? await createVisit(conn, uid)
      : await getOrCreateActiveVisit(conn, uid);
    const code = formatQueueCode(categ.code, visit.global_number);

    const insert = await insertQueue(conn, {
      full_name: patientName,
      age,
      gender,
      category,
      visit_description: concern,
      code,
      user_id: uid,
      department_id: categ.department_id,
      visit_id: visit.visit_id,
      is_priority: isPriority,
      is_emergency: isEmergency,
      ai_suggested_department: aiSuggestion ? aiSuggestion.suggested_department : null,
      ai_category: aiSuggestion ? aiSuggestion.category : null,
      ai_priority_level: aiSuggestion ? aiSuggestion.priority_level : null,
      ai_reason: aiSuggestion ? aiSuggestion.reason : null,
      preferred_doctor_user_id: preferredDoctor ? preferredDoctor.user_id : null
    });

    let transferId = null;
    let assignedSubdepartmentQueue = null;

    if (requestedSubdepartmentIds.length) {
      const transferInsert = await conn.execute(
        `INSERT INTO queue_transfers
         (queue_id, from_department_id, to_department_id, status, called_at)
         VALUES (?, ?, ?, 'in_subdepartment', NOW())`,
        [insert.insertId, categ.department_id, categ.department_id]
      );
      transferId = Number(transferInsert.insertId);

      for (const subdepartmentId of requestedSubdepartmentIds) {
        await conn.execute(
          `INSERT INTO queue_subdepartment_requirements
           (transfer_id, subdepartment_id, status)
           VALUES (?, ?, 'pending')`,
          [transferId, subdepartmentId]
        );
      }

      await conn.execute(
        `UPDATE queues
         SET status = 'done',
             called_at = NOW(),
             finished_at = NOW(),
             counter_id = NULL,
             subdepartment_id = NULL
         WHERE queue_id = ?`,
        [insert.insertId]
      );

      assignedSubdepartmentQueue = await assignNextPendingSubdepartment(conn, transferId, uid);
      await rebalanceSubdepartmentQueues(conn, categ.department_id, uid);
    }

    if (Number(userLock.age) !== age || userLock.gender !== gender) {
      await conn.execute(
        `UPDATE users
         SET age = ?,
             gender = ?
         WHERE user_id = ?`,
        [age, gender, uid]
      );
    }

    await logQueueAction(conn, {
      queue_id: insert.insertId,
      actor_user_id: uid,
      department_id: categ.department_id,
      action: enforceUserActiveQueue ? 'queue_created' : 'admin_added_queue',
      details: {
        code,
        patientName,
        age,
        gender,
        category,
        ai_priority_level: aiSuggestion ? aiSuggestion.priority_level : null,
        subdepartment_ids: requestedSubdepartmentIds,
        preferred_doctor_user_id: preferredDoctor ? preferredDoctor.user_id : null,
        transfer_id: transferId,
        assigned_subdepartment_id: assignedSubdepartmentQueue ? assignedSubdepartmentQueue.subdepartment_id : null,
        source: enforceUserActiveQueue ? 'patient' : 'admin'
      }
    });

    const [ahead] = assignedSubdepartmentQueue
      ? await conn.execute(
        `SELECT COUNT(*) AS ahead
         FROM queue_subdepartment_requirements r2
         JOIN queue_transfers qt2 ON qt2.transfer_id = r2.transfer_id
         JOIN queues q2 ON q2.queue_id = qt2.queue_id
         JOIN queue_subdepartment_requirements r ON r.requirement_id = ?
         JOIN queue_transfers qt ON qt.transfer_id = r.transfer_id
         JOIN queues q ON q.queue_id = qt.queue_id
         WHERE r2.subdepartment_id = r.subdepartment_id
           AND r2.status = 'queued'
           AND qt2.status = 'in_subdepartment'
           AND (
             COALESCE(q2.is_emergency, 0) > COALESCE(q.is_emergency, 0)
             OR (
               COALESCE(q2.is_emergency, 0) = COALESCE(q.is_emergency, 0)
               AND COALESCE(q2.is_priority, 0) > COALESCE(q.is_priority, 0)
             )
             OR (
               COALESCE(q2.is_emergency, 0) = COALESCE(q.is_emergency, 0)
               AND COALESCE(q2.is_priority, 0) = COALESCE(q.is_priority, 0)
               AND (
                 COALESCE(r2.queued_at, q2.created_at) < COALESCE(r.queued_at, q.created_at)
                 OR (COALESCE(r2.queued_at, q2.created_at) = COALESCE(r.queued_at, q.created_at) AND q2.queue_id < q.queue_id)
               )
             )
           )`,
        [assignedSubdepartmentQueue.requirement_id || 0]
      )
      : await conn.execute(
        `SELECT COUNT(*) AS ahead
         FROM queues q2
         JOIN queues q ON q.queue_id = ?
         WHERE q2.department_id = q.department_id
           AND q2.status = 'waiting'
           AND (
             COALESCE(q2.is_emergency, 0) > COALESCE(q.is_emergency, 0)
             OR (
               COALESCE(q2.is_emergency, 0) = COALESCE(q.is_emergency, 0)
               AND COALESCE(q2.is_priority, 0) > COALESCE(q.is_priority, 0)
             )
             OR (
               COALESCE(q2.is_emergency, 0) = COALESCE(q.is_emergency, 0)
               AND COALESCE(q2.is_priority, 0) = COALESCE(q.is_priority, 0)
               AND (
                 q2.created_at < q.created_at
                 OR (q2.created_at = q.created_at AND q2.queue_id < q.queue_id)
               )
             )
           )`,
        [insert.insertId]
      );
    const aheadCount = Number(ahead.ahead || 0);

    await conn.commit();

    return res.json({
      success: true,
      queue_id: Number(insert.insertId),
      department_id: categ.department_id,
      ahead: aheadCount,
      position: aheadCount + 1,
      code,
      preferred_doctor_user_id: preferredDoctor ? preferredDoctor.user_id : null,
      preferred_doctor_name: preferredDoctor
        ? (preferredDoctor.full_name || preferredDoctor.username || 'Doctor')
        : null,
      subdepartment_id: assignedSubdepartmentQueue ? assignedSubdepartmentQueue.subdepartment_id : null,
      subdepartment_name: assignedSubdepartmentQueue ? assignedSubdepartmentQueue.subdepartment_name : null,
      subdepartment_room_number: assignedSubdepartmentQueue ? assignedSubdepartmentQueue.subdepartment_room_number : null,
      subdepartment_destination: assignedSubdepartmentQueue ? assignedSubdepartmentQueue.subdepartment_destination : null,
      ai: aiSuggestion ? {
        suggested_department: aiSuggestion.suggested_department,
        category: aiSuggestion.category,
        priority_level: aiSuggestion.priority_level,
        reason: aiSuggestion.reason
      } : null
    });
  } catch (err) {
    await conn.rollback();

    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});


app.get('/', reqLogin, reqStaffOrAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/index.html'));
});

app.get('/login.html', (req, res) => {
  res.redirect(301, '/login');
});

app.get('/signup.html', (req, res) => {
  res.redirect(301, '/signup');
});

app.use(express.static('public', {
  extensions: false
}));

app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/public/login.html');
});

app.get('/admin', reqLogin, reqAdmin, (req, res) => {
  res.sendFile(__dirname + '/protected/queueing.html');
});

app.get('/doctor', reqLogin, reqDoctor, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/doctor.html'));
});

app.get('/counter', reqLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/counter.html'));
});

app.get('/subdepartment', reqLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/subdepartment.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(__dirname + '/public/signup.html');
});

app.get('/queue', reqLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/user.html'));
});

app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/display.html'));
});

app.listen(3000, () => console.log('Running at http://localhost:3000'));
