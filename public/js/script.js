const indexFlow = document.getElementById('indexFlow');
const patientEl = document.getElementById('patientFlow');
const mockAdmin = document.getElementById('mockFlow');

const isDashboard = !!document.getElementById('dept-grid');

if (isDashboard) {

  let currentRole = null;
  let departments = [];
  let counters = [];
  let patients = [];
  let activeDept = null;
  let activeFilter = 'all';
  let searchVal = '';
  let queueOpen = true;
  let cutoffTime = '17:00';
  let qNum = 42;

  let dashboardStats = {
    inQueue: 0, waiting: 0, servedToday: 0, avgWaitMin: null
  };

  function formatTime(twentyFour) {
    if (!twentyFour || !twentyFour.includes(':')) return 'Not set';
    const [h, m] = twentyFour.split(':');
    const hour = parseInt(h, 10);
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

  async function fetchBootstrapData() {
    const res = await fetch('/api/admin/dashboard/bootstrap');
    if (!res.ok) {
      throw new Error('Failed to load dashboard bootstrap data');
    }
    const data = await res.json();

    const deptColors = ['#e8f7f2', '#fef3f2', '#eff6ff', '#fefce8', '#f0fdf4', '#faf5ff', '#fff1f2', '#f0f4ff'];

    function inferDeptType(name) {
      const n = String(name || '').toLowerCase();
      if (n.includes('lab') || n.includes('pathology') || n.includes('radio')) return 'laboratory';
      if (n.includes('pharmacy') || n.includes('support')) return 'support';
      return 'patient-care';
    }

    departments = (data.departments || []).map((d, i) => ({
      id: String(d.department_id),
      name: d.name,
      code: d.code,
      type: inferDeptType(d.name),
      queue: Number(d.queue_count || 0),
      color: deptColors[i % deptColors.length],
      imagePlaceholder: 'Dept'
    }));

    counters = (data.counters || []).map(c => ({
      counterId: Number(c.counter_id),
      departmentId: String(c.department_id),
      room: c.name || `Counter ${c.counter_id}`,
      num: c.current_queue_id ? String(c.current_queue_id).padStart(3, '0') : '---',
      doctor: c.name || `Counter ${c.counter_id}`,
      spec: 'General Consultation',
      avg: 'N/A',
      available: c.status === 'open'
    }));

    queueOpen = data.queue_status !== 'closed';
    currentRole = data.role;
  }
  function applyRoleUI() {
    if (currentRole === 'staff') {
      const deptSideButton = document.querySelector('.side-btn[title="Departments"]');
      if (deptSideButton) deptSideButton.style.display = 'none';

      const staffSideButton = document.querySelector('.side-btn[title="Staff"]');
      if (staffSideButton) staffSideButton.style.display = 'none';

      const settingsSideButton = document.querySelector('.side-btn[title="Settings"]');
      if (settingsSideButton) settingsSideButton.style.display = 'none';

      const backBtn = document.querySelector('.back-btn');
      if (backBtn) backBtn.style.display = 'none';

      return;
    }

    if (currentRole !== 'owner' && currentRole !== 'admin') {
      const staffSideButton = document.querySelector('.side-btn[title="Staff"]');
      if (staffSideButton) staffSideButton.style.display = 'none';

      const settingsSideButton = document.querySelector('.side-btn[title="Settings"]');
      if (settingsSideButton) settingsSideButton.style.display = 'none';
    }
  }


  async function fetchDepartmentQueues(departmentId) {
    const res = await fetch('/api/admin/dashboard/department/' + departmentId);
    if (!res.ok) throw new Error('Failed to load department queue data');
    const data = await res.json();
    patients = (data.queues || []).map(q => ({
      queueId: Number(q.queue_id),
      q: q.code || String(q.queue_id).padStart(3, '0'),
      name: q.full_name || 'Unknown patient',
      gender: q.sex || '',
      age: q.age || '',
      priority: q.is_emergency || q.is_priority ? 'high' : 'medium',
      status: q.status,
      counter: q.counter_name || 'Unassigned',
      wait: q.status === 'serving' ? 'Serving now' : 'Waiting',
      queueType: q.category === 'priority' ? 'pwd' : 'regular',
      reason: q.visit_description || q.category || 'No visit description',
      calledAt: q.called_at
    }));
  }

  async function fetchDepartmentStats(departmentId) {
    const res = await fetch('/api/admin/dashboard/stats/' + departmentId);
    if (!res.ok) throw new Error('Failed to load department statistics');
    const data = await res.json();
    const stats = data.stats || {};
    dashboardStats = {
      inQueue: Number(stats.in_queue || 0),
      waiting: Number(stats.waiting || 0),
      servedToday: Number(stats.served_today || 0),
      avgWaitMin: stats.avg_wait_min === null ? null : Number(stats.avg_wait_min)
    };
  }


  function renderDepts() {
    const grid = document.getElementById('dept-grid');

    const filtered = departments.filter(d => {
      const matchType = activeFilter === 'all' || d.type === activeFilter;
      const matchSearch = d.name.toLowerCase().includes(searchVal.toLowerCase());
      return matchType && matchSearch;
    });

    if (!filtered.length) {
      grid.innerHTML = `
      <div class="empty-state">
        No departments found.
      </div>
    `;
      return;
    }

    grid.innerHTML = filtered.map(d => `
    <div class="dept-card" onclick="openDept('${d.id}','${d.name.replace(/'/g, "\\'")}')">
      <div class="dept-img" style="background:${d.color}">
        <div class="dept-img-bg placeholder-text">Department image</div>
      </div>
      <div class="dept-info">
        <div class="dept-name">${d.name}</div>
        <div class="dept-meta">
          <span class="dept-type ${d.type === 'laboratory' ? 'lab' : d.type === 'support' ? 'support' : ''}">
            ${d.type.replace('-', ' ')}
          </span>
          <span class="dept-queue">Queue: <span>${d.queue}</span></span>
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

  function renderCounters() {
    const row = document.getElementById('counters-row');
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
              ${!queueOpen ? 'disabled' : ''}
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


  function formatDateTime(value) {
    if (!value) return 'Not called yet';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not called yet';

    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function renderNowServingCard() {
    const serving = patients.find(p => p.status === 'serving');

    const qNumber = document.getElementById('q-number');
    const qName = document.getElementById('q-name');
    const qSub = document.getElementById('q-sub');
    const qPriority = document.getElementById('q-priority');
    const qTime = document.getElementById('q-time');

    if (!serving) {
      if (qNumber) qNumber.textContent = '---';
      if (qName) qName.textContent = 'No patient currently serving';
      if (qSub) qSub.textContent = 'Select Call on the next patient';
      if (qPriority) {
        qPriority.className = 'priority-chip medium';
        qPriority.textContent = 'Normal';
      }
      if (qTime) qTime.textContent = 'Not called yet';
      return;
    }

    if (qNumber) qNumber.textContent = serving.q;
    if (qName) qName.textContent = serving.name;
    if (qSub) qSub.textContent = getDemographicText(serving);

    if (qPriority) {
      qPriority.className = 'priority-chip ' + serving.priority;
      qPriority.textContent = serving.priority === 'high' ? 'High' : 'Normal';
    }

    if (qTime) {
      qTime.textContent = serving.calledAt ? 'Called at ' + formatDateTime(serving.calledAt) : 'Not called yet';
    }
  }

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
    const tbody = document.getElementById('queue-tbody');
    const lineCount = document.getElementById('line-count');

    if (!tbody) return;

    const priorityOrder = { high: 0, medium: 1, low: 2 };

    const sorted = [...patients].sort((a, b) => {
      if (a.status === 'serving') return -1;
      if (b.status === 'serving') return 1;

      const aPriority = priorityOrder[a.priority] ?? 2;
      const bPriority = priorityOrder[b.priority] ?? 2;

      if (aPriority !== bPriority) return aPriority - bPriority;

      return String(a.q).localeCompare(String(b.q));
    });

    if (lineCount) {
      lineCount.textContent = ` (${patients.length} patients)`;
    }

    tbody.innerHTML = renderQueueRows(sorted);
  }


  function renderStats() {
    const queueEl = document.getElementById('stat-queue');
    const servedEl = document.getElementById('stat-served');
    const waitingEl = document.getElementById('stat-waiting');
    const waitEl = document.getElementById('stat-wait');
    const servedSubEl = document.getElementById('stat-served-sub');
    const waitSubEl = document.getElementById('stat-wait-sub');
    if (queueEl) queueEl.textContent = String(dashboardStats.inQueue);
    if (servedEl) servedEl.textContent = String(dashboardStats.servedToday);
    if (waitingEl) waitingEl.textContent = String(dashboardStats.waiting);
    if (waitEl) waitEl.textContent = dashboardStats.avgWaitMin === null ? 'N/A' : `~${Math.round(dashboardStats.avgWaitMin)} min`;
    if (servedSubEl) servedSubEl.textContent = 'From completed queues today';
    if (waitSubEl) waitSubEl.textContent = 'Average from called queues today';
  }


  function renderQueueControls() {
    const cutoffDisplay = document.getElementById('queue-cutoff-display');
    const cutoffInput = document.getElementById('queue-cutoff-time');
    const queueNotice = document.getElementById('queue-closed-notice');
    const queueManagementContent = document.getElementById('queue-management-content');
    if (cutoffDisplay) cutoffDisplay.textContent = 'Cutoff: ' + formatTime(cutoffTime);
    if (cutoffInput) cutoffInput.value = cutoffTime;
    if (queueNotice) queueNotice.classList.toggle('open', !queueOpen);
    if (queueManagementContent) queueManagementContent.classList.toggle('queue-closed-dim', !queueOpen);
  }


  function showPage(p) {
    document.querySelectorAll('.page').forEach(el => {
      el.classList.remove('active');
    });

    const page = document.getElementById('page-' + p);
    if (page) page.classList.add('active');

    document.querySelectorAll('.side-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    const activeButton = document.querySelector(`.side-btn[data-page="${p}"]`);
    if (activeButton) activeButton.classList.add('active');

    if (p === 'staff') {
      loadStaffPage();
    }

    if (p === 'settings') {
      loadSettingsPage();
    }
  }

  async function loadSettingsPage() {
    if (currentRole === 'staff') {
      showToast('Settings are only available to admins');
      showPage('queue');
      return;
    }

    await loadDepartmentsForCounterForm();
    await loadCountersSettings();
  }

  async function loadDepartmentsForCounterForm() {
    const select = document.getElementById('counter-department');
    if (!select) return;

    select.innerHTML = `<option value="">Select department</option>`;

    if (!departments || departments.length === 0) {
      await fetchBootstrapData();
    }

    departments.forEach(dept => {
      const option = document.createElement('option');
      option.value = dept.id;
      option.textContent = dept.name;
      select.appendChild(option);
    });
  }

  function getDepartmentOptions(selectedDepartmentId) {
    return departments.map(dept => `
    <option value="${dept.id}" ${Number(dept.id) === Number(selectedDepartmentId) ? 'selected' : ''}>
      ${dept.name}
    </option>
  `).join('');
  }

  async function loadCountersSettings() {
    const tbody = document.getElementById('settings-counters-tbody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/admin/counters');
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load counters');
      }

      const countersList = data.counters || [];

      if (!countersList.length) {
        tbody.innerHTML = `
        <tr>
          <td colspan="5" style="padding: 16px; color: var(--text3);">
            No counters configured yet.
          </td>
        </tr>
      `;
        return;
      }

      tbody.innerHTML = countersList.map(counter => `
      <tr>
        <td>
          <input
            type="text"
            value="${counter.name || ''}"
            id="counter-name-${counter.counter_id}"
          />
        </td>

        <td>
          <select id="counter-dept-${counter.counter_id}">
            ${getDepartmentOptions(counter.department_id)}
          </select>
        </td>

        <td>
          <select id="counter-status-${counter.counter_id}">
            <option value="open" ${counter.status === 'open' ? 'selected' : ''}>Open</option>
            <option value="break" ${counter.status === 'break' ? 'selected' : ''}>Break</option>
            <option value="closed" ${counter.status === 'closed' ? 'selected' : ''}>Closed</option>
          </select>
        </td>

        <td>${counter.current_queue_code || 'None'}</td>

        <td>
          <div class="action-btns">
            <button class="act-btn" onclick="saveCounter(${counter.counter_id})">
              Save
            </button>
            <button class="act-btn del" onclick="deleteCounter(${counter.counter_id})">
              Delete
            </button>
          </div>
        </td>
      </tr>
    `).join('');
    } catch (err) {
      console.error(err);
      showToast('Failed to load counters');
    }
  }

  function attachCounterForm() {
    const form = document.getElementById('counter-form');
    if (!form) return;

    form.addEventListener('submit', async e => {
      e.preventDefault();

      const name = document.getElementById('counter-name').value.trim();
      const departmentId = document.getElementById('counter-department').value;
      const status = document.getElementById('counter-status').value;

      if (!name || !departmentId) {
        showToast('Please enter a counter name and department');
        return;
      }

      try {
        const res = await fetch('/api/admin/counters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, departmentId, status })
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to create counter');
        }

        form.reset();

        await fetchBootstrapData();
        renderCounters();
        await loadDepartmentsForCounterForm();
        await loadCountersSettings();

        showToast('Counter created');
      } catch (err) {
        console.error(err);
        showToast(err.message);
      }
    });
  }

  async function saveCounter(counterId) {
    const name = document.getElementById('counter-name-' + counterId).value.trim();
    const departmentId = document.getElementById('counter-dept-' + counterId).value;
    const status = document.getElementById('counter-status-' + counterId).value;

    if (!name || !departmentId || !status) {
      showToast('Counter fields cannot be empty');
      return;
    }

    try {
      const res = await fetch('/api/admin/counters/' + counterId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, departmentId, status })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update counter');
      }

      await fetchBootstrapData();
      renderCounters();
      await loadCountersSettings();

      showToast('Counter updated');
    } catch (err) {
      console.error(err);
      showToast(err.message);
    }
  }

  async function deleteCounter(counterId) {
    const ok = confirm('Delete this counter? This cannot be undone.');
    if (!ok) return;

    try {
      const res = await fetch('/api/admin/counters/' + counterId, {
        method: 'DELETE'
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete counter');
      }

      await fetchBootstrapData();
      renderCounters();
      await loadCountersSettings();

      showToast('Counter deleted');
    } catch (err) {
      console.error(err);
      showToast(err.message);
    }
  }

  window.saveCounter = saveCounter;
  window.deleteCounter = deleteCounter;
  window.loadCountersSettings = loadCountersSettings;
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


  function recallQueue() {
    showToast('Queue #' + String(qNum).padStart(3, '0') + ' recalled — announcement sent');
  }

  async function callNextPatient() {
    if (!activeDept) {
      showToast('No department selected');
      return;
    }

    try {
      const res = await fetch('/api/admin/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department_id: activeDept })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to call next patient');
      }

      await fetchDepartmentQueues(activeDept);
      await fetchDepartmentStats(activeDept);

      renderCounters();
      renderNextList();
      renderTable();
      renderNowServingCard();
      renderStats();

      if (data.next) {
        showToast('Now serving ' + data.next.code);
      } else {
        showToast('No waiting patients in this department');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to call next patient');
    }
  }

  async function skipQueue() {
    const serving = patients.find(p => p.status === 'serving');

    if (!serving) {
      showToast('No patient is currently serving');
      return;
    }

    try {
      const res = await fetch('/api/admin/skip/' + serving.queueId, {
        method: 'PATCH'
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to skip patient');
      }

      await fetchDepartmentQueues(activeDept);
      await fetchDepartmentStats(activeDept);

      renderCounters();
      renderNextList();
      renderTable();
      renderNowServingCard();
      renderStats();

      showToast('Skipped ' + serving.q);
    } catch (err) {
      console.error(err);
      showToast('Failed to skip patient');
    }
  }

  function callPatient() {
    callNextPatient();
  }

  window.callNextPatient = callNextPatient;


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


  function toggleAI() { document.getElementById('ai-panel').classList.toggle('open'); }

  document.getElementById('pwd-queue-tbody');
  document.getElementById('regular-queue-tbody');

  function acceptAI() {
    document.getElementById('ai-panel').classList.remove('open');
    document.getElementById('ai-ping').style.display = 'none';
    showToast('AI alert acknowledged');
  }


  function openModal() { document.getElementById('modal-overlay').classList.add('open'); }
  function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
  function closeModalOuter(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

  async function addPatient() {
    if (!queueOpen) { alert('Queue is currently closed. Please open the queue first.'); return; }
    const name = document.getElementById('f-name').value.trim();
    const sex = document.getElementById('f-sex').value;
    const ageRaw = document.getElementById('f-age').value;
    const contact = document.getElementById('f-contact').value.trim();
    const reason = document.getElementById('f-reason').value.trim();
    if (!name || !sex || !ageRaw || !contact || !reason) {
      alert('Please complete all required fields: name, age, sex, contact number, and reason for visit.');
      return;
    }
    const age = parseInt(ageRaw, 10);
    if (Number.isNaN(age) || age < 0) { alert('Please enter a valid age.'); return; }
    const queueType = document.getElementById('f-queue-type').value;
    const priority = document.getElementById('f-priority').value;
    const counter = document.getElementById('f-counter').value;
    const complaint = document.getElementById('f-complaint').value.trim();
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
            + (complaint ? ' | Symptoms: ' + complaint : '')
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
      ['f-name', 'f-age', 'f-contact', 'f-reason', 'f-complaint', 'f-conditions'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('f-sex').value = '';
      document.getElementById('f-queue-type').value = 'regular';
      showToast('Patient ' + name + ' added as Queue #' + (data.code || 'new'));
    } catch (err) {
      console.error(err);
      showToast('Failed to add patient to queue');
    }
  }


  function toggleNotif() { document.getElementById('notif-panel').classList.toggle('open'); }

  document.addEventListener('click', e => {
    if (!e.target.closest('#notif-btn') && !e.target.closest('#notif-panel')) {
      const panel = document.getElementById('notif-panel');
      if (panel) panel.classList.remove('open');
    }
  });


  function showToast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500;z-index:999;opacity:0;transition:opacity 0.2s;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.3)';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => t.style.opacity = '0', 2800);
  }


  window.filterDepts = filterDepts;
  window.setFilter = setFilter;
  window.showPage = showPage;
  window.openDept = openDept;
  window.switchTab = switchTab;
  window.selectCounter = selectCounter;
  window.recallQueue = recallQueue;
  window.skipQueue = skipQueue;
  window.callPatient = callPatient;
  window.deletePatient = deletePatient;
  window.toggleDoctorAvailability = toggleDoctorAvailability;
  window.setCutoffTime = setCutoffTime;
  window.continueQueue = continueQueue;
  window.closeQueue = closeQueue;
  window.toggleAI = toggleAI;
  window.acceptAI = acceptAI;
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.closeModalOuter = closeModalOuter;
  window.addPatient = addPatient;
  window.toggleNotif = toggleNotif;


  (async function initDashboard() {
    try {
      await loadCurrentUser();
      await fetchBootstrapData();
      await loadNotifications();
      loadDepartmentsForStaffForm();
      renderDepts();
      applyRoleUI();
      attachStaffForm();
      attachCounterForm();
      renderQueueControls();
      if (departments.length > 0) {
        activeDept = departments[0].id;
        document.getElementById('active-dept-name').textContent = departments[0].name;

        if (departments.length === 1) {
          showPage('queue');
        }

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

  async function loadStaffPage() {
    await loadDepartmentsForStaffForm();
    await loadStaffAccounts();
  }

  async function loadDepartmentsForStaffForm() {
    const select = document.getElementById('staff-department');
    if (!select) return;

    select.innerHTML = `<option value="">Select department</option>`;

    departments.forEach(dept => {
      const option = document.createElement('option');
      option.value = dept.id;
      option.textContent = dept.name;
      select.appendChild(option);
    });
  }

  async function loadStaffAccounts() {
    const tbody = document.getElementById('staff-tbody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/admin/staff');
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load staff accounts');
      }

      if (!data.staff.length) {
        tbody.innerHTML = `
        <tr>
          <td colspan="4" style="color: var(--text3); padding: 16px;">
            No staff accounts found.
          </td>
        </tr>
      `;
        return;
      }

      tbody.innerHTML = data.staff.map(staff => `
      <tr>
        <td>${staff.full_name || 'Unnamed staff'}</td>
        <td>${staff.username}</td>
        <td>
          <select onchange="updateStaffDepartment(${staff.user_id}, this.value)">
            ${departments.map(dept => `
              <option value="${dept.id}" ${Number(dept.id) === Number(staff.department_id) ? 'selected' : ''}>
                ${dept.name}
              </option>
            `).join('')}
          </select>
        </td>
        <td>
          <button class="act-btn" onclick="updateStaffDepartment(${staff.user_id}, this.closest('tr').querySelector('select').value)">
            Save
          </button>
        </td>
      </tr>
    `).join('');
    } catch (err) {
      console.error(err);
      showToast('Failed to load staff accounts');
    }
  }

  function attachStaffForm() {
    const form = document.getElementById('staff-form');
    if (!form) return;

    form.addEventListener('submit', async e => {
      e.preventDefault();

      const fullName = document.getElementById('staff-full-name').value.trim();
      const contact = document.getElementById('staff-contact').value.trim();
      const username = document.getElementById('staff-username').value.trim();
      const password = document.getElementById('staff-password').value;
      const departmentId = document.getElementById('staff-department').value;

      if (!fullName || !username || !password || !departmentId) {
        showToast('Please complete all required staff fields');
        return;
      }

      try {
        const res = await fetch('/api/admin/staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName,
            contact,
            username,
            password,
            departmentId
          })
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to create staff');
        }

        form.reset();
        await loadStaffAccounts();
        showToast('Staff account created');
      } catch (err) {
        console.error(err);
        showToast(err.message);
      }
    });
  }

  async function updateStaffDepartment(userId, departmentId) {
    if (!departmentId) {
      showToast('Please select a department');
      return;
    }

    try {
      const res = await fetch('/api/admin/staff/' + userId + '/department', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentId })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update department');
      }

      showToast('Staff department updated');
      await loadStaffAccounts();
    } catch (err) {
      console.error(err);
      showToast(err.message);
    }
  }

  window.updateStaffDepartment = updateStaffDepartment;




  const logout = document.getElementById('logoutBtn');

  logout.addEventListener('click', async e => {
    e.preventDefault();
    try {
      await fetch('/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/login';
    } catch (err) {
      console.error('Logout failed', err);
    }
  });

  async function loadCurrentUser() {
    try {
      const res = await fetch('/api/me');
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load user');
      }

      const user = data.user;

      const name = user.full_name || user.username || 'User';
      const role = formatRoleLabel(user.role, user.department_name);
      const initials = getInitials(name);

      const avatarEl = document.getElementById('profile-avatar');
      const nameEl = document.getElementById('profile-name');
      const roleEl = document.getElementById('profile-role');

      if (avatarEl) avatarEl.textContent = initials;
      if (nameEl) nameEl.textContent = name;
      if (roleEl) roleEl.textContent = role;
    } catch (err) {
      console.error(err);

      const avatarEl = document.getElementById('profile-avatar');
      const nameEl = document.getElementById('profile-name');
      const roleEl = document.getElementById('profile-role');

      if (avatarEl) avatarEl.textContent = '--';
      if (nameEl) nameEl.textContent = 'User';
      if (roleEl) roleEl.textContent = 'Signed in';
    }
  }

  function getInitials(name) {
    return String(name || 'User')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }

  function formatRoleLabel(role, departmentName) {
    if (role === 'owner') return 'Owner';
    if (role === 'admin') return 'Admin';
    if (role === 'staff') return departmentName ? `Staff · ${departmentName}` : 'Staff';
    return 'Patient';
  }

  async function loadNotifications() {
    const list = document.getElementById('notif-list');
    const dot = document.querySelector('.notif-dot');

    if (!list) return;

    try {
      const res = await fetch('/api/admin/notifications');
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load notifications');
      }

      const notifications = data.notifications || [];

      if (dot) {
        dot.style.display = notifications.length ? 'block' : 'none';
      }

      if (!notifications.length) {
        list.innerHTML = `
        <div class="notif-item">
          <div class="notif-dot2"></div>
          <div>
            <div class="notif-text">No notifications yet.</div>
            <div class="notif-time">Waiting for queue activity</div>
          </div>
        </div>
      `;
        return;
      }

      list.innerHTML = notifications.map(n => `
      <div class="notif-item">
        <div class="notif-dot2" style="background:${n.type === 'urgent' ? 'var(--red)' : 'var(--green)'}"></div>
        <div>
          <div class="notif-text">${n.text}</div>
          <div class="notif-time">${n.time}</div>
        </div>
      </div>
    `).join('');
    } catch (err) {
      console.error(err);
      list.innerHTML = `
      <div class="notif-item">
        <div class="notif-dot2"></div>
        <div>
          <div class="notif-text">Failed to load notifications.</div>
          <div class="notif-time">Please refresh the page</div>
        </div>
      </div>
    `;
    }
  }
}





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
  $('#btn-quick-add-open').onclick = () => openModal('modal-quick-add');
  $('#btn-emergency-open').onclick = () => openModal('modal-emergency');

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
      $('#preview-sub').textContent = 'Next available code';
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

}


if (mockAdmin) {

  const logout = document.getElementById('btn-logout');

  window.addEventListener('DOMContentLoaded', async () => {
    const res = await fetch('/api/admin/status');
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
      window.location.href = '/login';
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
    const res = await fetch(`/api/admin/${departmentId}`);
    const data = await res.json();
    if (!res.ok) return;
    renderQueueList(data);
  }

  let adminPoller = null;
  let departmentId;

  function startPolling() {
    if (!departmentId) return;
    loadQueue(departmentId);
    if (adminPoller) clearInterval(adminPoller);
    adminPoller = setInterval(() => loadQueue(departmentId), 30000);
  }

}


if (patientEl) {
  let departmentId = null;
  let patientPoller = null;
  let isSubmittingQueue = false;
  let isQueueOpen = true;

  const addQueueForm = document.getElementById('add-queue-form');
  const completeFormPrompt = document.getElementById('completeFormLabel');
  const nowTicket = document.getElementById('now-ticket');
  const nowName = document.getElementById('now-name');
  const nowService = document.getElementById('now-service');
  const aheadStatus = document.getElementById('stat-in-queue');
  const estWait = document.getElementById('stat-est-wait');
  const statusBadge = document.getElementById('clinic-status-badge');
  const statusDot = document.getElementById('clinic-status-dot');
  const statusText = document.getElementById('clinic-status-text');
  const submitBtn = addQueueForm ? addQueueForm.querySelector('button[type="submit"]') : null;

  function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function setQueueOpenUI(open, status = 'open') {
    isQueueOpen = open;

    if (statusText) {
      statusText.textContent = open ? 'Open' : status === 'pause' ? 'Paused' : 'Closed';
    }

    if (statusDot) {
      statusDot.style.background = open ? 'var(--green)' : 'var(--red)';
    }

    if (statusBadge) {
      statusBadge.classList.toggle('closed', !open);
    }

    if (submitBtn && !addQueueForm.classList.contains('hidden')) {
      submitBtn.disabled = !open;
      submitBtn.textContent = open ? 'Add' : 'Queue Closed';
    }

    if (completeFormPrompt && !open && !addQueueForm.classList.contains('hidden')) {
      completeFormPrompt.textContent = 'Queue is currently closed';
    }

    if (completeFormPrompt && open && !addQueueForm.classList.contains('hidden')) {
      completeFormPrompt.textContent = 'Complete the form to join';
    }
  }

  function showQueueState(code, ahead, patientName = 'Joined', departmentName = '') {
    if (completeFormPrompt) {
      completeFormPrompt.classList.add('hidden');
    }

    if (addQueueForm) {
      addQueueForm.classList.add('hidden');
    }

    if (nowTicket) {
      nowTicket.textContent = code || '---';
      nowTicket.classList.remove('empty');
    }

    if (nowName) {
      nowName.textContent = patientName || 'Joined';
      nowName.style.opacity = '1';
    }

    if (nowService) {
      nowService.textContent = departmentName || '';
    }

    if (aheadStatus) {
      aheadStatus.textContent = Number(ahead || 0);
    }

    if (estWait) {
      estWait.textContent = `${Number(ahead || 0) * 5}m`;
    }
  }

  function showJoinForm() {
    if (completeFormPrompt) {
      completeFormPrompt.classList.remove('hidden');
      completeFormPrompt.textContent = isQueueOpen ? 'Complete the form to join' : 'Queue is currently closed';
    }

    if (addQueueForm) {
      addQueueForm.classList.remove('hidden');
    }

    if (nowTicket) {
      nowTicket.textContent = '---';
      nowTicket.classList.add('empty');
    }

    if (nowName) {
      nowName.textContent = 'Not yet joined';
      nowName.style.opacity = '0.3';
    }

    if (nowService) {
      nowService.textContent = '';
    }

    if (aheadStatus) {
      aheadStatus.textContent = '0';
    }

    if (estWait) {
      estWait.textContent = '0m';
    }

    setQueueOpenUI(isQueueOpen);
  }

  async function refreshPatientStatus() {
    const res = await fetch('/api/queue/status');
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load queue status');
    }

    setQueueOpenUI(data.queue_open, data.queue_status);

    if (data.queued) {
      departmentId = data.department_id;

      showQueueState(
        data.code,
        data.ahead,
        data.full_name,
        data.department_name
      );

      startPolling();
    } else {
      departmentId = null;
      showJoinForm();
      attachForm();
    }
  }

  function attachForm() {
    if (!addQueueForm || addQueueForm.dataset.bound === '1') return;

    addQueueForm.dataset.bound = '1';

    addQueueForm.addEventListener('submit', async e => {
      e.preventDefault();

      if (isSubmittingQueue) return;

      if (!isQueueOpen) {
        showToast('Queue is currently closed');
        return;
      }

      isSubmittingQueue = true;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding...';
      }

      const patientName = addQueueForm.name.value.trim();
      const serviceType = addQueueForm.serviceType.value;
      const queueType = addQueueForm.queueType.value;
      const concern = addQueueForm.concern.value.trim();

      if (!patientName || !serviceType || !concern) {
        showToast('Please complete the form');

        isSubmittingQueue = false;

        if (submitBtn) {
          submitBtn.disabled = !isQueueOpen;
          submitBtn.textContent = isQueueOpen ? 'Add' : 'Queue Closed';
        }

        return;
      }

      try {
        const res = await fetch('/api/queue/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientName,
            serviceType,
            queueType,
            priority: queueType === 'pwd' ? 'high' : 'medium',
            concern
          })
        });

        const data = await res.json();

        if (res.status === 409) {
          showToast(data.error || 'You already have an active queue');
          await refreshPatientStatus();
          return;
        }

        if (res.status === 403) {
          showToast(data.error || 'Queue is currently closed');
          await refreshPatientStatus();
          return;
        }

        if (!res.ok || !data.success) {
          showToast(data.error || 'Failed to join queue');
          return;
        }

        showToast('Queued: ' + data.code);

        departmentId = data.department_id;

        showQueueState(
          data.code,
          data.ahead,
          patientName,
          serviceType
        );

        startPolling();
      } catch (err) {
        console.error(err);
        showToast('Server error');

        isSubmittingQueue = false;

        if (submitBtn) {
          submitBtn.disabled = !isQueueOpen;
          submitBtn.textContent = isQueueOpen ? 'Add' : 'Queue Closed';
        }
      }
    });
  }

  function renderQueueList(data) {
    const list = document.getElementById('queue-list');
    if (!list) return;

    list.innerHTML = '';

    if (!data.length) {
      list.innerHTML = '<li class="empty-state">No patients waiting</li>';
      return;
    }

    data.forEach(q => {
      const li = document.createElement('li');
      li.textContent = q.full_name ? `${q.code} - ${q.full_name}` : q.code;
      li.classList.add('queue-item');
      list.appendChild(li);
    });
  }

  async function loadQueue(deptId) {
    if (!deptId) return;

    const res = await fetch(`/api/queue/${deptId}`);
    const data = await res.json();

    if (!res.ok) return;

    renderQueueList(data);
  }

  function startPolling() {
    if (!departmentId) return;

    loadQueue(departmentId);

    if (patientPoller) {
      clearInterval(patientPoller);
    }

    patientPoller = setInterval(async () => {
      try {
        await refreshPatientStatus();

        if (departmentId) {
          await loadQueue(departmentId);
        }
      } catch (err) {
        console.error(err);
      }
    }, 5000);
  }

  const logoutBtn = document.getElementById('btn-logout');

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async e => {
      e.preventDefault();

      try {
        await fetch('/logout', {
          method: 'POST',
          credentials: 'include'
        });

        window.location.href = '/login';
      } catch (err) {
        console.error('Logout failed', err);
      }
    });
  }

  window.addEventListener('DOMContentLoaded', async () => {
    try {
      await refreshPatientStatus();
    } catch (err) {
      console.error(err);
      showToast('Failed to load queue status');
      attachForm();
    }
  });
}
