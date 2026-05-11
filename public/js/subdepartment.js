const subdepartmentState = {
  subdepartment: null,
  currentQueue: null,
  busy: false
};

const $ = selector => document.querySelector(selector);

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 2800);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.message || data.error || 'Request failed');
  }
  return data;
}

function subdepartmentId() {
  return Number(new URLSearchParams(window.location.search).get('subdepartment_id'));
}

function patientLabel(queue) {
  return queue ? (queue.full_name || 'Patient') : 'No active patient';
}

function renderNowServing() {
  const queue = subdepartmentState.currentQueue;
  $('#now-code').textContent = queue ? queue.code : '--';
  $('#now-name').textContent = patientLabel(queue);
  $('#now-meta').textContent = queue ? queue.category : 'Call the next patient for this subdepartment.';
  $('#mark-done').disabled = !queue || subdepartmentState.busy;
  $('#skip-patient').disabled = !queue || subdepartmentState.busy;
  $('#call-next').disabled = subdepartmentState.busy;
  $('#refresh-queue').disabled = subdepartmentState.busy;
}

function renderQueue(queues) {
  const list = $('#subdepartment-queue');
  if (!queues.length) {
    list.innerHTML = '<p class="muted">No active queue entries.</p>';
    return;
  }

  list.innerHTML = queues.map(queue => `
    <article class="queue-item ${queue.status === 'serving' ? 'serving' : ''}">
      <div class="item-code">${escapeHtml(queue.code)}</div>
      <div>
        <div class="item-name">${escapeHtml(patientLabel(queue))}</div>
        <div class="item-meta">${escapeHtml(queue.category || 'General')}</div>
      </div>
      <div class="badge">${escapeHtml(queue.status)}</div>
    </article>
  `).join('');
}

async function refreshQueue() {
  const id = subdepartmentId();
  if (!id) throw new Error('Missing subdepartment_id');

  const data = await requestJson(`/api/subdepartments/${id}/queue`);
  subdepartmentState.subdepartment = data.subdepartment;
  subdepartmentState.currentQueue = data.queues.find(queue => queue.status === 'serving') || null;

  $('#subdepartment-name').textContent = data.subdepartment.name;
  $('#subdepartment-department').textContent = data.subdepartment.department_name;
  renderNowServing();
  renderQueue(data.queues);
}

async function callNext() {
  if (subdepartmentState.busy) return;
  subdepartmentState.busy = true;
  renderNowServing();
  try {
    const data = await requestJson(`/api/subdepartments/${subdepartmentId()}/next`, { method: 'POST', body: '{}' });
    subdepartmentState.currentQueue = data.next || null;
    renderNowServing();
    await refreshQueue();
    toast(data.message || (data.next ? `Now serving ${data.next.code}` : 'No waiting patients.'));
  } finally {
    subdepartmentState.busy = false;
    renderNowServing();
  }
}

async function markDone() {
  if (!subdepartmentState.currentQueue || subdepartmentState.busy) return;
  subdepartmentState.busy = true;
  renderNowServing();
  try {
    const data = await requestJson(`/api/subdepartments/${subdepartmentId()}/done`, {
      method: 'POST',
      body: JSON.stringify({ queue_id: subdepartmentState.currentQueue.queue_id })
    });
    subdepartmentState.currentQueue = null;
    renderNowServing();
    await refreshQueue();
    toast(data.advanced_queue
      ? `${data.completed_queue.code} done. Queued ${data.advanced_queue.subdepartment_name}.`
      : `${data.completed_queue.code} marked done`);
  } finally {
    subdepartmentState.busy = false;
    renderNowServing();
  }
}

async function skipPatient() {
  if (!subdepartmentState.currentQueue || subdepartmentState.busy) return;
  subdepartmentState.busy = true;
  renderNowServing();
  try {
    const queueId = subdepartmentState.currentQueue.queue_id;
    const data = await requestJson(`/api/subdepartments/${subdepartmentId()}/skip/${queueId}`, { method: 'PATCH' });
    subdepartmentState.currentQueue = null;
    renderNowServing();
    await refreshQueue();
    toast(`${data.skipped_queue.code} skipped`);
  } finally {
    subdepartmentState.busy = false;
    renderNowServing();
  }
}

$('#refresh-queue').addEventListener('click', () => refreshQueue().catch(err => toast(err.message)));
$('#call-next').addEventListener('click', () => callNext().catch(err => toast(err.message)));
$('#mark-done').addEventListener('click', () => markDone().catch(err => toast(err.message)));
$('#skip-patient').addEventListener('click', () => skipPatient().catch(err => toast(err.message)));

refreshQueue().catch(err => toast(err.message));
