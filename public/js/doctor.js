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
    transfer: false,
    subdepartments: false,
    transferSuggest: false
  },
  subdepartmentLoadError: '',
  checklistSuggestionKey: '',
  checklistNoteTimer: null
};

const CHECKLIST_ITEMS = [
  'concern_reviewed',
  'vitals_reviewed',
  'symptoms_reviewed',
  'history_reviewed',
  'physical_exam_completed',
  'initial_impression_documented',
  'patient_advised'
];

const $ = selector => document.querySelector(selector);

function wireLogoutButton() {
  const logout = $('#btn-logout');
  if (!logout || logout.dataset.bound === '1') return;
  logout.dataset.bound = '1';
  logout.addEventListener('click', async () => {
    await fetch('/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login';
  });
}

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
    room_number: subdepartment.room_number || subdepartment.roomNumber || '',
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

function cacheDepartmentSubdepartments(departmentId, subdepartments) {
  const targetId = Number(departmentId);
  const normalized = (subdepartments || []).map(normalizeSubdepartment).filter(subdepartment => {
    return subdepartment.subdepartment_id && Number(subdepartment.department_id) === targetId;
  });

  state.subdepartments = state.subdepartments
    .filter(subdepartment => Number(subdepartment.department_id) !== targetId)
    .concat(normalized);

  return normalized;
}

async function loadTargetSubdepartments() {
  const targetDepartment = selectedTargetDepartment();
  if (!targetDepartment) return [];

  const data = await requestJson(`/api/departments/${targetDepartment.department_id}/subdepartments`);
  return cacheDepartmentSubdepartments(targetDepartment.department_id, data.subdepartments || []);
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
    || state.busy.subdepartments
    || state.busy.transferSuggest
    || !!state.subdepartmentLoadError
    || state.busy.transfer
    || state.busy.refresh;
}

function renderNowServing() {
  const queue = state.currentQueue;
  const destination = queue && queue.subdepartment_name
    ? `${queue.subdepartment_name}${queue.subdepartment_room_number ? ' · Room ' + queue.subdepartment_room_number : ''}`
    : queue && queue.counter_name;
  $('#now-code').textContent = queue ? queue.code : '--';
  $('#now-name').textContent = patientLabel(queue);
  $('#now-meta').textContent = queue
    ? [queue.category, destination].filter(Boolean).join(' / ')
    : 'Call the next patient from your department queue.';
  $('#patient-note').textContent = queue && queue.visit_description
    ? queue.visit_description
    : 'No patient note available.';
  renderChecklist();
  updateActionStates();
}

function checklistInputs() {
  return [...document.querySelectorAll('#doctor-checklist input[type="checkbox"]')];
}

function getChecklistValues() {
  return checklistInputs().reduce((acc, input) => {
    acc[input.value] = input.checked;
    return acc;
  }, {});
}

function setAiStatus(message, mode = '') {
  const status = $('#checklist-ai-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('ready', mode === 'ready');
  status.classList.toggle('error', mode === 'error');
}

function resetChecklist() {
  checklistInputs().forEach(input => {
    input.checked = false;
    input.disabled = !state.currentQueue;
  });
  const note = $('#doctor-checkup-note');
  if (note) {
    note.value = '';
    note.disabled = !state.currentQueue;
  }
  state.checklistSuggestionKey = '';
  setAiStatus(state.currentQueue ? 'Complete checklist for AI suggestion' : 'Waiting for active patient');
}

function renderChecklist() {
  const active = Boolean(state.currentQueue);
  checklistInputs().forEach(input => {
    input.disabled = !active || state.busy.transferSuggest;
  });
  const note = $('#doctor-checkup-note');
  if (note) note.disabled = !active || state.busy.transferSuggest;

  if (!active) {
    setAiStatus('Waiting for active patient');
  } else if (!isChecklistComplete()) {
    setAiStatus('Complete checklist for AI suggestion');
  }
}

function isChecklistComplete() {
  const values = getChecklistValues();
  return CHECKLIST_ITEMS.every(item => values[item]);
}

async function applyTransferSuggestion(suggestion) {
  if (!suggestion || !suggestion.target_department_id) return false;

  const select = $('#target-department');
  const option = [...select.options].find(opt => Number(opt.value) === Number(suggestion.target_department_id) && !opt.disabled);
  if (!option) return false;

  select.value = option.value;
  await refreshTargetSubdepartments();

  const suggestedIds = new Set((suggestion.subdepartment_ids || []).map(Number));
  document.querySelectorAll('#subdepartment-options input[type="checkbox"]').forEach(input => {
    input.checked = suggestedIds.has(Number(input.value));
  });

  const notes = $('#transfer-notes');
  if (notes && suggestion.reason) {
    const doctorNote = $('#doctor-checkup-note') ? $('#doctor-checkup-note').value.trim() : '';
    notes.value = [
      `AI routing suggestion: ${suggestion.reason}`,
      doctorNote ? `Doctor note: ${doctorNote}` : ''
    ].filter(Boolean).join('\n\n');
  }

  updateActionStates();
  return true;
}

async function maybeSuggestTransfer() {
  if (!state.currentQueue || state.busy.transferSuggest || !isChecklistComplete()) return;

  const doctorNote = $('#doctor-checkup-note') ? $('#doctor-checkup-note').value.trim() : '';
  const suggestionKey = [
    state.currentQueue.queue_id,
    CHECKLIST_ITEMS.map(item => `${item}:${getChecklistValues()[item] ? 1 : 0}`).join(','),
    doctorNote
  ].join('|');

  if (state.checklistSuggestionKey === suggestionKey) return;

  state.checklistSuggestionKey = suggestionKey;
  state.busy.transferSuggest = true;
  setAiStatus('Getting AI suggestion...');
  renderChecklist();
  updateActionStates();

  try {
    const data = await requestJson('/api/doctor/transfer-suggest', {
      method: 'POST',
      body: JSON.stringify({
        queue_id: state.currentQueue.queue_id,
        checklist: getChecklistValues(),
        doctor_note: doctorNote
      })
    });

    const applied = await applyTransferSuggestion(data.suggestion);
    setAiStatus(applied ? 'Suggestion applied, review before transfer' : 'No clear suggestion', applied ? 'ready' : 'error');
    toast(data.message || (applied ? 'AI suggestion applied' : 'No clear AI suggestion'));
  } catch (err) {
    console.error(err);
    state.checklistSuggestionKey = '';
    setAiStatus('AI suggestion unavailable', 'error');
    toast(err.message || 'AI suggestion unavailable');
  } finally {
    state.busy.transferSuggest = false;
    renderChecklist();
    updateActionStates();
  }
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
  refreshTargetSubdepartments().catch(err => toast(err.message));
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

  if (state.busy.subdepartments) {
    box.innerHTML = '<p class="muted">Loading subdepartments...</p>';
    updateActionStates();
    return;
  }

  if (state.subdepartmentLoadError) {
    box.innerHTML = `<p class="muted">${escapeHtml(state.subdepartmentLoadError)}</p>`;
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
      <span>${escapeHtml(subdepartment.name)}${subdepartment.room_number ? ` · Room ${escapeHtml(subdepartment.room_number)}` : ''}</span>
      <em>${escapeHtml(subdepartment.status)}</em>
    </label>
  `).join('');

  box.querySelectorAll('input').forEach(input => input.addEventListener('change', updateActionStates));
  updateActionStates();
}

async function refreshTargetSubdepartments() {
  const box = $('#subdepartment-options');
  const targetDepartment = selectedTargetDepartment();
  state.subdepartmentLoadError = '';

  if (!targetDepartment) {
    renderSubdepartments();
    return;
  }

  state.busy.subdepartments = true;
  if (box) box.innerHTML = '<p class="muted">Loading subdepartments...</p>';
  updateActionStates();

  try {
    await loadTargetSubdepartments();
  } catch (err) {
    console.error(err);
    state.subdepartmentLoadError = err.message || 'Failed to load subdepartments.';
    toast(state.subdepartmentLoadError);
  } finally {
    state.busy.subdepartments = false;
    renderSubdepartments();
  }
}

function renderQueue(queues) {
  const list = $('#doctor-queue');
  const waitingQueues = (queues || []).filter(queue => queue.status === 'waiting');
  const waitingCount = $('#waiting-count');

  if (waitingCount) {
    waitingCount.textContent = `${waitingQueues.length} waiting`;
  }

  if (!waitingQueues.length) {
    list.innerHTML = '<p class="muted">No active queue entries.</p>';
    return;
  }

  list.innerHTML = waitingQueues.map(queue => `
    <article class="queue-item ${queue.status === 'serving' ? 'serving' : ''}">
      <div class="item-code">${escapeHtml(queue.code)}</div>
      <div>
        <div class="item-name">${escapeHtml(patientLabel(queue))}</div>
        <div class="item-meta">${escapeHtml([
          queue.category,
          queue.subdepartment_name
            ? `${queue.subdepartment_name}${queue.subdepartment_room_number ? ' · Room ' + queue.subdepartment_room_number : ''}`
            : queue.counter_name
        ].filter(Boolean).join(' / ') || 'General')}</div>
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
    const previousQueueId = state.currentQueue ? Number(state.currentQueue.queue_id) : null;
    state.currentQueue = serving;
    if (serving) state.completedQueue = null;
    if ((serving ? Number(serving.queue_id) : null) !== previousQueueId) {
      resetChecklist();
    }
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
  wireLogoutButton();
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
    const previousQueueId = state.currentQueue ? Number(state.currentQueue.queue_id) : null;
    state.currentQueue = data.next && data.next.status !== 'done' ? data.next : null;
    state.completedQueue = null;
    if ((state.currentQueue ? Number(state.currentQueue.queue_id) : null) !== previousQueueId) {
      resetChecklist();
    }
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
    resetChecklist();
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
    resetChecklist();
    $('#transfer-notes').value = '';
    await refreshTargetSubdepartments();
    renderNowServing();
    await refreshQueue();
    toast(data.message || (data.queue ? `Transferred as ${data.queue.code}` : 'Patient transferred'));
  } finally {
    state.busy.transfer = false;
    setButtonBusy('#transfer-patient', false);
    updateActionStates();
  }
}

$('#target-department').addEventListener('change', () => refreshTargetSubdepartments().catch(err => toast(err.message)));
$('#refresh-queue').addEventListener('click', () => refreshQueue().catch(err => toast(err.message)));
$('#call-next').addEventListener('click', () => callNext().catch(err => toast(err.message)));
$('#mark-done').addEventListener('click', () => markDone().catch(err => toast(err.message)));
$('#transfer-patient').addEventListener('click', () => transferPatient().catch(err => toast(err.message)));
checklistInputs().forEach(input => input.addEventListener('change', () => {
  renderChecklist();
  maybeSuggestTransfer().catch(err => toast(err.message));
}));
$('#doctor-checkup-note').addEventListener('input', () => {
  if (isChecklistComplete()) {
    state.checklistSuggestionKey = '';
    setAiStatus('Checklist changed, getting updated suggestion...');
    clearTimeout(state.checklistNoteTimer);
    state.checklistNoteTimer = setTimeout(() => {
      maybeSuggestTransfer().catch(err => toast(err.message));
    }, 700);
  }
});

bootstrap().catch(err => toast(err.message));
