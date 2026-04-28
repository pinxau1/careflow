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
    return res.redirect('/login');
    // return res.status(401).json({ error: 'Unauthorized' });
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
    const dbres = await conn.execute(
      'INSERT INTO queues (department, user_id) VALUES (?, ?)',
      [departmentName, uid]
    );
    res.json({
      success: true,
      queueID: Number(dbres.insertId)
    });
  }
  catch (err) {
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
      `SELECT user_id, role FROM users WHERE user_id = ?`,
      [user_id]
    );

    if (!staff || staff.role !== 'staff') {
      return res.status(400).json({ error: 'User is not a staff account' });
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

    const [settings] = await conn.execute(
      `SELECT queue_status
       FROM system_settings
       WHERE id = 1
       LIMIT 1`
    );

    const queueStatus = settings ? settings.queue_status : 'open';

    const [row] = await conn.execute(
      `SELECT 
          q.queue_id,
          q.code,
          q.full_name,
          q.status,
          q.department_id,
          d.name AS department_name,
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
      `SELECT d.department_id, d.name, d.code,
              COUNT(CASE WHEN q.status IN ('waiting', 'serving') THEN 1 END) AS queue_count
       FROM departments d
       LEFT JOIN queues q ON q.department_id = d.department_id
       WHERE (? = 0 OR d.department_id = ?)
       GROUP BY d.department_id, d.name, d.code
       ORDER BY d.name ASC`,
      [
        isStaff ? 1 : 0,
        isStaff ? staffDepartmentId : 0
      ]
    );

    const counters = await conn.execute(
      `SELECT counter_id, department_id, name, status, break_until, current_queue_id
       FROM counters
       WHERE (? = 0 OR department_id = ?)
       ORDER BY department_id ASC, counter_id ASC`,
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
       WHERE counter_id = ?`,
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
       WHERE counter_id = ?`,
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
      `DELETE FROM counters WHERE counter_id = ?`,
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
    await conn.execute(
      `UPDATE queues SET status = 'no_show' WHERE queue_id = ?`,
      [queue_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.delete('/api/admin/delete/:queue_id', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { queue_id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      `DELETE FROM queues WHERE queue_id = ?`,
      [queue_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.post('/api/admin/served', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      `UPDATE queues
       SET status = 'done', finished_at = NOW()
       WHERE department_id = ? AND status = 'serving'`,
      [department_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.post('/api/admin/clear', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      `UPDATE queues SET status = 'void'
       WHERE department_id = ? AND status = 'waiting'`,
      [department_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});


app.post('/api/admin/next', reqLogin, reqStaffOrAdmin, async (req, res) => {
  const { department_id } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE queues
    SET status = 'done',
    finished_at = NOW()
    WHERE department_id = ?
    AND status = 'serving'`,
      [department_id]
    );

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

    await conn.commit();

    return res.json({
      success: true,
      next
    });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
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


    const [categ] = await conn.execute(
      `SELECT code, department_id FROM departments WHERE name = ?`,
      [serviceType]
    );

    if (!categ) {
      await conn.rollback();
      return res.status(400).json({ error: 'Department not found' });
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

//END

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

app.listen(3000, () => console.log('Running at http://localhost:3000'));
