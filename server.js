const express = require('express');
const app = express();

app.use(express.static('public'));

app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/public/login.html');
});

app.get('/signup', (req, res) => {
  res.sendFile(__dirname + '/public/signup.html');
});

app.post('/api/signup', (req, res) => {

});

app.listen(3000, () => console.log('Running at http://localhost:3000'));
