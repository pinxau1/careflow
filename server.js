const express = require('express');
const mariadb = require('mariadb');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const session = require('express-session');

dotenv.config();
const app = express();

app.use(express.json());
app.use(express.static('public'));


const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
//
// function reqLogin(req, res, next){
//   if(!req.session.uid){
//     return res.redirect('/login');
//   }
//   next():
// }

app.use(session({
  secret: 'gumandoy',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

app.get('/login.html', (req, res) => {
  res.sendFile(__dirname + '/public/login.html');
});

app.get('/signup.html', (req, res) => {
  res.sendFile(__dirname + '/public/signup.html');
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
      'INSERT INTO queues (department, userID) VALUES (?, ?)',
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

    if (user.length === 0) {
      console.log('there is none');
      return;
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


app.listen(3000, () => console.log('Running at http://localhost:3000'));
