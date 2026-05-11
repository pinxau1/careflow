const state = {
  doctor: null,
  assignedDepartment: null,
  departments: [],
  subdepartments: [],
  currentQueue: null,
  completedQueue: null,
  busy: {
    refresh: false,
    callNext: false,
    markDone: false,
    transfer: false
  }
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

function setButtonBusy(selector, isBusy, busyText) {
  const button = $(selector);
  if (!button) return;

  if (isBusy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }

  button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

function patientLabel(queue) {
  return queue ? (queue.full_name || 'Patient') : 'No active patient';
}

function normalizeDepartment(dept) {
  return {
    ...dept,
    department_id: Number(dept.department_id ?? dept.departmentId ?? dept.id),
    name: dept.name || dept.department_name || 'Department',
    code: dept.code || '',
    queue_status: dept.queue_status || dept.queueStatus || 'open'
  };
}

function normalizeSubdepartment(subdepartment) {
  return {
    ...subdepartment,
    subdepartment_id: Number(subdepartment.subdepartment_id ?? subdepartment.subdepartmentId ?? subdepartment.id),
    department_id: Number(subdepartment.department_id ?? subdepartment.departmentId),
    name: subdepartment.name || subdepartment.subdepartment_name || 'Subdepartment',
    status: subdepartment.status || 'open',
    current_queue_id: subdepartment.current_queue_id ?? subdepartment.currentQueueId ?? null
  };
}

function selectedTargetDepartment() {
  const targetId = Number($('#target-department').value);
  return state.departments.find(dept => Number(dept.department_id) === targetId) || null;
}

function targetSubdepartments() {
  const targetId = Number($('#target-department').value);
  return state.subdepartments.filter(subdepartment => Number(subdepartment.department_id) === targetId);
}

function selectedSubdepartmentIds() {
  return [...document.querySelectorAll('#subdepartment-options input:checked')]
    .map(input => Number(input.value))
    .filter(Boolean);
}

function updateActionStates() {
  const hasTransferSource = !!(state.currentQueue || state.completedQueue);
  const targetDepartment = selectedTargetDepartment();
  const subdepartments = targetSubdepartments();
  const needsSubdepartmentSelection = subdepartments.length > 0 && selectedSubdepartmentIds().length === 0;

  $('#call-next').disabled = state.busy.callNext || state.busy.refresh;
  $('#mark-done').disabled = !state.currentQueue || state.busy.markDone || state.busy.refresh;
  $('#refresh-queue').disabled = state.busy.refresh;
  $('#transfer-patient').disabled = !hasTransferSource
    || !targetDepartment
    || targetDepartment.queue_status !== 'open'
    || needsSubdepartmentSelection
    || state.busy.transfer
    || state.busy.refresh;
}

function renderNowServing() {
  const queue = state.currentQueue;
  $('#now-code').textContent = queue ? queue.code : '--';
  $('#now-name').textContent = patientLabel(queue);
  $('#now-meta').textContent = queue
    ? [queue.category, queue.subdepartment_name || queue.counter_name].filter(Boolean).join(' / ')
    : 'Call the next patient from your department queue.';
  updateActionStates();
}

function renderDepartments() {
  const select = $('#target-department');
  const assignedDepartmentId = Number(state.assignedDepartment && state.assignedDepartment.department_id);
  const options = state.departments
    .filter(dept => Number(dept.department_id) !== assignedDepartmentId)
    .map(dept => `
      <option value="${dept.department_id}" ${dept.queue_status !== 'open' ? 'disabled' : ''}>
        ${escapeHtml(dept.name)}${dept.queue_status !== 'open' ? ` (${escapeHtml(dept.queue_status)})` : ''}
      </option>
    `)
    .join('');

  select.innerHTML = options || '<option value="">No available departments</option>';
  const firstOpenOption = [...select.options].find(option => !option.disabled && option.value);
  if (firstOpenOption) select.value = firstOpenOption.value;
  renderSubdepartments();
}

function renderSubdepartments() {
  const targetDepartment = selectedTargetDepartment();
  const subdepartments = targetSubdepartments();
  const box = $('#subdepartment-options');

  if (!targetDepartment) {
    box.innerHTML = '<p class="muted">Select a target department.</p>';
    updateActionStates();
    return;
  }

  if (!subdepartments.length) {
    box.innerHTML = '<p class="muted">No subdepartments configured for this department.</p>';
    updateActionStates();
    return;
  }

  box.innerHTML = subdepartments.map(subdepartment => `
    <label class="check-row ${subdepartment.status !== 'open' ? 'disabled' : ''}">
      <input
        type="checkbox"
        value="${subdepartment.subdepartment_id}"
        ${subdepartment.status !== 'open' ? 'disabled' : ''}
      >
      <span>${escapeHtml(subdepartment.name)}</span>
      <em>${escapeHtml(subdepartment.status)}</em>
    </label>
  `).join('');

  box.querySelectorAll('input').forEach(input => input.addEventListener('change', updateActionStates));
  updateActionStates();
}

function renderQueue(queues) {
  const list = $('#doctor-queue');
  if (!queues.length) {
    list.innerHTML = '<p class="muted">No active queue entries.</p>';
    return;
  }

  list.innerHTML = queues.map(queue => `
    <article class="queue-item ${queue.status === 'serving' ? 'serving' : ''}">
      <div class="item-code">${escapeHtml(queue.code)}</div>
      <div>
        <div class="item-name">${escapeHtml(patientLabel(queue))}</div>
        <div class="item-meta">${escapeHtml([queue.category, queue.subdepartment_name || queue.counter_name].filter(Boolean).join(' / ') || 'General')}</div>
      </div>
      <div class="badge">${escapeHtml(queue.status)}</div>
    </article>
  `).join('');
}

async function refreshQueue() {
  if (state.busy.refresh) return;
  state.busy.refresh = true;
  setButtonBusy('#refresh-queue', true, 'Refreshing');
  updateActionStates();

  try {
    const data = await requestJson('/api/doctor/queue');
    const queues = data.queues || [];
    const serving = queues.find(queue => queue.status === 'serving') || null;
    state.currentQueue = serving;
    if (serving) state.completedQueue = null;
    renderNowServing();
    renderQueue(queues);
  } finally {
    state.busy.refresh = false;
    setButtonBusy('#refresh-queue', false);
    updateActionStates();
  }
}

async function bootstrap() {
  const data = await requestJson('/api/doctor/bootstrap');
  state.doctor = data.doctor;
  state.assignedDepartment = normalizeDepartment(data.assigned_department || {});
  state.departments = (data.departments || []).map(normalizeDepartment).filter(dept => dept.department_id);
  state.subdepartments = (data.subdepartments || []).map(normalizeSubdepartment).filter(subdepartment => {
    return subdepartment.subdepartment_id && subdepartment.department_id;
  });

  $('#doctor-name').textContent = data.doctor.full_name || data.doctor.username || 'Doctor';
  $('#doctor-department').textContent = state.assignedDepartment.name;
  renderDepartments();
  await refreshQueue();
}

async function callNext() {
  if (state.busy.callNext) return;
  state.busy.callNext = true;
  setButtonBusy('#call-next', true, 'Calling');
  updateActionStates();

  try {
    const data = await requestJson('/api/doctor/next', { method: 'POST', body: '{}' });
    state.currentQueue = data.next && data.next.status !== 'done' ? data.next : null;
    state.completedQueue = null;
    renderNowServing();
    await refreshQueue();
    toast(data.message || (data.next ? `Now serving ${data.next.code}` : 'No waiting patients.'));
  } finally {
    state.busy.callNext = false;
    setButtonBusy('#call-next', false);
    updateActionStates();
  }
}

async function markDone() {
  if (!state.currentQueue || state.busy.markDone) return;
  state.busy.markDone = true;
  setButtonBusy('#mark-done', true, 'Finishing');
  updateActionStates();

  try {
    const data = await requestJson('/api/doctor/done', {
      method: 'POST',
      body: JSON.stringify({ queue_id: state.currentQueue.queue_id })
    });
    state.completedQueue = data.completed_queue;
    state.currentQueue = null;
    renderNowServing();
    await refreshQueue();
    toast(`${state.completedQueue.code} marked done`);
  } finally {
    state.busy.markDone = false;
    setButtonBusy('#mark-done', false);
    updateActionStates();
  }
}

async function transferPatient() {
  const transferSource = state.currentQueue || state.completedQueue;
  if (!transferSource || state.busy.transfer) return;

  const targetDepartment = selectedTargetDepartment();
  if (!targetDepartment) {
    toast('Select a target department.');
    return;
  }

  const subdepartments = targetSubdepartments();
  const subdepartmentIds = selectedSubdepartmentIds();
  if (subdepartments.length && !subdepartmentIds.length) {
    toast('Select at least one subdepartment.');
    return;
  }

  state.busy.transfer = true;
  setButtonBusy('#transfer-patient', true, 'Transferring');
  updateActionStates();

  try {
    const data = await requestJson('/api/doctor/transfer', {
      method: 'POST',
      body: JSON.stringify({
        queue_id: transferSource.queue_id,
        target_department_id: Number(targetDepartment.department_id),
        subdepartment_ids: subdepartmentIds,
        reason: $('#transfer-notes').value
      })
    });
    state.currentQueue = null;
    state.completedQueue = null;
    $('#transfer-notes').value = '';
    renderSubdepartments();
    renderNowServing();
    await refreshQueue();
    toast(data.message || (data.queue ? `Transferred as ${data.queue.code}` : 'Patient transferred'));
  } finally {
    state.busy.transfer = false;
    setButtonBusy('#transfer-patient', false);
    updateActionStates();
  }
}

$('#target-department').addEventListener('change', renderSubdepartments);
$('#refresh-queue').addEventListener('click', () => refreshQueue().catch(err => toast(err.message)));
$('#call-next').addEventListener('click', () => callNext().catch(err => toast(err.message)));
$('#mark-done').addEventListener('click', () => markDone().catch(err => toast(err.message)));
$('#transfer-patient').addEventListener('click', () => transferPatient().catch(err => toast(err.message)));

bootstrap().catch(err => toast(err.message));
