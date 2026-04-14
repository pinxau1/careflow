let DEPT_ID = null;
let current = null;
let queue = [];
let clinicOpen = true;

const AVG_SERVICE_MINS = 5;

async function init() {
  const res = await fetch('/api/admin/status', { credentials: 'include' });
  const data = await res.json();
  DEPT_ID = data.department_id ?? 1;

  if (data.queued) {
    current = {
      queue_id: data.queue_id,
      code: data.code,
      full_name: data.full_name,
      category: data.category
    };
  }

  await refreshQueue();
  render();
}


async function refreshQueue() {
  const res = await fetch(`/api/admin/${DEPT_ID}`, { credentials: 'include' });
  queue = await res.json();
}

async function addToQueue() {
  if (!clinicOpen) { showToast('Clinic is closed — no new entries allowed'); return; }

  const nameEl = document.getElementById('inp-name');
  const serviceEl = document.getElementById('inp-service');
  const concernEl = document.getElementById('concern');
  const name = nameEl.value.trim();

  if (!name) { showToast('Please enter a name'); nameEl.focus(); return; }

  const res = await fetch('/api/queue/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      patientName: name,
      serviceType: serviceEl.value,
      concern: concernEl.value.trim()
    })
  });
  const data = await res.json();

  if (!data.success) { showToast('Error: ' + data.error); return; }

  nameEl.value = '';
  concernEl.value = '';
  showToast(`${data.code} added to queue`);
  await refreshQueue();
  render();
}

async function callNext() {
  const res = await fetch('/api/admin/next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ department_id: DEPT_ID })
  });
  const data = await res.json();

  current = data.next ?? null;
  showToast(current ? `Now serving ${current.code}` : 'Queue is empty');
  await refreshQueue();
  render();
}

async function markServed() {
  if (!current) return;

  await fetch('/api/admin/served', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ department_id: DEPT_ID })
  });

  showToast(`${current.code} marked as served`);
  current = null;
  await refreshQueue();
  render();
}

function skipTicket(queue_id, btn) {
  btn.closest('li').remove();
}

function deleteTicket(queue_id, btn) {
  btn.closest('li').remove();
}

// async function skipTicket(queue_id) {
//   await fetch(`/api/admin/skip/${queue_id}`, {
//     method: 'PATCH',
//     credentials: 'include'
//   });
//   showToast('Ticket skipped');
//   await refreshQueue();
//   render();
// }
//
// async function deleteTicket(queue_id) {
//   await fetch(`/api/admin/delete/${queue_id}`, {
//     method: 'DELETE',
//     credentials: 'include'
//   });
//   showToast('Ticket deleted');
//   await refreshQueue();
//   render();
// }

async function clearAll() {
  if (!confirm('Clear entire waiting queue?')) return;

  await fetch('/api/admin/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ department_id: DEPT_ID })
  });

  current = null;
  queue = [];
  showToast('Queue cleared');
  render();
}

function toggleClinicStatus() {
  clinicOpen = !clinicOpen;
  renderClinicStatus();
  showToast(`Clinic is now ${clinicOpen ? 'open' : 'closed'}`);
}

function render() {
  renderServing();
  renderQueue();
  renderStats();
  renderClinicStatus();
  document.getElementById('session-date').textContent =
    new Date().toLocaleDateString([], {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
}

function renderServing() {
  const ticketEl = document.getElementById('now-ticket');
  const nameEl = document.getElementById('now-name');
  const serviceEl = document.getElementById('now-service');
  const nextBtn = document.getElementById('btn-next');
  const servedBtn = document.getElementById('btn-served');
  const labelEl = document.querySelector('.serving-label');

  ticketEl.classList.remove('general', 'support', 'priority', 'complaint');

  if (current) {
    ticketEl.textContent = current.code;
    ticketEl.classList.remove('empty');
    nameEl.textContent = current.full_name;
    nameEl.style.opacity = '1';
    serviceEl.textContent = capitalize(current.category ?? '');
    if (labelEl) labelEl.textContent = 'Now serving';
    if (servedBtn) servedBtn.disabled = false;
  } else {
    ticketEl.textContent = '---';
    ticketEl.classList.add('empty');
    nameEl.textContent = 'Not yet joined';
    nameEl.style.opacity = '0.3';
    serviceEl.textContent = '';
    if (labelEl) labelEl.textContent = 'No one is being served';
    if (servedBtn) servedBtn.disabled = true;
  }

  if (nextBtn) {
    nextBtn.disabled = queue.length === 0 && !current;
    nextBtn.textContent = current ? 'Skip — Call Next' : 'Call Next';
  }
}

async function renderQueue() {
  const list = document.getElementById('queue-list');
  list.innerHTML = '';


  if (queue.length === 0) {
    list.innerHTML = `
      <li class="empty-state">
        <div class="empty-icon">◻</div>
        <p>Queue is empty. Add someone above.</p>
      </li>`;
    return;
  }

  queue.forEach((entry, i) => {
    const li = document.createElement('li');
    li.className = 'queue-item';
    li.innerHTML = `
      <div class="ticket-badge">${escHtml(entry.code)}</div>
      <div class="item-info">
        <div class="item-name">${escHtml(entry.full_name)}</div>
        <div class="item-meta">Position ${i + 1}</div>
      </div>
      <span class="service-pill">${escHtml(entry.category ?? '')}</span>
      <button class="btn-serve-now" onclick="skipTicket(${entry.queue_id}, this)">Skip</button>
      <button class="btn-remove"   onclick="deleteTicket(${entry.queue_id}, this)">&#x2715;</button>
    `;
    list.appendChild(li);
  });
}

function renderStats() {
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('stat-in-queue', queue.length);
  const mins = queue.length * AVG_SERVICE_MINS;
  setEl('stat-est-wait', mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm');
}

function renderClinicStatus() {
  const dot = document.getElementById('clinic-status-dot');
  const text = document.getElementById('clinic-status-text');
  const btn = document.getElementById('status-toggle-btn');
  const addCard = document.querySelector('.add-card');

  if (clinicOpen) {
    dot.style.background = 'var(--green)';
    text.textContent = 'Open';
    btn.textContent = 'Set to Closed';
    btn.className = 'status-toggle-btn status-toggle--open';
    addCard.classList.remove('is-closed');
  } else {
    dot.style.background = '#b32626';
    text.textContent = 'Closed';
    btn.textContent = 'Set to Open';
    btn.className = 'status-toggle-btn status-toggle--closed';
    addCard.classList.add('is-closed');
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 2400);
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

setInterval(async () => { await refreshQueue(); render(); }, 15000);

document.getElementById('btn-logout').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login.html';
});

init();
