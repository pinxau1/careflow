const express = require('express');
const mariadb = require('mariadb');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');

dotenv.config();
const app = express();

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


const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  bigIntAsNumber: true
});

console.log(pool.host, pool.port, pool.user, pool.password, pool.database);

console.log("this is the right file. ");

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



app.post('/api/queue', async (req, res) => {
  console.log(req.body);

  const uid = req.session.uid;
  if (!uid) return res.status(401).json({ error: 'Not logged in' });
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

	    const [department] = await conn.execute(
	      `SELECT department_id, code, queue_status, pause_message, paused_until
	       FROM departments
	       WHERE name = ?`,
      [departmentName]
    );

    if (!department) {
      await conn.rollback();
      return res.status(400).json({ error: 'Department not found' });
    }

	    if (department.queue_status !== 'open') {
	      await conn.rollback();
	      return res.status(403).json({
	        error: department.pause_message || 'This department is currently not accepting queues',
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

	    await conn.execute(
	      `INSERT INTO queue_logs (queue_id, actor_user_id, action)
	       VALUES (?, ?, 'created')`,
	      [dbres.insertId, uid]
	    );

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
          u.department_id,
          d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.department_id = u.department_id
       WHERE u.role = 'staff'
       ORDER BY u.full_name ASC, u.username ASC`
    );

    return res.json({
      success: true,
      staff: rows
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

    return res.json({
      success: true,
      departments: rows
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

	    const result = await conn.execute(
	      `UPDATE departments
	       SET queue_status = ?,
	           pause_message = ?,
	           paused_until = ?
	       WHERE department_id = ?`,
	      [queueStatus, pauseMessage, pausedUntil, department_id]
	    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    return res.json({
	      success: true,
	      department_id: Number(department_id),
	      queue_status: queueStatus,
	      pause_message: pauseMessage,
	      paused_until: pausedUntil
	    });
  } catch (err) {
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

app.patch('/api/admin/staff/:user_id/department', reqLogin, reqStaffOrAdmin, async (req, res) => {
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

app.post('/api/signup', async (req, res) => {
  console.log(req.body);
  const { fullName, contact, username, finalPassword } = req.body;
  const hashed = await bcrypt.hash(finalPassword, 10);

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.execute(
      'INSERT INTO users (username, contact_number, password_hash, full_name) VALUES (?, ?, ?, ?)',
      [username, contact, hashed, fullName]
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
      return res.status(401).json({ error: 'User not found' });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid password' });
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
          q.status,
          q.department_id,
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
        ahead: Number(row.ahead || 0)
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

app.patch('/api/admin/queue-status', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queueOpen } = req.body;
  const queueStatus = queueOpen ? 'open' : 'closed';
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.execute(
      `INSERT INTO system_settings (id, queue_status)
       VALUES (1, ?)
       ON DUPLICATE KEY UPDATE queue_status = VALUES(queue_status)`,
      [queueStatus]
    );
    return res.json({ success: true, queue_status: queueStatus });
  } catch (err) {
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

	    await conn.execute(
	      `INSERT INTO queue_logs (queue_id, actor_user_id, action, notes)
	       VALUES (?, ?, 'no_show', ?)`,
	      [queue_id, req.session.uid, req.body && req.body.notes ? req.body.notes : null]
	    );

	    await conn.commit();
	    res.json({ success: true });
	  } catch (err) {
	    await conn.rollback();
	    res.status(500).json({ error: err.message });
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

	    await conn.execute(
	      `INSERT INTO queue_logs (queue_id, actor_user_id, action)
	       VALUES (?, ?, 'void')`,
	      [queue_id, req.session.uid]
	    );

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
	      await conn.execute(
	        `INSERT INTO queue_logs (queue_id, actor_user_id, counter_id, action)
	         VALUES (?, ?, ?, 'served')`,
	        [row.queue_id, req.session.uid, row.counter_id || null]
	      );
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
	      await conn.execute(
	        `INSERT INTO queue_logs (queue_id, actor_user_id, action, notes)
	         VALUES (?, ?, 'void', 'Queue cleared')`,
	        [row.queue_id, req.session.uid]
	      );
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
	    return res.status(403).json({ error: 'You cannot update this department' });
	  }

  const conn = await pool.getConnection();

	  try {
	    await conn.beginTransaction();

	    let selectedCounter = null;

	    if (counter_id) {
	      const [counter] = await conn.execute(
	        `SELECT counter_id, department_id, name, status, current_queue_id
	         FROM counters
	         WHERE counter_id = ?
	           AND department_id = ?
	           AND deleted_at IS NULL`,
	        [counter_id, department_id]
	      );

	      if (!counter) {
	        await conn.rollback();
	        return res.status(400).json({ error: 'Counter not found for this department' });
	      }

	      if (counter.status !== 'open') {
	        await conn.rollback();
	        return res.status(400).json({ error: 'Selected counter is not open' });
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
	         LIMIT 1`,
	        [department_id]
	      );

	      selectedCounter = counter || null;
	    }

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
	      await conn.execute(
	        `INSERT INTO queue_logs (queue_id, actor_user_id, counter_id, action)
	         VALUES (?, ?, ?, 'served')`,
	        [row.queue_id, req.session.uid, row.counter_id || null]
	      );
	    }

	    const [next] = await conn.execute(
	      `SELECT queue_id, code, full_name, category
	       FROM queues
	       WHERE department_id = ?
	         AND status = 'waiting'
	       ORDER BY is_emergency DESC,
	                is_priority DESC,
	                created_at ASC,
	                queue_id ASC
	       LIMIT 1`,
	      [department_id]
	    );

    if (!next) {
      await conn.commit();
      return res.json({
        success: true,
        next: null,
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

	    await conn.execute(
	      `INSERT INTO queue_logs (queue_id, actor_user_id, counter_id, action)
	       VALUES (?, ?, ?, 'called')`,
	      [next.queue_id, req.session.uid, selectedCounter ? selectedCounter.counter_id : null]
	    );

	    await conn.commit();

	    return res.json({
	      success: true,
	      next: {
	        ...next,
	        counter_id: selectedCounter ? selectedCounter.counter_id : null,
	        counter_name: selectedCounter ? selectedCounter.name : null
	      }
	    });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
	  }
	});

app.post('/api/admin/queues/:queue_id/recall', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queue_id } = req.params;
  let conn;

  try {
    conn = await pool.getConnection();

    const [queue] = await conn.execute(
      `SELECT queue_id, department_id, status
       FROM queues
       WHERE queue_id = ?`,
      [queue_id]
    );

    if (!queue) {
      return res.status(404).json({ error: 'Queue entry not found' });
    }

    if (!canAccessDepartment(req, queue.department_id)) {
      return res.status(403).json({ error: 'You cannot recall this queue entry' });
    }

    await conn.execute(
      `INSERT INTO queue_logs (queue_id, actor_user_id, action)
       VALUES (?, ?, 'recall')`,
      [queue_id, req.session.uid]
    );

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/admin/queues/:queue_id/transfer', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queue_id } = req.params;
  const { to_department_id, notes } = req.body;

  if (!to_department_id) {
    return res.status(400).json({ error: 'Target department is required' });
  }

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
      return res.status(403).json({ error: 'You cannot transfer this queue entry' });
    }

    const [targetDepartment] = await conn.execute(
      `SELECT department_id, queue_status, pause_message, paused_until
       FROM departments
       WHERE department_id = ?`,
      [to_department_id]
    );

    if (!targetDepartment) {
      await conn.rollback();
      return res.status(400).json({ error: 'Target department not found' });
    }

    if (Number(targetDepartment.department_id) === Number(queue.department_id)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Queue entry is already in this department' });
    }

    if (targetDepartment.queue_status !== 'open') {
      await conn.rollback();
      return res.status(400).json({
        error: targetDepartment.pause_message || 'Target department is not accepting new queues',
        department_status: targetDepartment.queue_status,
        pause_message: targetDepartment.pause_message,
        paused_until: targetDepartment.paused_until
      });
    }

    await conn.execute(
      `UPDATE counters
       SET current_queue_id = NULL
       WHERE current_queue_id = ?`,
      [queue_id]
    );

    await conn.execute(
      `UPDATE queues
       SET department_id = ?,
           status = 'waiting',
           called_at = NULL,
           finished_at = NULL
       WHERE queue_id = ?`,
      [to_department_id, queue_id]
    );

    await conn.execute(
      `INSERT INTO queue_logs
       (queue_id, actor_user_id, action, from_department_id, to_department_id, notes)
       VALUES (?, ?, 'transferred', ?, ?, ?)`,
      [queue_id, req.session.uid, queue.department_id, to_department_id, notes || null]
    );

    await conn.commit();

    return res.json({
      success: true,
      queue_id: Number(queue_id),
      from_department_id: Number(queue.department_id),
      to_department_id: Number(to_department_id)
    });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
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
          l.notes,
          l.created_at,
          u.full_name AS actor_name,
          c.name AS counter_name,
          fd.name AS from_department_name,
          td.name AS to_department_name
       FROM queue_logs l
       LEFT JOIN users u ON u.user_id = l.actor_user_id
       LEFT JOIN counters c ON c.counter_id = l.counter_id
       LEFT JOIN departments fd ON fd.department_id = l.from_department_id
       LEFT JOIN departments td ON td.department_id = l.to_department_id
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
        `SELECT q.queue_id, q.code, q.full_name, q.called_at, c.name AS counter_name
         FROM queues q
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

      result.push({
        department_id: department.department_id,
        name: department.name,
        queue_status: department.queue_status,
        pause_message: department.pause_message,
        paused_until: department.paused_until,
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

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/queue/create', reqLogin, async (req, res) => {
  const uid = req.session.uid;
  const { patientName, serviceType, concern, queueType, priority } = req.body;

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

    const [activeQueue] = await conn.execute(
      `SELECT queue_id, code
       FROM queues
       WHERE user_id = ?
         AND status IN ('waiting', 'serving')
       ORDER BY created_at DESC
       LIMIT 1`,
      [uid]
    );

    if (activeQueue) {
      await conn.rollback();

      return res.status(409).json({
        success: false,
        error: 'You already have an active queue',
        queue_id: activeQueue.queue_id,
        code: activeQueue.code
      });
    }

	    const [categ] = await conn.execute(
	      `SELECT code, department_id, queue_status, pause_message, paused_until
	       FROM departments
	       WHERE name = ?`,
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
	        error: categ.pause_message || 'This department is currently not accepting queues',
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
	       (full_name, category, visit_description, code, user_id, department_id, is_priority, is_emergency)
	       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	      [patientName, category, concern, code, uid, categ.department_id, isPriority, isEmergency]
	    );

	    await conn.execute(
	      `INSERT INTO queue_logs (queue_id, actor_user_id, action)
	       VALUES (?, ?, 'created')`,
	      [insert.insertId, uid]
	    );

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
      code
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
