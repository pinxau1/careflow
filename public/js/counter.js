const counterState = {
  counter: null,
  currentQueue: null
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

function counterId() {
  return Number(new URLSearchParams(window.location.search).get('counter_id'));
}

function patientLabel(queue) {
  return queue ? (queue.full_name || 'Patient') : 'No active patient';
}

function renderNowServing() {
  const queue = counterState.currentQueue;
  $('#now-code').textContent = queue ? queue.code : '--';
  $('#now-name').textContent = patientLabel(queue);
  $('#now-meta').textContent = queue ? queue.category : 'Call the next patient for this counter.';
  $('#mark-done').disabled = !queue;
  $('#skip-patient').disabled = !queue;
}

function renderQueue(queues) {
  const list = $('#counter-queue');
  const waitingQueues = (queues || []).filter(queue => queue.status === 'waiting');

  if (!waitingQueues.length) {
    list.innerHTML = '<p class="muted">No active queue entries.</p>';
    return;
  }

  list.innerHTML = waitingQueues.map(queue => `
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

function wireLogoutButton() {
  const logout = document.getElementById('btn-logout');
  if (!logout || logout.dataset.bound === '1') return;
  logout.dataset.bound = '1';
  logout.addEventListener('click', async () => {
    await fetch('/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login';
  });
}

async function refreshQueue() {
  const id = counterId();
  if (!id) throw new Error('Missing counter_id');

  const data = await requestJson(`/api/counters/${id}/queue`);
  counterState.counter = data.counter;
  counterState.currentQueue = data.queues.find(queue => queue.status === 'serving') || null;

  $('#counter-name').textContent = data.counter.name;
  $('#counter-department').textContent = data.counter.department_name;
  wireLogoutButton();
  renderNowServing();
  renderQueue(data.queues);
}

async function callNext() {
  const data = await requestJson(`/api/counters/${counterId()}/next`, { method: 'POST', body: '{}' });
  counterState.currentQueue = data.next || null;
  renderNowServing();
  await refreshQueue();
  toast(data.next ? `Now serving ${data.next.code}` : data.message);
}

async function markDone() {
  if (!counterState.currentQueue) return;
  const data = await requestJson(`/api/counters/${counterId()}/done`, {
    method: 'POST',
    body: JSON.stringify({ queue_id: counterState.currentQueue.queue_id })
  });
  counterState.currentQueue = null;
  renderNowServing();
  await refreshQueue();
  toast(`${data.completed_queue.code} marked done`);
}

async function skipPatient() {
  if (!counterState.currentQueue) return;
  const queueId = counterState.currentQueue.queue_id;
  const data = await requestJson(`/api/counters/${counterId()}/skip/${queueId}`, { method: 'PATCH' });
  counterState.currentQueue = null;
  renderNowServing();
  await refreshQueue();
  toast(`${data.skipped_queue.code} skipped`);
}

$('#refresh-queue').addEventListener('click', () => refreshQueue().catch(err => toast(err.message)));
$('#call-next').addEventListener('click', () => callNext().catch(err => toast(err.message)));
$('#mark-done').addEventListener('click', () => markDone().catch(err => toast(err.message)));
$('#skip-patient').addEventListener('click', () => skipPatient().catch(err => toast(err.message)));

refreshQueue().catch(err => toast(err.message));
