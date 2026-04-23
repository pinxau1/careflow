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
});

console.log("this is the right file. ");
function reqLogin(req, res, next) {
  if (!req.session || !req.session.uid) {
    return res.redirect('/login.html');
  }
  next();
}

function reqAdmin(req, res, next) {
  if (req.session.role !== 'admin') {
    return res.redirect('/queue');
  }
  next();
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
  let { username, password } = req.body;

  let conn;

  try {
    conn = await pool.getConnection();
    const [user] = await conn.execute(
      'SELECT user_id, username, password_hash, role FROM users WHERE username = ?',
      [username]
    )
    console.log(user);

    if (!user) {
      console.log('there is none');
      return res.status(401).json({ error: 'User not found' });
    }

    if (await bcrypt.compare(password, user.password_hash)) {
      console.log('The data is intercepted');
      req.session.uid = user.user_id;
      req.session.role = user.role;
      res.json({ "success": true });
    } else {
      res.json(({ "failed": false }));
      console.log('there is something wrong');
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }

});

app.get('/api/queue/status', reqLogin, async (req, res) => {
  console.log('reached');
  const uid = req.session.uid;

  let conn;

  try {
    conn = await pool.getConnection();

    const [rows] = await conn.execute(
      `SELECT q.code,
            (
              SELECT COUNT(*) FROM queues 
              WHERE created_at < q.created_at
              AND status = 'waiting' 
              AND department_id = q.department_id
            ) AS ahead, department_id 
            FROM queues q
            WHERE q.user_id = ?
            AND q.status IN ('waiting', 'serving')
            ORDER BY created_at DESC
            LIMIT 1`,
      [uid]
    );

    console.log('the rows of status: ', rows.ahead, rows.code, rows.department_id);

    if (rows) {
      return res.json({ queued: true, ahead: Number(rows.ahead), code: rows.code, department_id: rows.department_id });
    } else {
      return res.json({ queued: false });
    }

  } catch (err) {
    return res.json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});



app.patch('/api/admin/skip/:queue_id', reqLogin, reqAdmin, async (req, res) => {
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

app.delete('/api/admin/delete/:queue_id', reqLogin, reqAdmin, async (req, res) => {
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

app.post('/api/admin/served', reqLogin, reqAdmin, async (req, res) => {
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

app.post('/api/admin/clear', reqLogin, reqAdmin, async (req, res) => {
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

app.post('/api/admin/next', reqLogin, reqAdmin, async (req, res) => {
  const { department_id } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE queues SET status = 'no_show'
       WHERE department_id = ? AND status = 'serving'`,
      [department_id]
    );

    const [next] = await conn.execute(
      `SELECT queue_id, code, full_name, category
       FROM queues
       WHERE department_id = ? AND status = 'waiting'
       ORDER BY is_emergency DESC, is_priority DESC, created_at ASC, queue_id ASC
       LIMIT 1`,
      [department_id]
    );

    if (!next) {
      await conn.commit();
      return res.json({ success: true, next: null });
    }

    await conn.execute(
      `UPDATE queues SET status = 'serving', called_at = NOW() WHERE queue_id = ?`,
      [next.queue_id]
    );

    await conn.commit();
    res.json({ success: true, next });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.post('/api/queue/create', reqLogin, async (req, res) => {
  const uid = req.session.uid;
  const { patientName, serviceType, concern } = req.body;

  if (!patientName || !serviceType) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [categ] = await conn.execute(
      `SELECT code, department_id FROM departments WHERE name = ?`,
      [serviceType]
    );

    console.log(categ);

    await conn.execute(
      `INSERT INTO daily_counters (date, department_id, last_number)
            VALUES (CURDATE(), ?, 1)
            ON DUPLICATE KEY UPDATE last_number = last_number + 1`,
      [categ.department_id]
    );

    const [counter] = await conn.execute(
      `SELECT last_number FROM daily_counters
            WHERE date = CURDATE() and department_id = ?`,
      [categ.department_id]
    );

    console.log(counter.last_number);

    const next = Number(counter.last_number);

    console.log('now printing:');
    console.log(next);

    const code = categ.code + String(next).padStart(3, '0');

    console.log(code);

    const insert = await conn.execute(
      `INSERT INTO queues (full_name, category, visit_description, code, user_id, department_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [patientName, serviceType, concern, code, uid, categ.department_id]
    );

    const [ahead] = await conn.execute(
      `SELECT COUNT(*) AS ahead 
            FROM queues
            WHERE created_at < (
            SELECT created_at FROM queues WHERE code = ?
            )
            AND status = 'waiting'`,
      [code]
    )

    await conn.commit();

    console.log('deptid' + categ.department_id);
    res.json({
      success: true,
      queue_id: Number(insert.insertId),
      department_id: categ.department_id,
      ahead: Number(ahead.ahead),
      code
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    console.error(err.stack);
    res.status(500).json({ error: err.message });
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

app.get('/api/admin/:department_id', reqLogin, reqAdmin, async (req, res) => {
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

app.get('/api/queue/:department_id', async (req, res) => {
  const { department_id } = req.params;

  let conn;

  try {
    conn = await pool.getConnection();

    const rows = await conn.execute(
      `SELECT code
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
  } catch (err) {
    res.status(500).json({ error: err.message });

  } finally {
    if (conn) conn.release();
  }
});

app.use(express.static('public'));

app.get('/', reqLogin, reqAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/index.html'));
});
app.get('/login.html', (req, res) => {
  res.sendFile(__dirname + '/public/login.html');
});

app.get('/admin', reqLogin, reqAdmin, (req, res) => {
  res.sendFile(__dirname + '/protected/queueing.html');
});

app.get('/signup.html', (req, res) => {
  res.sendFile(__dirname + '/public/signup.html');
});

app.get('/queue', reqLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/user.html'));
});

app.listen(3000, () => console.log('Running at http://localhost:3000'));
