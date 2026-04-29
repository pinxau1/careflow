const grid = document.getElementById('display-grid');
const updated = document.getElementById('display-updated');

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderDepartment(dept) {
  const serving = dept.serving || [];
  const upNext = dept.up_next || [];
  const firstServing = serving[0];

  const servingHtml = firstServing
    ? `
      <div class="display-ticket">${escHtml(firstServing.code)}</div>
      <div class="display-counter">${escHtml(firstServing.counter_name || 'Counter pending')}</div>
      <div class="display-patient">${escHtml(firstServing.full_name || 'Patient')}</div>
      <div class="display-time">${firstServing.called_at ? 'Called ' + formatTime(firstServing.called_at) : ''}</div>
    `
    : `
      <div class="display-ticket muted">---</div>
      <div class="display-counter">No active call</div>
      <div class="display-patient">Waiting for next patient</div>
    `;

  const upNextHtml = upNext.length
    ? upNext.map(item => `
      <div class="display-next-item">
        <span>${escHtml(item.code)}</span>
        <small>${escHtml(item.full_name || 'Patient')}</small>
      </div>
    `).join('')
    : `<div class="display-next-empty">No waiting patients</div>`;

  return `
    <article class="display-card">
      <div class="display-card-head">
        <div class="display-department">${escHtml(dept.name)}</div>
        <div class="display-status ${escHtml(dept.queue_status)}">${escHtml(dept.queue_status)}</div>
      </div>
      <div class="display-serving">
        ${servingHtml}
      </div>
      <div class="display-next">
        <div class="display-next-title">Up Next</div>
        ${upNextHtml}
      </div>
    </article>
  `;
}

async function loadDisplay() {
  try {
    const res = await fetch('/api/display/now-serving', { credentials: 'include' });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load display');
    }

    const departments = data.departments || [];

    grid.innerHTML = departments.length
      ? departments.map(renderDepartment).join('')
      : `<div class="empty-state">No departments configured.</div>`;

    updated.textContent = 'Updated ' + new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="empty-state">Unable to load display.</div>`;
    updated.textContent = 'Refresh failed';
  }
}

loadDisplay();
setInterval(loadDisplay, 10000);
