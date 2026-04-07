let formSignup = document.getElementById('signup-card');


formSignup.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = form.email.value;
  const password = form.password.value;

  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();
  if (data.success) {
    window.location.href = '/login';
  }
  else {
    alert(data.error);
  }
  console.log(email, password);
});
