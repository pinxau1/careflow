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
app.use(express.json());
app.use(express.static('public'));


const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

console.log("this is the right file. ");
function reqLogin(req, res, next) {
  if (!req.session || !req.session.uid) {
    return res.redirect('/login.html');
    // return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}


app.get('/', reqLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/index.html'));
});
app.get('/login.html', (req, res) => {
  res.sendFile(__dirname + '/public/login.html');
});

app.get('/signup.html', (req, res) => {
  res.sendFile(__dirname + '/public/signup.html');
});



app.get('/queue', reqLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected/user.html'));
});

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
      'SELECT user_id, username, password_hash FROM users WHERE username = ?',
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

app.post('/api/queue/create', reqLogin, async (req, res) => {
  const uid = req.session.uid;
  const { patientName, serviceType, concern } = req.body;

  if (!patientName || !serviceType) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const conn = await pool.getConnection();

  try {
    // console.log('running add queue');
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


    await conn.commit();

    res.json({
      success: true,
      queue_id: Number(insert.insertId),
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


app.listen(3000, () => console.log('Running at http://localhost:3000'));
