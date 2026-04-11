let formSignup = document.getElementById("signup-form");
let formLogin = document.getElementById("login-form");


if (formSignup) {
  const password = document.getElementById("signup-password");
  const confirmPassword = document.getElementById("signup-confirm");
  const toggle = document.getElementById("toggle-signup-pw");
  const toggleConfirm = document.getElementById("toggle-confirm-pw");
  const mismatch = document.getElementById("pw-mismatch");

  function togglePass(input, icon) {
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";

    icon.textContent = isHidden ? "visibility_off" : "visibility";
  }

  function checkMatch() {
    if (confirmPassword.value.trim() === "") {

      mismatch.classList.add('hidden');
      return;

    }
    if (password.value.trim() !== confirmPassword.value.trim()) {
      mismatch.classList.remove('hidden');
    }
    else {

      mismatch.classList.add('hidden');
    }
  }

  toggle.addEventListener("click", () => {
    togglePass(password, toggle);
  });

  toggleConfirm.addEventListener("click", () => {
    togglePass(confirmPassword, toggleConfirm);
  });
  password.addEventListener("input", checkMatch);
  confirmPassword.addEventListener("input", checkMatch);

  formSignup.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = formSignup.fullName.value;
    const contact = formSignup.contactNum.value;
    const username = formSignup.username.value;
    const finalPassword = password.value.trim();

    const res = await fetch('api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, contact, username, finalPassword })
    });

    const data = await res.json();
    if (data.success) {
      window.location.href = '/login.html';
    }
    else {
      alert(data.error);
    }

    console.log(fullName, contact, username, finalPassword);

  });
}

if (formLogin) {

  formLogin.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = formLogin.username.value;
    const password = formLogin.password.value;

    const res = await fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
      window.location.href = 'index.html';
    } else {
      alert(data.error);
    }
  });


}
