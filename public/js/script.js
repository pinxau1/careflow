// ─────────────────────────────────────────────
//  CAREFLOW — ADMIN DASHBOARD SCRIPT
//  Covers the refactored CareFlow UI (index.html)
//  and preserves all original API/backend logic.
// ─────────────────────────────────────────────

// ─── GUARD: only run dashboard logic on the admin page ───
const indexFlow  = document.getElementById('indexFlow');
const patientEl  = document.getElementById('patientFlow');
const mockAdmin  = document.getElementById('mockFlow');

// ════════════════════════════════════════════════════════
//  ADMIN DASHBOARD  (new CareFlow UI — index.html)
// ════════════════════════════════════════════════════════
// The new UI does not use an indexFlow wrapper div,
// so we detect it by the presence of #dept-grid instead.
const isDashboard = !!document.getElementById('dept-grid');

if (isDashboard) {

  // ─── STATE ───
  let departments  = [];
  let counters     = [];
  let patients     = [];
  let activeDept   = null;
  let activeFilter = 'all';
  let searchVal    = '';
  let queueOpen    = true;
  let cutoffTime   = '17:00';
  let qNum         = 42;

  let dashboardStats = {
    inQueue: 0, waiting: 0, servedToday: 0, avgWaitMin: null
  };

  // ─── HELPERS ───
  function formatTime(twentyFour) {
    if (!twentyFour || !twentyFour.includes(':')) return 'Not set';
    const [h, m] = twentyFour.split(':');
    const hour   = parseInt(h, 10);
    const hour12 = hour % 12 || 12;
    return String(hour12).padStart(2, '0') + ':' + m + ' ' + (hour >= 12 ? 'PM' : 'AM');
  }

  function getDemographicText(p) {
    return `${p.gender || 'Gender'} · ${p.age || 'Age'}`;
  }

  function getActiveDepartmentName() {
    const dept = departments.find(d => d.id === activeDept);
    return dept ? dept.name : '';
  }

  // ─── FETCH ───
  async function fetchBootstrapData() {
    const res  = await fetch('/api/admin/dashboard/bootstrap');
    if (!res.ok) throw new Error('Failed to load dashboard bootstrap data');
    const data = await res.json();

    const deptColors = ['#e8f7f2','#fef3f2','#eff6ff','#fefce8','#f0fdf4','#faf5ff','#fff1f2','#f0f4ff'];
    const deptEmojis = ['🏥','🤱','🧓','🔬','🧪','💊','❤️','🧠'];

    function inferDeptType(name) {
      const n = String(name || '').toLowerCase();
      if (n.includes('lab') || n.includes('pathology') || n.includes('radio')) return 'laboratory';
      if (n.includes('pharmacy') || n.includes('support')) return 'support';
      return 'patient-care';
    }

    departments = (data.departments || []).map((d, i) => ({
      id:    String(d.department_id),
      name:  d.name,
      type:  inferDeptType(d.name),
      queue: Number(d.queue_count || 0),
      color: deptColors[i % deptColors.length],
      emoji: deptEmojis[i % deptEmojis.length]
    }));

    counters = (data.counters || []).map(c => ({
      counterId:    Number(c.counter_id),
      departmentId: String(c.department_id),
      room:         c.name || `Counter ${c.counter_id}`,
      num:          c.current_queue_id ? String(c.current_queue_id).padStart(3, '0') : '---',
      doctor:       c.name || `Counter ${c.counter_id}`,
      spec:         'General Consultation',
      avg:          'N/A',
      available:    c.status === 'open'
    }));

    queueOpen = data.queue_status !== 'closed';
  }

  async function fetchDepartmentQueues(departmentId) {
    const res  = await fetch('/api/admin/dashboard/department/' + departmentId);
    if (!res.ok) throw new Error('Failed to load department queue data');
    const data = await res.json();
    patients = (data.queues || []).map(q => ({
      queueId:   Number(q.queue_id),
      q:         q.code || String(q.queue_id).padStart(3, '0'),
      name:      q.full_name || 'Unknown',
      gender:    q.sex || '',
      age:       q.age || '',
      priority:  q.is_emergency || q.is_priority ? 'high' : 'medium',
      status:    q.status,
      counter:   'Unassigned',
      wait:      q.status === 'serving' ? 'Serving now' : 'Waiting',
      queueType: q.category === 'priority' ? 'pwd' : 'regular',
      reason:    q.category || 'Reason for Visit'
    }));
  }

  async function fetchDepartmentStats(departmentId) {
    const res  = await fetch('/api/admin/dashboard/stats/' + departmentId);
    if (!res.ok) throw new Error('Failed to load department statistics');
    const data  = await res.json();
    const stats = data.stats || {};
    dashboardStats = {
      inQueue:    Number(stats.in_queue    || 0),
      waiting:    Number(stats.waiting     || 0),
      servedToday:Number(stats.served_today|| 0),
      avgWaitMin: stats.avg_wait_min === null ? null : Number(stats.avg_wait_min)
    };
  }

  // ─── RENDER: DEPARTMENTS ───
  function renderDepts() {
    const grid     = document.getElementById('dept-grid');
    const filtered = departments.filter(d => {
      const matchType   = activeFilter === 'all' || d.type === activeFilter;
      const matchSearch = d.name.toLowerCase().includes(searchVal.toLowerCase());
      return matchType && matchSearch;
    });
    grid.innerHTML = filtered.map(d => `
      <div class="dept-card" onclick="openDept('${d.id}','${d.name.replace(/'/g,"\\'")}')">
        <div class="dept-img" style="background:${d.color}">
          <div class="dept-img-bg">${d.emoji}</div>
        </div>
        <div class="dept-info">
          <div class="dept-name">${d.name}</div>
          <div class="dept-meta">
            <span class="dept-type ${d.type === 'laboratory' ? 'lab' : d.type === 'support' ? 'support' : ''}">${d.type.replace('-',' ')}</span>
            <span class="dept-queue">Queue: <span>${d.queue ?? 0}</span></span>
          </div>
        </div>
      </div>
    `).join('');
  }

  function filterDepts(val) { searchVal = val; renderDepts(); }

  function setFilter(f, el) {
    activeFilter = f;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    renderDepts();
  }

  // ─── RENDER: COUNTERS ───
  function renderCounters() {
    const row          = document.getElementById('counters-row');
    const deptCounters = counters.filter(c => c.departmentId === String(activeDept));
    if (!deptCounters.length) {
      row.innerHTML = `<div class="counter-card">No counters configured for this department.</div>`;
      return;
    }
    row.innerHTML = deptCounters.map((c, i) => `
      <div class="counter-card ${i === 0 ? 'active-counter' : ''}" onclick="selectCounter(${i}, this)">
        <div class="counter-room">${c.room}</div>
        <div class="counter-num">${c.num}</div>
        <div class="counter-doctor">${c.doctor}</div>
        <div class="counter-spec">${c.spec}</div>
        <div class="counter-avg">Avg ${c.avg}/patient</div>
        <div class="counter-toggle-row" onclick="event.stopPropagation()">
          <span class="counter-status ${c.available ? 'on' : 'off'}">${c.available ? 'Available' : 'On Break'}</span>
          <label class="toggle mini ${!queueOpen ? 'disabled' : ''}">
            <input type="checkbox"
              ${c.available ? 'checked' : ''}
              ${!queueOpen  ? 'disabled' : ''}
              onchange="toggleDoctorAvailability(${c.counterId}, this.checked)"
              onclick="event.stopPropagation()">
            <span class="toggle-knob"></span>
          </label>
        </div>
      </div>
    `).join('');
  }

  function selectCounter(i, el) {
    document.querySelectorAll('.counter-card').forEach(c => c.classList.remove('active-counter'));
    el.classList.add('active-counter');
  }

  // ─── RENDER: NOW SERVING ───
  function renderNowServingCard() {
    const serving = patients.find(p => p.status === 'serving') || patients.find(p => p.status === 'waiting');
    if (!serving) {
      document.getElementById('q-number').textContent = '---';
      document.getElementById('q-name').textContent   = 'No patient in queue';
      document.getElementById('q-sub').textContent    = 'Gender · Age';
      return;
    }
    document.getElementById('q-number').textContent = serving.q;
    document.getElementById('q-name').textContent   = serving.name;
    document.getElementById('q-sub').textContent    = getDemographicText(serving);
    const pc = document.getElementById('q-priority');
    pc.className   = 'priority-chip ' + serving.priority;
    pc.textContent = serving.priority.charAt(0).toUpperCase() + serving.priority.slice(1);
  }

  // ─── RENDER: NEXT LIST ───
  function renderNextList() {
    const waiting = patients.filter(p => p.status === 'waiting').slice(0, 4);
    document.getElementById('next-list').innerHTML = waiting.map(p => `
      <div class="next-item">
        <div class="next-num">${p.q}</div>
        <div>
          <div class="next-pname">${p.name}</div>
          <div class="next-psub">${getDemographicText(p)} · ${p.wait}</div>
        </div>
        <span class="priority-chip ${p.priority}" style="margin-left:auto;font-size:11px">${p.priority}</span>
      </div>
    `).join('');
  }

  // ─── RENDER: QUEUE TABLE ───
  function renderQueueRows(list) {
    if (!list.length) {
      return `<tr><td colspan="7" style="color:var(--text3);padding:16px">No patients in this queue.</td></tr>`;
    }
    return list.map(p => `
      <tr>
        <td><span class="priority-chip ${p.priority}">${p.priority}</span></td>
        <td class="td-queue">${p.q}</td>
        <td style="font-weight:500">${p.name}</td>
        <td><span class="status-badge ${p.status}">${p.status}</span></td>
        <td>${p.counter}</td>
        <td class="ai-wait"><strong>${p.wait}</strong></td>
        <td>
          <div class="action-btns">
            <button class="act-btn" onclick="callPatient('${p.q}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              Call
            </button>
            <button class="act-btn del" onclick="deletePatient(${p.queueId || 0}, '${p.q}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              Remove
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function renderTable() {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sorted = [...patients].sort((a, b) => {
      if (a.status === 'serving') return -1;
      if (b.status === 'serving') return  1;
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    const pwdPatients     = sorted.filter(p => p.queueType === 'pwd');
    const regularPatients = sorted.filter(p => p.queueType !== 'pwd');

    document.getElementById('line-count').textContent     = ` (${patients.length} patients)`;
    document.getElementById('pwd-count').textContent      = `(${pwdPatients.length})`;
    document.getElementById('regular-count').textContent  = `(${regularPatients.length})`;
    document.getElementById('pwd-queue-tbody').innerHTML      = renderQueueRows(pwdPatients);
    document.getElementById('regular-queue-tbody').innerHTML  = renderQueueRows(regularPatients);
  }

  // ─── RENDER: STATS ───
  function renderStats() {
    const queueEl    = document.getElementById('stat-queue');
    const servedEl   = document.getElementById('stat-served');
    const waitingEl  = document.getElementById('stat-waiting');
    const waitEl     = document.getElementById('stat-wait');
    const servedSubEl= document.getElementById('stat-served-sub');
    const waitSubEl  = document.getElementById('stat-wait-sub');
    if (queueEl)    queueEl.textContent   = String(dashboardStats.inQueue);
    if (servedEl)   servedEl.textContent  = String(dashboardStats.servedToday);
    if (waitingEl)  waitingEl.textContent = String(dashboardStats.waiting);
    if (waitEl)     waitEl.textContent    = dashboardStats.avgWaitMin === null ? 'N/A' : `~${Math.round(dashboardStats.avgWaitMin)} min`;
    if (servedSubEl)servedSubEl.textContent = 'From completed queues today';
    if (waitSubEl)  waitSubEl.textContent   = 'Average from called queues today';
  }

  // ─── RENDER: QUEUE CONTROLS ───
  function renderQueueControls() {
    const cutoffDisplay          = document.getElementById('queue-cutoff-display');
    const cutoffInput            = document.getElementById('queue-cutoff-time');
    const queueNotice            = document.getElementById('queue-closed-notice');
    const queueManagementContent = document.getElementById('queue-management-content');
    if (cutoffDisplay)          cutoffDisplay.textContent = 'Cutoff: ' + formatTime(cutoffTime);
    if (cutoffInput)            cutoffInput.value         = cutoffTime;
    if (queueNotice)            queueNotice.classList.toggle('open', !queueOpen);
    if (queueManagementContent) queueManagementContent.classList.toggle('queue-closed-dim', !queueOpen);
  }

  // ─── NAVIGATION ───
  function showPage(p) {
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.getElementById('page-' + p).classList.add('active');
    document.querySelectorAll('.side-btn').forEach((b, i) => {
      b.classList.remove('active');
      if ((p === 'dept'  && i === 0) || (p === 'queue' && i === 1)) b.classList.add('active');
    });
  }

  async function openDept(id, name) {
    activeDept = id;
    document.getElementById('active-dept-name').textContent = name;
    showPage('queue');
    try {
      await fetchDepartmentQueues(activeDept);
      await fetchDepartmentStats(activeDept);
    } catch (err) {
      console.error(err);
      showToast('Failed to load department data');
    }
    renderCounters();
    renderNextList();
    renderTable();
    renderNowServingCard();
    renderStats();
    switchTab('main', document.querySelector('.tab-btn'));
  }

  function switchTab(tab, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
  }

  // ─── QUEUE ACTIONS ───
  function recallQueue() {
    showToast('Queue #' + String(qNum).padStart(3,'0') + ' recalled — announcement sent');
  }

  function skipQueue() {
    qNum++;
    document.getElementById('q-number').textContent = String(qNum).padStart(3, '0');
    const p = patients.find(p => parseInt(p.q) === qNum);
    if (p) {
      document.getElementById('q-name').textContent = p.name;
      document.getElementById('q-sub').textContent  = getDemographicText(p);
      const pc = document.getElementById('q-priority');
      pc.className   = 'priority-chip ' + p.priority;
      pc.textContent = p.priority.charAt(0).toUpperCase() + p.priority.slice(1);
    }
    showToast('Skipped to Queue #' + String(qNum).padStart(3,'0'));
  }

  function callPatient(q) { showToast('Calling Queue #' + q + '…'); }

  async function deletePatient(queueId, qCode) {
    if (!queueId) return;
    try {
      const res = await fetch('/api/admin/delete/' + queueId, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete queue entry');
      await fetchDepartmentQueues(activeDept);
      await fetchDepartmentStats(activeDept);
      renderTable();
      renderNextList();
      renderNowServingCard();
      renderStats();
      showToast('Patient #' + qCode + ' removed from queue');
    } catch (err) {
      console.error(err);
      showToast('Failed to remove patient from queue');
    }
  }

  // ─── QUEUE OPEN / CLOSE ───
  function setCutoffTime(value) {
    if (!value) return;
    cutoffTime = value;
    renderQueueControls();
    showToast('Queue cutoff time set to ' + formatTime(cutoffTime));
  }

  async function closeQueue() {
    queueOpen = true;
    try {
      const res = await fetch('/api/admin/queue-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueOpen: true })
      });
      if (!res.ok) throw new Error('Failed to open queue');
    } catch (err) {
      queueOpen = false;
      console.error(err);
      showToast('Failed to update queue status');
      renderQueueControls();
      return;
    }
    renderCounters();
    renderQueueControls();
    showToast('Queue is now open for new patients');
  }

  async function continueQueue() {
    queueOpen = false;
    try {
      const res = await fetch('/api/admin/queue-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueOpen: false })
      });
      if (!res.ok) throw new Error('Failed to close queue');
    } catch (err) {
      queueOpen = true;
      console.error(err);
      showToast('Failed to update queue status');
      renderQueueControls();
      return;
    }
    renderCounters();
    renderQueueControls();
    showToast('Queue closed for new patients');
  }

  async function toggleDoctorAvailability(counterId, available) {
    const idx = counters.findIndex(c => c.counterId === Number(counterId));
    if (idx < 0) return;
    const prev = counters[idx].available;
    counters[idx].available = !!available;
    try {
      const res = await fetch('/api/admin/counters/' + counterId + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available: !!available })
      });
      if (!res.ok) throw new Error('Failed to update counter status');
    } catch (err) {
      counters[idx].available = prev;
      console.error(err);
      showToast('Failed to update doctor availability');
      renderCounters();
      return;
    }
    renderCounters();
    renderQueueControls();
    showToast(counters[idx].doctor + (counters[idx].available ? ' is now available' : ' is on break'));
  }

  // ─── AI PANEL ───
  function toggleAI() { document.getElementById('ai-panel').classList.toggle('open'); }

  function acceptAI() {
    const idx = patients.findIndex(p => p.q === '047');
    if (idx > -1) {
      patients[idx].priority = 'high';
      const removed      = patients.splice(idx, 1)[0];
      const firstWaiting = patients.findIndex(p => p.status === 'waiting');
      patients.splice(Math.max(firstWaiting, 0), 0, removed);
      renderTable();
      renderNextList();
    }
    document.getElementById('ai-panel').classList.remove('open');
    document.getElementById('ai-ping').style.display = 'none';
    showToast('Q-047 promoted to top of queue');
  }

  // ─── MODAL ───
  function openModal()  { document.getElementById('modal-overlay').classList.add('open'); }
  function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
  function closeModalOuter(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

  async function addPatient() {
    if (!queueOpen) { alert('Queue is currently closed. Please open the queue first.'); return; }
    const name     = document.getElementById('f-name').value.trim();
    const sex      = document.getElementById('f-sex').value;
    const ageRaw   = document.getElementById('f-age').value;
    const contact  = document.getElementById('f-contact').value.trim();
    const reason   = document.getElementById('f-reason').value.trim();
    if (!name || !sex || !ageRaw || !contact || !reason) {
      alert('Please complete all required fields: name, age, sex, contact number, and reason for visit.');
      return;
    }
    const age = parseInt(ageRaw, 10);
    if (Number.isNaN(age) || age < 0) { alert('Please enter a valid age.'); return; }
    const queueType  = document.getElementById('f-queue-type').value;
    const priority   = document.getElementById('f-priority').value;
    const counter    = document.getElementById('f-counter').value;
    const complaint  = document.getElementById('f-complaint').value.trim();
    const conditions = document.getElementById('f-conditions').value.trim();
    const activeDepartment = departments.find(d => String(d.id) === String(activeDept));
    if (!activeDepartment) { alert('No active department selected.'); return; }
    try {
      const res = await fetch('/api/queue/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        patientName: name,
        serviceType: activeDepartment.name,
        concern: reason
          + (complaint  ? ' | Symptoms: '   + complaint  : '')
          + (conditions ? ' | Conditions: ' + conditions : ''),
        queueType: queueType,
        priority: priority
      })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create queue');
      await fetchBootstrapData();
      await fetchDepartmentQueues(activeDept);
      renderDepts();
      renderTable();
      renderNextList();
      renderNowServingCard();
      closeModal();
      ['f-name','f-age','f-contact','f-reason','f-complaint','f-conditions'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('f-sex').value        = '';
      document.getElementById('f-queue-type').value = 'regular';
      showToast('Patient ' + name + ' added as Queue #' + (data.code || 'new'));
    } catch (err) {
      console.error(err);
      showToast('Failed to add patient to queue');
    }
  }

  // ─── NOTIFICATIONS ───
  function toggleNotif() { document.getElementById('notif-panel').classList.toggle('open'); }

  document.addEventListener('click', e => {
    if (!e.target.closest('#notif-btn') && !e.target.closest('#notif-panel')) {
      const panel = document.getElementById('notif-panel');
      if (panel) panel.classList.remove('open');
    }
  });

  // ─── TOAST ───
  function showToast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500;z-index:999;opacity:0;transition:opacity 0.2s;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.3)';
      document.body.appendChild(t);
    }
    t.textContent   = msg;
    t.style.opacity = '1';
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => t.style.opacity = '0', 2800);
  }

  // ─── EXPOSE GLOBALS ───
  window.filterDepts             = filterDepts;
  window.setFilter               = setFilter;
  window.showPage                = showPage;
  window.openDept                = openDept;
  window.switchTab               = switchTab;
  window.selectCounter           = selectCounter;
  window.recallQueue             = recallQueue;
  window.skipQueue               = skipQueue;
  window.callPatient             = callPatient;
  window.deletePatient           = deletePatient;
  window.toggleDoctorAvailability= toggleDoctorAvailability;
  window.setCutoffTime           = setCutoffTime;
  window.continueQueue           = continueQueue;
  window.closeQueue              = closeQueue;
  window.toggleAI                = toggleAI;
  window.acceptAI                = acceptAI;
  window.openModal               = openModal;
  window.closeModal              = closeModal;
  window.closeModalOuter         = closeModalOuter;
  window.addPatient              = addPatient;
  window.toggleNotif             = toggleNotif;

  // ─── INIT ───
  (async function initDashboard() {
    try {
      await fetchBootstrapData();
      renderDepts();
      renderQueueControls();
      if (departments.length > 0) {
        activeDept = departments[0].id;
        document.getElementById('active-dept-name').textContent = departments[0].name;
        await fetchDepartmentQueues(activeDept);
        await fetchDepartmentStats(activeDept);
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to load dashboard data');
    }
    renderCounters();
    renderNextList();
    renderTable();
    renderNowServingCard();
    renderStats();
    renderQueueControls();
  })();
} // END isDashboard


// ════════════════════════════════════════════════════════
//  ORIGINAL: INDEX FLOW  (old landing / dashboard page)
// ════════════════════════════════════════════════════════
if (indexFlow) {

  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  $$('.feature-list li').forEach(item => {
    item.addEventListener('click', () => {
      $$('.feature-list li').forEach(i => i.classList.remove('active-feature'));
      item.classList.add('active-feature');
      const page = item.dataset.page;
      $$('.page').forEach(p => p.classList.add('hidden'));
      $('#page-' + page).classList.remove('hidden');
      $('#page-title').textContent =
        page === 'dashboard' ? 'Queue Dashboard' : 'Settings';
    });
  });

  const backdrop = $('#modal-backdrop');

  function openModal(id) {
    backdrop.classList.remove('hidden');
    $('#' + id).classList.remove('hidden');
  }

  function closeModal(id) {
    backdrop.classList.add('hidden');
    $('#' + id).classList.add('hidden');
  }

  $('#btn-add-patient-open').onclick = () => openModal('modal-add-patient');
  $('#btn-quick-add-open').onclick   = () => openModal('modal-quick-add');
  $('#btn-emergency-open').onclick   = () => openModal('modal-emergency');

  $$('.modal-close, [data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });

  backdrop.onclick = () => {
    $$('.modal').forEach(m => m.classList.add('hidden'));
    backdrop.classList.add('hidden');
  };

  let selectedCategory = null;

  $$('.cat-btn').forEach(btn => {
    btn.onclick = () => {
      $$('.cat-btn').forEach(b => b.classList.remove('active-cat'));
      btn.classList.add('active-cat');
      selectedCategory = btn.dataset.prefix;
      $('#preview-code').textContent = selectedCategory + '001';
      $('#preview-sub').textContent  = 'Next available code';
    };
  });

  $$('.visit-btn').forEach(btn => {
    btn.onclick = () => {
      $$('.visit-btn').forEach(b => b.classList.remove('active-visit'));
      btn.classList.add('active-visit');
    };
  });

  $$('.mode-btn').forEach(btn => {
    btn.onclick = () => {
      $$('.mode-btn').forEach(b => b.classList.remove('active-mode'));
      btn.classList.add('active-mode');
    };
  });

  $('#filter-btn').onclick = () => {
    $('#filter-menu').classList.toggle('hidden');
  };

  $$('.filter-option').forEach(opt => {
    opt.onclick = () => {
      $$('.filter-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      $('#filter-btn').innerHTML = `
        <span class="material-symbols-outlined">filter_list</span>
        Filter: ${opt.textContent}
        <span class="material-symbols-outlined">arrow_drop_down</span>
      `;
      $('#filter-menu').classList.add('hidden');
    };
  });

  $('#queue-search').addEventListener('input', e => {
    const val = e.target.value.toLowerCase();
    $$('#queue-table tbody tr').forEach(row => {
      row.style.display = row.innerText.toLowerCase().includes(val) ? '' : 'none';
    });
  });

  const statusEl = $('#queue-status');
  if (statusEl) {
    statusEl.querySelectorAll('div').forEach(btn => {
      btn.onclick = () => { statusEl.dataset.status = btn.dataset.value; };
    });
  }

  $('#btn-call-next').onclick = () => {
    const code = $('#current-queue').textContent;
    const name = $('#serving-name').textContent;
    showToastOld('toast-calling', `${code} — ${name}`);
  };

  function showToastOld(id, msg) {
    const toast = $('#' + id);
    if (msg) {
      const el = toast.querySelector('.toast-msg');
      if (el) el.textContent = msg;
    }
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  let voidTarget = null;

  $$("[data-action='void']").forEach(btn => {
    btn.onclick = () => {
      voidTarget = btn.closest('tr');
      $('#void-patient-label').textContent = btn.dataset.name;
      openModal('modal-void');
    };
  });

  $('#btn-confirm-void').onclick = () => {
    if (voidTarget) { voidTarget.remove(); voidTarget = null; }
    closeModal('modal-void');
  };

  $$('.banner-close').forEach(btn => {
    btn.onclick = () => $('#' + btn.dataset.target).classList.add('hidden');
  });

  $$('.counter-tab').forEach(tab => {
    tab.onclick = () => {
      $$('.counter-tab').forEach(t => t.classList.remove('active-tab'));
      tab.classList.add('active-tab');
      const counter = tab.dataset.counter;
      $$('.counter-card').forEach(card => {
        card.style.display =
          (counter === 'all' || card.dataset.counter === counter) ? '' : 'none';
      });
    };
  });

} // end indexFlow


// ════════════════════════════════════════════════════════
//  ORIGINAL: MOCK ADMIN FLOW
// ════════════════════════════════════════════════════════
if (mockAdmin) {

  const logout = document.getElementById('btn-logout');

  window.addEventListener('DOMContentLoaded', async () => {
    const res  = await fetch('/api/admin/status');
    const data = await res.json();
    if (data.queued) {
      departmentId = data.department_id;
      show(data.code, data.ahead);
      startPolling();
    }
  });

  logout.addEventListener('click', async e => {
    e.preventDefault();
    try {
      await fetch('/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/login.html';
    } catch (err) {
      console.error('Logout failed', err);
    }
  });

  function renderQueueList(data) {
    const list = document.getElementById('queue-list');
    list.innerHTML = '';
    if (data.length === 0) {
      list.innerHTML = '<li class="empty-state">No patients waiting</li>';
      return;
    }
    data.forEach(q => {
      const li = document.createElement('li');
      li.textContent = `${q.code} - ${q.full_name}`;
      li.classList.add('queue-item');
      list.appendChild(li);
    });
  }

  async function loadQueue(departmentId) {
    if (!departmentId) return;
    const res  = await fetch(`/api/admin/${departmentId}`);
    const data = await res.json();
    if (!res.ok) return;
    renderQueueList(data);
  }

  let adminPoller   = null;
  let departmentId;

  function startPolling() {
    if (!departmentId) return;
    loadQueue(departmentId);
    if (adminPoller) clearInterval(adminPoller);
    adminPoller = setInterval(() => loadQueue(departmentId), 30000);
  }

} // end mockAdmin


// ════════════════════════════════════════════════════════
//  ORIGINAL: PATIENT FLOW
// ════════════════════════════════════════════════════════
if (patientEl) {

  let departmentId;
  const addQueueForm      = document.getElementById('add-queue-form');
  const completeFormPrompt= document.getElementById('completeFormLabel');
  const nowTicket         = document.getElementById('now-ticket');
  const nowName           = document.getElementById('now-name');
  const aheadStatus       = document.getElementById('stat-in-queue');

  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  window.addEventListener('DOMContentLoaded', async () => {
    const res  = await fetch('/api/queue/status');
    const data = await res.json();
    if (data.queued) {
      departmentId = data.department_id;
      showQueueState(data.code, data.ahead);
      startPolling();
    } else {
      attachForm();
    }
  });

  function attachForm() {
    addQueueForm.addEventListener('submit', async e => {
      e.preventDefault();
      const patientName = addQueueForm.name.value;
      const serviceType = addQueueForm.serviceType.value;
      const concern     = addQueueForm.concern.value;

      try {
        const res  = await fetch('/api/queue/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patientName, serviceType, concern })
        });
        const data = await res.json();

        if (!res.ok) {
          showToast(data.error || 'Failed');
          return;
        }

        showToast(`Queued: ${data.code}`);
        showQueueState(data.code, data.ahead);
        departmentId = data.department_id;
        startPolling();

      } catch (err) {
        showToast('Server error');
      }
    });
  }

  function showQueueState(code, ahead) {
    completeFormPrompt.classList.add('hidden');
    addQueueForm.classList.add('hidden');
    nowTicket.textContent  = code;
    nowName.textContent    = 'Joined';
    aheadStatus.textContent = ahead;
  }

  function renderQueueList(data) {
    const list = document.getElementById('queue-list');
    list.innerHTML = '';
    if (data.length === 0) {
      list.innerHTML = '<li class="empty-state">No patients waiting</li>';
      return;
    }
    data.forEach(q => {
      const li = document.createElement('li');
      li.textContent = `${q.code}`;
      li.classList.add('queue-item');
      list.appendChild(li);
    });
  }

  async function loadQueue(deptId) {
    if (!deptId) return;
    const res  = await fetch(`/api/queue/${deptId}`);
    const data = await res.json();
    if (!res.ok) return;
    renderQueueList(data);
  }

  let patientPoller = null;

  function startPolling() {
    if (!departmentId) return;
    loadQueue(departmentId);
    if (patientPoller) clearInterval(patientPoller);
    patientPoller = setInterval(() => loadQueue(departmentId), 3000);
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async e => {
      e.preventDefault();
      try {
        await fetch('/logout', { method: 'POST', credentials: 'include' });
        window.location.href = '/login.html';
      } catch (err) {
        console.error('Logout failed', err);
      }
    });
  }

} // end patientFlow