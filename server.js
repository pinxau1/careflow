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

function googleAuthConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CALLBACK_URL
  );
}

function redirectPathForRole(role) {
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

  if (req.session.role === 'staff') {
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

let queueTransferSchemaReady = false;
let authSchemaReady = false;

async function ensureAuthSchema() {
  if (authSchemaReady) return;

  let conn;

  try {
    conn = await pool.getConnection();

    const requiredColumns = [
      ['email', 'VARCHAR(255) NULL'],
      ['google_id', 'VARCHAR(255) NULL'],
      ['auth_provider', "VARCHAR(50) DEFAULT 'local'"]
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

async function ensureQueueTransferSchema() {
  if (queueTransferSchemaReady) return;

  let conn;

  try {
    conn = await pool.getConnection();

    const requiredColumns = [
      ['referred_from_queue_id', 'INT NULL'],
      ['transfer_reason', 'TEXT NULL'],
      ['transferred_by_user_id', 'INT NULL'],
      ['transferred_at', 'DATETIME NULL']
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

    queueTransferSchemaReady = true;
  } catch (err) {
    console.error('Queue transfer schema setup failed:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

async function generateQueueCode(conn, departmentId) {
  await conn.execute(
    `INSERT INTO daily_counters (date, department_id, last_number)
     VALUES (CURDATE(), ?, 1)
     ON DUPLICATE KEY UPDATE last_number = last_number + 1`,
    [departmentId]
  );

  const [counter] = await conn.execute(
    `SELECT dc.last_number, d.code
     FROM daily_counters dc
     JOIN departments d ON d.department_id = dc.department_id
     WHERE dc.date = CURDATE()
       AND dc.department_id = ?`,
    [departmentId]
  );

  return counter.code + String(Number(counter.last_number)).padStart(3, '0');
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
              q.code,
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
      `SELECT queue_id, code
       FROM queues
       WHERE referred_from_queue_id = ?
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
      `SELECT department_id, name, code, queue_status, pause_message, paused_until
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
          message: targetDepartment.pause_message || 'Target department is not accepting new queues.',
          department_status: targetDepartment.queue_status,
          pause_message: targetDepartment.pause_message,
          paused_until: targetDepartment.paused_until
        }
      };
    }

    const code = await generateQueueCode(conn, targetDepartmentId);
    const visitDescription = buildTransferVisitDescription(sourceQueue.visit_description, transferReason);

    const insert = await conn.execute(
      `INSERT INTO queues
       (full_name, user_id, department_id, code, category, status, visit_description,
        is_priority, is_emergency, ai_suggested_department, ai_category, ai_priority_level,
        ai_reason, referred_from_queue_id, transfer_reason, transferred_by_user_id, transferred_at)
       VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        sourceQueue.full_name,
        sourceQueue.user_id,
        targetDepartmentId,
        code,
        sourceQueue.category,
        visitDescription,
        sourceQueue.is_priority || 0,
        sourceQueue.is_emergency || 0,
        sourceQueue.ai_suggested_department,
        sourceQueue.ai_category,
        sourceQueue.ai_priority_level,
        sourceQueue.ai_reason,
        sourceQueue.queue_id,
        transferReason || null,
        req.session.uid
      ]
    );

    const newQueue = {
      queue_id: Number(insert.insertId),
      code,
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

ensureQueueTransferSchema();
ensureAuthSchema();

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
  const joins = ['JOIN departments d ON d.department_id = q.department_id'];
  joins.push('LEFT JOIN queues tq ON tq.referred_from_queue_id = q.queue_id');

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
        'q.code LIKE ?',
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
            q.code,
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
            tq.code AS transferred_queue_code,
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
  const enforceUserActiveQueue = !['owner', 'admin', 'staff'].includes(req.session.role);
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
      `SELECT department_id, code, queue_status, pause_message, paused_until
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
        `SELECT queue_id, code
         FROM queues
         WHERE user_id = ?
           AND status IN ('waiting', 'serving')
         ORDER BY created_at DESC
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
        message: department.pause_message || 'Queue is currently closed.',
        error: department.pause_message || 'Queue is currently closed.',
        department_status: department.queue_status,
        pause_message: department.pause_message,
        paused_until: department.paused_until
      });
    }

    await conn.execute(
      `INSERT INTO daily_counters (date, department_id, last_number)
       VALUES (CURDATE(), ?, 1)
       ON DUPLICATE KEY UPDATE last_number = last_number + 1`,
      [department.department_id]
    );

    const [counter] = await conn.execute(
      `SELECT last_number
       FROM daily_counters
       WHERE date = CURDATE()
         AND department_id = ?`,
      [department.department_id]
    );

    const code = department.code + String(Number(counter.last_number)).padStart(3, '0');

    const dbres = await conn.execute(
      `INSERT INTO queues (full_name, user_id, department_id, code, category)
	       VALUES (NULL, ?, ?, ?, 'general')`,
      [uid, department.department_id, code]
    );

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
  const { fullName, contact, username, password } = req.body;

  if (!fullName || !username || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let conn;

  try {
    conn = await pool.getConnection();

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
       WHERE u.role IN ('admin', 'staff')
       ORDER BY FIELD(u.role, 'admin', 'staff'), u.full_name ASC, u.username ASC`
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
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT 
	          d.department_id,
	          d.name,
	          d.code,
	          d.queue_status,
	          d.pause_message,
	          d.paused_until,
	          COUNT(CASE WHEN q.status IN ('waiting', 'serving') THEN 1 END) AS active_count
	       FROM departments d
	       LEFT JOIN queues q ON q.department_id = d.department_id
	       GROUP BY d.department_id, d.name, d.code, d.queue_status, d.pause_message, d.paused_until
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

app.patch('/api/admin/departments/:department_id/queue-status', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id } = req.params;
  const { queueOpen, queue_status, pause_message, paused_until } = req.body;

  if (!canAccessDepartment(req, department_id)) {
    return res.status(403).json({ error: 'You cannot update this department' });
  }

  const allowedStatuses = ['open', 'pause', 'closed'];
  const queueStatus = allowedStatuses.includes(queue_status)
    ? queue_status
    : (queueOpen ? 'open' : 'closed');
  const pauseMessage = queueStatus === 'pause' ? (pause_message || null) : null;
  const pausedUntil = queueStatus === 'pause' && paused_until ? paused_until : null;

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const result = await conn.execute(
      `UPDATE departments
	       SET queue_status = ?,
	           pause_message = ?,
	           paused_until = ?
	       WHERE department_id = ?`,
      [queueStatus, pauseMessage, pausedUntil, department_id]
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
        queue_status: queueStatus,
        pause_message: pauseMessage,
        paused_until: pausedUntil
      }
    });

    await conn.commit();

    return res.json({
      success: true,
      department_id: Number(department_id),
      queue_status: queueStatus,
      pause_message: pauseMessage,
      paused_until: pausedUntil
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
  const { fullName, contact, username, password, departmentId } = req.body;

  if (!fullName || !username || !password || !departmentId) {
    return res.status(400).json({ error: 'Missing required fields' });
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

    const hashed = await bcrypt.hash(password, 10);

    const result = await conn.execute(
      `INSERT INTO users
       (username, contact_number, password_hash, full_name, role, department_id)
       VALUES (?, ?, ?, ?, 'staff', ?)`,
      [username, contact || null, hashed, fullName, departmentId]
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
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '').trim();
  const departmentId = req.body.departmentId || null;

  if (!fullName || !username || !role) {
    return res.status(400).json({ error: 'Name, username, and role are required' });
  }

  if (!['admin', 'staff'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or staff' });
  }

  if (role === 'staff' && !departmentId) {
    return res.status(400).json({ error: 'Staff accounts require an assigned department' });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [account] = await conn.execute(
      `SELECT user_id, role
       FROM users
       WHERE user_id = ? AND role IN ('admin', 'staff')
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
      'username = ?',
      'role = ?',
      'department_id = ?'
    ];
    const values = [
      fullName,
      contact || null,
      username,
      role,
      role === 'staff' ? departmentId : (departmentId || null)
    ];

    if (password) {
      fields.push('password_hash = ?');
      values.push(await bcrypt.hash(password, 10));
    }

    values.push(user_id);

    await conn.execute(
      `UPDATE users
       SET ${fields.join(', ')}
       WHERE user_id = ? AND role IN ('admin', 'staff')`,
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
      `SELECT user_id, role
       FROM users
       WHERE user_id IN (${placeholders}) AND role IN ('admin', 'staff')
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

    // The users table has no deleted_at/status column, so this is a guarded permanent delete.
    const result = await conn.execute(
      `DELETE FROM users
       WHERE user_id IN (${placeholders}) AND role IN ('admin', 'staff')`,
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

    if (!staff || staff.role !== 'staff') {
      return res.status(400).json({ error: 'User is not a staff account' });
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
       WHERE user_id = ? AND role = 'staff'`,
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
  const { fullName, contact, username, finalPassword } = req.body;
  const email = normalizeEmail(req.body.email);
  const hashed = await bcrypt.hash(finalPassword, 10);

  let conn;
  try {
    conn = await pool.getConnection();
    await ensureAuthSchema();
    await conn.execute(
      `INSERT INTO users
       (username, contact_number, email, password_hash, full_name, auth_provider)
       VALUES (?, ?, ?, ?, ?, 'local')`,
      [username, contact, email, hashed, fullName]
    );
    res.json({ "success": true });
  }
  catch (err) {
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
    conn = await pool.getConnection();

    const [row] = await conn.execute(
      `SELECT 
          q.queue_id,
          q.code,
          q.full_name,
          q.department_id,
          q.status,
          q.referred_from_queue_id,
          rd.name AS referred_from_department_name,
          q.ai_suggested_department,
          q.ai_category,
          q.ai_priority_level,
          q.ai_reason,
          d.name AS department_name,
          d.queue_status AS department_queue_status,
          (
            SELECT COUNT(*)
            FROM queues q2
            WHERE q2.department_id = q.department_id
              AND q2.status = 'waiting'
              AND q2.created_at < q.created_at
          ) AS ahead
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       LEFT JOIN queues rq ON rq.queue_id = q.referred_from_queue_id
       LEFT JOIN departments rd ON rd.department_id = rq.department_id
       WHERE q.user_id = ?
         AND q.status IN ('waiting', 'serving')
       ORDER BY q.created_at DESC
       LIMIT 1`,
      [uid]
    );

    if (row) {
      const queueStatus = row.department_queue_status || 'open';

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
        referred_from_queue_id: row.referred_from_queue_id,
        referred_from_department_name: row.referred_from_department_name,
        referral_message: row.referred_from_queue_id
          ? `You have been referred to ${row.department_name}.`
          : null,
        ahead: Number(row.ahead || 0),
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
            WHEN SUM(queue_status = 'pause') > 0 THEN 'pause'
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
      `SELECT queue_id, code, status, department_id
       FROM queues
       WHERE user_id = ?
         AND status IN ('waiting', 'serving')
       ORDER BY created_at DESC, queue_id DESC
       LIMIT 1
       FOR UPDATE`,
      [uid]
    );

    if (!queue || queue.status !== 'waiting') {
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
      [queue.queue_id]
    );

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
          q.code,
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
    conn = await pool.getConnection();

    const isStaff = req.session.role === 'staff';
    const staffDepartmentId = req.session.department_id;

    if (isStaff && !staffDepartmentId) {
      return res.status(403).json({
        error: 'Staff account has no assigned department'
      });
    }

    const departments = await conn.execute(
      `SELECT d.department_id, d.name, d.code, d.queue_status,
	              d.pause_message, d.paused_until,
	              COUNT(CASE WHEN q.status IN ('waiting', 'serving') THEN 1 END) AS queue_count
	       FROM departments d
	       LEFT JOIN queues q ON q.department_id = d.department_id
	       WHERE (? = 0 OR d.department_id = ?)
	       GROUP BY d.department_id, d.name, d.code, d.queue_status, d.pause_message, d.paused_until
	       ORDER BY d.name ASC`,
      [
        isStaff ? 1 : 0,
        isStaff ? staffDepartmentId : 0
      ]
    );

    const counters = await conn.execute(
      `SELECT c.counter_id, c.department_id, c.name, c.status, c.break_until,
	              c.current_queue_id, q.code AS current_queue_code
	       FROM counters c
	       LEFT JOIN queues q ON q.queue_id = c.current_queue_id
	       WHERE c.deleted_at IS NULL
	         AND (? = 0 OR c.department_id = ?)
	       ORDER BY c.department_id ASC, c.counter_id ASC`,
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
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT 
          q.queue_id,
          q.code,
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
	          u.age,
	          c.counter_id,
	          c.name AS counter_name
       FROM queues q
       LEFT JOIN users u ON u.user_id = q.user_id
       LEFT JOIN counters c ON c.current_queue_id = q.queue_id
       WHERE q.department_id = ?
         AND q.status IN ('waiting', 'serving')
       ORDER BY 
         (q.status = 'serving') DESC,
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
          q.code AS current_queue_code
       FROM counters c
       JOIN departments d ON d.department_id = c.department_id
       LEFT JOIN queues q ON q.queue_id = c.current_queue_id
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
      `SELECT queue_id, department_id
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

    await logQueueAction(conn, {
      queue_id,
      actor_user_id: req.session.uid,
      department_id: queue.department_id,
      action: 'skipped',
      details: {
        notes: req.body && req.body.notes ? req.body.notes : null
      }
    });

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
      `SELECT queue_id, department_id, status
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
      `SELECT queue_id, department_id, status
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
      `SELECT q.queue_id, c.counter_id
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
      `SELECT queue_id
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
      `SELECT q.queue_id, q.code, q.full_name, q.category, c.counter_id, c.name AS counter_name
       FROM queues q
       LEFT JOIN counters c ON c.current_queue_id = q.queue_id
       WHERE q.department_id = ?
         AND q.status = 'serving'
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
              q.code,
              q.full_name,
              q.department_id,
              d.name AS department_name,
              q.category,
              q.status,
              c.counter_id
	       FROM queues q
	       JOIN departments d ON d.department_id = q.department_id
	       LEFT JOIN counters c ON c.current_queue_id = q.queue_id
	       WHERE q.department_id = ?
	         AND q.status = 'serving'
	       FOR UPDATE`,
      [department_id]
    );

    await conn.execute(
      `UPDATE queues
	       SET status = 'done',
	           finished_at = NOW()
	       WHERE department_id = ?
	         AND status = 'serving'`,
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
    }

    const [next] = await conn.execute(
      `SELECT q.queue_id,
              q.code,
              q.full_name,
              q.category,
              q.department_id,
              d.name AS department_name,
              u.email,
              COALESCE(q.full_name, u.full_name, u.username, 'Patient') AS patient_name
	       FROM queues q
	       JOIN departments d ON d.department_id = q.department_id
	       LEFT JOIN users u ON u.user_id = q.user_id
	       WHERE q.department_id = ?
	         AND q.status = 'waiting'
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

    await logQueueAction(conn, {
      queue_id: next.queue_id,
      actor_user_id: req.session.uid,
      department_id,
      action: 'called_next',
      details: {
        code: next.code,
        counter_id: selectedCounter ? selectedCounter.counter_id : null,
        counter_name: selectedCounter ? selectedCounter.name : null
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
      counterName: selectedCounter ? selectedCounter.name : null,
      type: 'call'
    } : null;
    queueNotificationEmail(notification);

    return res.json({
      success: true,
      message: 'Queue called. Email notification sent if patient has an email.',
      completed_queue: servingRows[0] ? {
        ...servingRows[0],
        status: 'done'
      } : null,
      next: {
        ...next,
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
              q.code,
              q.full_name,
              q.department_id,
              q.status,
              d.name AS department_name,
              c.name AS counter_name,
              u.email,
              COALESCE(q.full_name, u.full_name, u.username, 'Patient') AS patient_name
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
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

app.post('/api/admin/transfer', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const result = await performQueueTransfer(req, {
    queue_id: req.body.queue_id,
    target_department_id: req.body.target_department_id,
    reason: req.body.reason
  });

  return res.status(result.status).json(result.body);
});

app.patch('/api/admin/queues/:queue_id/transfer', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queue_id } = req.params;
  const { to_department_id, notes } = req.body;

  const result = await performQueueTransfer(req, {
    queue_id,
    target_department_id: to_department_id,
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
      `SELECT queue_id, code, full_name, category, status, department_id
       FROM queues
       WHERE user_id = ? AND status IN ('waiting', 'serving')
       ORDER BY created_at DESC LIMIT 1`,
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
      q.code LIKE ?
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
          q.code,
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
          tq.code AS transferred_queue_code,
          q.created_at,
          q.called_at,
          q.finished_at
       FROM queues q
       JOIN departments d ON d.department_id = q.department_id
       LEFT JOIN queues tq ON tq.referred_from_queue_id = q.queue_id
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
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT queue_id, code, department_id, full_name, category
            FROM queues
            WHERE department_id = ?
            AND status = 'waiting'
            ORDER BY is_emergency DESC,
                      is_priority DESC,
                      created_at ASC,
                      queue_id ASC`,
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

app.get('/api/display/now-serving', reqLogin, async (req, res) => {
  const { department_id } = req.query;
  let conn;

  try {
    conn = await pool.getConnection();

    const departmentParams = [];
    let departmentFilter = '';

    if (department_id) {
      departmentFilter = 'WHERE d.department_id = ?';
      departmentParams.push(department_id);
    }

    const departments = await conn.execute(
      `SELECT d.department_id, d.name, d.queue_status, d.pause_message, d.paused_until
       FROM departments d
       ${departmentFilter}
       ORDER BY d.name ASC`,
      departmentParams
    );

    const result = [];

    for (const department of departments) {
      const serving = await conn.execute(
        `SELECT q.queue_id,
                q.code,
                q.full_name,
                q.called_at,
                d.name AS department_name,
                c.name AS counter_name,
                (
                  SELECT MAX(l.log_id)
                  FROM queue_logs l
                  WHERE l.queue_id = q.queue_id
                    AND l.action IN ('called_next', 'recalled')
                ) AS announcement_event_id
         FROM queues q
         LEFT JOIN departments d ON d.department_id = q.department_id
         LEFT JOIN counters c ON c.current_queue_id = q.queue_id
         WHERE q.department_id = ?
           AND q.status = 'serving'
         ORDER BY q.called_at ASC, q.queue_id ASC`,
        [department.department_id]
      );

      const upNext = await conn.execute(
        `SELECT q.queue_id, q.code, q.full_name
         FROM queues q
         WHERE q.department_id = ?
           AND q.status = 'waiting'
         ORDER BY q.is_emergency DESC,
                  q.is_priority DESC,
                  q.created_at ASC,
                  q.queue_id ASC
         LIMIT 5`,
        [department.department_id]
      );

      const [waitingCount] = await conn.execute(
        `SELECT COUNT(*) AS count
         FROM queues q
         WHERE q.department_id = ?
           AND q.status = 'waiting'`,
        [department.department_id]
      );

      result.push({
        department_id: department.department_id,
        name: department.name,
        queue_status: department.queue_status,
        pause_message: department.pause_message,
        paused_until: department.paused_until,
        waiting_count: Number(waitingCount.count || 0),
        serving,
        up_next: upNext
      });
    }

    return res.json({
      success: true,
      departments: result
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
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT code, full_name, status
       FROM queues
       WHERE department_id = ?
         AND status = 'waiting'
       ORDER BY is_emergency DESC,
                is_priority DESC,
                created_at ASC,
                queue_id ASC`,
      [department_id]
    );

    const userQueue = await conn.execute(
      `SELECT code FROM queues WHERE `
    )


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
  const enforceUserActiveQueue = !['owner', 'admin', 'staff'].includes(req.session.role);

  if (!patientName || !serviceType) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const categoryMap = {
    pwd: 'priority',
    regular: 'general'
  };

  const category = categoryMap[queueType] || 'general';
  const isPriority = priority === 'high' ? 1 : 0;
  const isEmergency = 0;

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

    if (enforceUserActiveQueue) {
      const [activeQueue] = await conn.execute(
        `SELECT queue_id, code
         FROM queues
         WHERE user_id = ?
           AND status IN ('waiting', 'serving')
         ORDER BY created_at DESC
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
      `SELECT code, department_id, queue_status, pause_message, paused_until
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
        message: categ.pause_message || 'Queue is currently closed.',
        error: categ.pause_message || 'Queue is currently closed.',
        department_status: categ.queue_status,
        pause_message: categ.pause_message,
        paused_until: categ.paused_until
      });
    }

    await conn.execute(
      `INSERT INTO daily_counters (date, department_id, last_number)
       VALUES (CURDATE(), ?, 1)
       ON DUPLICATE KEY UPDATE last_number = last_number + 1`,
      [categ.department_id]
    );

    const [counter] = await conn.execute(
      `SELECT last_number
       FROM daily_counters
       WHERE date = CURDATE()
         AND department_id = ?`,
      [categ.department_id]
    );

    const next = Number(counter.last_number);
    const code = categ.code + String(next).padStart(3, '0');

    const insert = await conn.execute(
      `INSERT INTO queues
	       (full_name, category, visit_description, code, user_id, department_id, is_priority, is_emergency, ai_suggested_department, ai_category, ai_priority_level, ai_reason)
	       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        patientName,
        category,
        concern,
        code,
        uid,
        categ.department_id,
        isPriority,
        isEmergency,
        aiSuggestion ? aiSuggestion.suggested_department : null,
        aiSuggestion ? aiSuggestion.category : null,
        aiSuggestion ? aiSuggestion.priority_level : null,
        aiSuggestion ? aiSuggestion.reason : null
      ]
    );

    await logQueueAction(conn, {
      queue_id: insert.insertId,
      actor_user_id: uid,
      department_id: categ.department_id,
      action: enforceUserActiveQueue ? 'queue_created' : 'admin_added_queue',
      details: {
        code,
        patientName,
        category,
        ai_priority_level: aiSuggestion ? aiSuggestion.priority_level : null,
        source: enforceUserActiveQueue ? 'patient' : 'admin'
      }
    });

    const [ahead] = await conn.execute(
      `SELECT COUNT(*) AS ahead
       FROM queues
       WHERE department_id = ?
         AND status = 'waiting'
         AND created_at < (
           SELECT created_at FROM queues WHERE queue_id = ?
         )`,
      [categ.department_id, insert.insertId]
    );

    await conn.commit();

    return res.json({
      success: true,
      queue_id: Number(insert.insertId),
      department_id: categ.department_id,
      ahead: Number(ahead.ahead || 0),
      code,
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


app.use(express.static('public'));

app.get('/', reqLogin, reqStaffOrAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/index.html'));
});
app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/public/login.html');
});

app.get('/admin', reqLogin, reqAdmin, (req, res) => {
  res.sendFile(__dirname + '/protected/queueing.html');
});

app.get('/signup', (req, res) => {
  res.sendFile(__dirname + '/public/signup.html');
});

app.get('/queue', reqLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/user.html'));
});

app.get('/display', reqLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/display.html'));
});

app.listen(3000, () => console.log('Running at http://localhost:3000'));
