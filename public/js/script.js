let currentCodeDisplay = document.getElementById('current-queue');
let button = document.querySelector('.next-button');
let form = document.getElementById('login-card');
let category;
let code = 1;
let codeCurrent = (category + code);


form.addEventListener('submit', (e) => {
  e.preventDefault();

  const email = form.email.value;
  const password = form.password.value;

  console.log(email, password);
});

button.addEventListener("click", () => {
  currentCodeDisplay.textContent = code;
  code++;
});









