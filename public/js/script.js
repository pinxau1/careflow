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
  let selectedCounterId = null;
  let transferQueueId = null;
  let transferSourceQueue = null;
  let activeFilter = 'all';
  let searchVal = '';
  let queueOpen = true;
  let isCallingNext = false;
  let cutoffTime = '17:00';
  let latestHistoryRows = [];

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

  async function readJsonResponse(res, fallbackMessage) {
    let data = {};

    try {
      data = await res.json();
    } catch (err) {
      data = {};
    }

    if (!res.ok) {
      throw new Error(data.error || fallbackMessage);
    }

    return data;
  }

  async function fetchBootstrapData() {
    const res = await fetch('/api/admin/dashboard/bootstrap');
    const data = await readJsonResponse(res, 'Failed to load dashboard bootstrap data');

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
      queueStatus: d.queue_status || 'open',
      pauseMessage: d.pause_message || '',
      pausedUntil: d.paused_until || '',
      type: inferDeptType(d.name),
      queue: Number(d.queue_count || 0),
      color: deptColors[i % deptColors.length],
      imagePlaceholder: 'Dept'
    }));

    counters = (data.counters || []).map(c => ({
      counterId: Number(c.counter_id),
      departmentId: String(c.department_id),
      room: c.name || `Counter ${c.counter_id}`,
      num: c.current_queue_code || (c.current_queue_id ? String(c.current_queue_id).padStart(3, '0') : '---'),
      doctor: c.name || `Counter ${c.counter_id}`,
      spec: 'General Consultation',
      avg: 'N/A',
      available: c.status === 'open'
    }));

    const activeDepartment = departments.find(d => String(d.id) === String(activeDept));
    queueOpen = activeDepartment ? activeDepartment.queueStatus === 'open' : data.queue_status !== 'closed';
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
    const data = await readJsonResponse(res, 'Failed to load department queue data');
    patients = (data.queues || []).map(q => ({
      queueId: Number(q.queue_id),
      department_id: q.department_id,
      q: q.code || String(q.queue_id).padStart(3, '0'),
      name: q.full_name || 'Unknown patient',
      gender: q.sex || '',
      age: q.age || '',
      priority: q.is_emergency || q.is_priority ? 'high' : 'medium',
      status: q.status,
      counterId: q.counter_id ? Number(q.counter_id) : null,
      counter: q.counter_name || 'Unassigned',
      wait: q.status === 'serving' ? 'Serving now' : 'Waiting',
      queueType: q.category === 'priority' ? 'pwd' : 'regular',
      reason: q.visit_description || q.category || 'No visit description',
      aiSuggestedDepartment: q.ai_suggested_department || '',
      aiPriorityLevel: q.ai_priority_level || 'normal',
      calledAt: q.called_at
    }));
  }

  async function fetchDepartmentStats(departmentId) {
    const res = await fetch('/api/admin/dashboard/stats/' + departmentId);
    const data = await readJsonResponse(res, 'Failed to load department statistics');
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
        <div class="dept-img-bg placeholder-text">${d.name}</div>
        
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

  async function refreshDepartmentOverview() {
    await fetchBootstrapData();
    syncSelectedCounter();
    renderDepts();
    renderCounters();
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
      selectedCounterId = null;
      row.innerHTML = `<div class="counter-card">No counters configured for this department.</div>`;
      return;
    }
    syncSelectedCounter();
    row.innerHTML = deptCounters.map((c, i) => `
	      <div class="counter-card ${Number(c.counterId) === Number(selectedCounterId) ? 'active-counter' : ''}" onclick="selectCounter(${c.counterId}, this)">
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

  function syncSelectedCounter() {
    const deptCounters = counters.filter(c => c.departmentId === String(activeDept));
    if (!deptCounters.length) {
      selectedCounterId = null;
      return;
    }

    const current = deptCounters.find(c => Number(c.counterId) === Number(selectedCounterId));
    if (!current) {
      const openCounter = deptCounters.find(c => c.available);
      selectedCounterId = openCounter ? openCounter.counterId : deptCounters[0].counterId;
    }
  }

  function selectCounter(counterId, el) {
    selectedCounterId = Number(counterId);
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

  function formatDateTimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatHistoryTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);
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
    if (qSub && serving.counter) qSub.textContent = `${getDemographicText(serving)} · ${serving.counter}`;

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
        <td data-label="Priority"><span class="priority-chip ${p.priority}">${p.priority === 'high' ? 'High' : 'Normal'}</span></td>
        <td class="td-queue" data-label="Queue #">
          <div class="queue-line-code">${p.q}</div>
        </td>
        <td class="queue-line-patient" data-label="Patient">
          <div class="queue-line-name">${p.name}</div>
          <div class="queue-line-detail">${escapeHtml(p.reason || getDemographicText(p))}</div>
          ${p.aiSuggestedDepartment || (p.aiPriorityLevel && p.aiPriorityLevel !== 'normal') ? `
          <div class="queue-line-detail">
            ${p.aiSuggestedDepartment ? `Suggested: ${escapeHtml(p.aiSuggestedDepartment)}` : ''}
            ${p.aiPriorityLevel === 'urgent_review' ? `${p.aiSuggestedDepartment ? ' · ' : ''}Review: Needs staff review` : ''}
            ${p.aiPriorityLevel === 'priority' ? `${p.aiSuggestedDepartment ? ' · ' : ''}Review: priority` : ''}
          </div>
          ` : ''}
        </td>
        <td data-label="Status"><span class="status-badge ${p.status}">${p.status}</span></td>
        <td data-label="Counter">${p.counter}</td>
        <td class="ai-wait" data-label="AI Wait"><strong>${p.wait}</strong></td>
        <td data-label="Actions">
          <div class="action-btns">
	            <button class="act-btn" onclick="callPatient('${p.q}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
	              Call
	            </button>
	            <button class="act-btn" onclick="openHistoryModal(${p.queueId || 0})">
	              History
	            </button>
	            ${p.status === 'waiting' ? `
	            <button class="act-btn" onclick="cancelPatient(${p.queueId || 0}, '${p.q}')">
	              Cancel
	            </button>
	            ` : ''}
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

  function renderHistoryDepartmentOptions() {
    const select = document.getElementById('history-department');
    if (!select) return;

    select.innerHTML = '';

    if (currentRole === 'staff') {
      const dept = departments.find(d => String(d.id) === String(activeDept)) || departments[0];
      const option = document.createElement('option');
      option.value = dept ? dept.id : '';
      option.textContent = dept ? dept.name : 'Assigned department';
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    select.disabled = false;

    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All departments';
    select.appendChild(allOption);

    departments.forEach(dept => {
      const option = document.createElement('option');
      option.value = dept.id;
      option.textContent = dept.name;
      select.appendChild(option);
    });
  }

  function renderHistoryRows(rows) {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;
    latestHistoryRows = rows || [];

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="padding: 16px; color: var(--text3);">
            No queue history found.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = rows.map(row => `
      <tr>
        <td class="td-queue">${escapeHtml(row.code || row.queue_id || '')}</td>
        <td>${escapeHtml(row.full_name || 'Unknown patient')}</td>
        <td>${escapeHtml(row.department_name || '')}</td>
        <td>${escapeHtml(row.category || '')}</td>
        <td><span class="status-badge ${escapeHtml(row.status || '')}">${escapeHtml(row.status || '')}</span></td>
        <td>${escapeHtml(formatHistoryTime(row.created_at))}</td>
        <td>${escapeHtml(row.called_at ? formatHistoryTime(row.called_at) : '-')}</td>
        <td>${escapeHtml(row.finished_at ? formatHistoryTime(row.finished_at) : '-')}</td>
      </tr>
    `).join('');
  }

  async function loadHistoryPage() {
    renderHistoryDepartmentOptions();

    const tbody = document.getElementById('history-tbody');
    if (tbody) {
      tbody.innerHTML = `
          <tr>
            <td colspan="8" style="padding: 16px; color: var(--text3);">
              Loading queue history...
            </td>
          </tr>
      `;
    }

    const params = new URLSearchParams();
    const department = document.getElementById('history-department');
    const status = document.getElementById('history-status');
    const dateFrom = document.getElementById('history-date-from');
    const dateTo = document.getElementById('history-date-to');
    const search = document.getElementById('history-search');

    if (department && department.value && currentRole !== 'staff') params.set('department_id', department.value);
    if (status && status.value) params.set('status', status.value);
    if (dateFrom && dateFrom.value) params.set('date_from', dateFrom.value);
    if (dateTo && dateTo.value) params.set('date_to', dateTo.value);
    if (search && search.value.trim()) params.set('search', search.value.trim());

    try {
      const query = params.toString();
      const res = await fetch('/api/admin/history' + (query ? '?' + query : ''));
      const data = await readJsonResponse(res, 'Failed to load queue history');
      renderHistoryRows(data.history || []);
    } catch (err) {
      console.error(err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="padding: 16px; color: var(--red);">
              Failed to load queue history.
            </td>
          </tr>
        `;
      }
    }
  }

  function describeAiFilters(filters, counts = {}, mode = 'ai') {
    const parts = [];
    const recordCount = Number(counts.records || 0);
    const logCount = Number(counts.logs || 0);

    if (mode === 'fallback') parts.push('Fallback search');
    if (filters.date_from || filters.date_to) {
      parts.push(`${filters.date_from || 'any'} to ${filters.date_to || 'any'}`);
    }
    if (filters.status) parts.push(filters.status);
    if (filters.department) parts.push(filters.department);
    if (filters.keywords && filters.keywords.length) parts.push(filters.keywords.join(', '));
    parts.push(`${recordCount} queue record(s)`);
    parts.push(`${logCount} log row(s)`);
    return parts.join(' · ');
  }

  async function runHistoryAiSearch() {
    const input = document.getElementById('history-ai-prompt');
    const statusEl = document.getElementById('history-ai-status');
    const tbody = document.getElementById('history-tbody');
    const button = document.querySelector('.history-ai-btn');
    const prompt = input ? input.value.trim() : '';

    if (!prompt) {
      if (statusEl) statusEl.textContent = 'Enter a search prompt.';
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = 'Searching...';
    }
    if (statusEl) statusEl.textContent = 'Converting prompt to filters...';
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="padding: 16px; color: var(--text3);">
            Searching queue history...
          </td>
        </tr>
      `;
    }

    try {
      const res = await fetch('/api/admin/history/ai-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await readJsonResponse(res, 'AI search failed');

      if (!data.success) {
        throw new Error(data.message || data.error || 'AI search failed');
      }

      const rows = data.results || data.history || [];
      renderHistoryRows(rows);
      if (statusEl) {
        const statusParts = [];
        if (data.mode === 'fallback') {
          statusParts.push(data.message || 'AI search was unavailable, so normal search was used.');
        }
        statusParts.push(describeAiFilters(
          data.filters || {},
          {
            records: rows.length,
            logs: (data.logs || []).length
          },
          data.mode || 'ai'
        ));
        statusEl.textContent = statusParts.filter(Boolean).join(' · ');
      }
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = err.message || 'AI search failed';
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="padding: 16px; color: var(--red);">
              AI search failed. Try regular filters.
            </td>
          </tr>
        `;
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Search';
      }
    }
  }

  async function resetHistoryFiltersAndReload() {
    const department = document.getElementById('history-department');
    const status = document.getElementById('history-status');
    const dateFrom = document.getElementById('history-date-from');
    const dateTo = document.getElementById('history-date-to');
    const search = document.getElementById('history-search');
    const aiPrompt = document.getElementById('history-ai-prompt');
    const aiStatus = document.getElementById('history-ai-status');

    if (status) status.value = '';
    if (dateFrom) dateFrom.value = '';
    if (dateTo) dateTo.value = '';
    if (search) search.value = '';
    if (aiPrompt) aiPrompt.value = '';
    if (aiStatus) aiStatus.textContent = '';

    if (department && !department.disabled) {
      department.value = '';
    }

    await loadHistoryPage();
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
    const dept = departments.find(d => String(d.id) === String(activeDept));
    const statusSelect = document.getElementById('dept-status-select');
    const pauseInput = document.getElementById('dept-pause-message');
    const pausedUntilInput = document.getElementById('dept-paused-until');
    const displayLink = document.getElementById('open-display-link');
    if (statusSelect && dept) statusSelect.value = dept.queueStatus || 'open';
    if (pauseInput && dept) pauseInput.value = dept.pauseMessage || '';
    if (pausedUntilInput && dept) pausedUntilInput.value = formatDateTimeLocal(dept.pausedUntil);
    if (displayLink) {
      displayLink.href = activeDept ? `/display?department_id=${encodeURIComponent(activeDept)}` : '/display';
    }
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

    if (p === 'dept') {
      refreshDepartmentOverview().catch(err => {
        console.error(err);
        showToast('Failed to refresh departments');
      });
    }

    if (p === 'settings') {
      loadSettingsPage();
    }

    if (p === 'history') {
      loadHistoryPage();
    }
  }

  async function loadSettingsPage() {
    if (currentRole === 'staff') {
      showToast('Settings are only available to admins');
      showPage('queue');
      return;
    }

    await loadDepartmentsForCounterForm();
    await loadDepartmentsForScheduleForm();
    await loadCountersSettings();
    await loadScheduleSettings();
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

  const scheduleDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function getScheduleDayOptions(selectedDay) {
    return scheduleDayNames.map((day, index) => `
      <option value="${index}" ${Number(selectedDay) === index ? 'selected' : ''}>${day}</option>
    `).join('');
  }

  async function loadDepartmentsForScheduleForm() {
    const select = document.getElementById('schedule-department');
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

  function getScheduleCreatePayload() {
    const isClosed = document.getElementById('schedule-is-closed').checked;
    const dayOfWeeks = Array.from(document.querySelectorAll('.schedule-day-checkbox:checked'))
      .map(checkbox => checkbox.value);

    return {
      departmentId: document.getElementById('schedule-department').value,
      dayOfWeeks,
      opensAt: document.getElementById('schedule-opens-at').value,
      closesAt: document.getElementById('schedule-closes-at').value,
      isClosed,
      note: document.getElementById('schedule-note').value.trim()
    };
  }

  function validateSchedulePayload(payload) {
    if (!payload.departmentId) return 'Select a department';
    if (payload.dayOfWeeks && payload.dayOfWeeks.length === 0) return 'Select at least one day';
    if (!payload.dayOfWeeks && payload.dayOfWeek === '') return 'Select a day';
    if (!payload.isClosed) {
      if (!payload.opensAt || !payload.closesAt) return 'Enter open and close times';
      if (payload.closesAt <= payload.opensAt) return 'Close time must be after open time';
    }
    return '';
  }

  function setScheduleTimeDisabled(prefix, disabled) {
    const opens = document.getElementById(prefix + '-opens-at');
    const closes = document.getElementById(prefix + '-closes-at');
    if (opens) opens.disabled = disabled;
    if (closes) closes.disabled = disabled;
  }

  async function loadScheduleSettings() {
    const tbody = document.getElementById('settings-schedules-tbody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/admin/schedules');
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load schedules');
      }

      const schedules = data.schedules || [];

      if (!schedules.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" style="padding: 16px; color: var(--text3);">
              No schedules configured yet.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = schedules.map(schedule => {
        const isClosed = Number(schedule.is_closed) === 1 || schedule.is_closed === true;
        const hoursText = isClosed ? 'Closed all day' : `${schedule.opens_at || ''} - ${schedule.closes_at || ''}`;
        return `
          <tr>
            <td>
              <select id="schedule-row-department-${schedule.schedule_id}">
                ${getDepartmentOptions(schedule.department_id)}
              </select>
            </td>
            <td>
              <select id="schedule-row-day-${schedule.schedule_id}">
                ${getScheduleDayOptions(schedule.day_of_week)}
              </select>
            </td>
            <td>
              <div class="schedule-row-hours">
                <label>
                  <input
                    type="checkbox"
                    id="schedule-row-is-closed-${schedule.schedule_id}"
                    ${isClosed ? 'checked' : ''}
                    onchange="setScheduleRowClosed(${schedule.schedule_id}, this.checked)"
                  >
                  Closed
                </label>
                <input type="time" id="schedule-row-opens-at-${schedule.schedule_id}" value="${schedule.opens_at || ''}" ${isClosed ? 'disabled' : ''} aria-label="${hoursText}">
                <input type="time" id="schedule-row-closes-at-${schedule.schedule_id}" value="${schedule.closes_at || ''}" ${isClosed ? 'disabled' : ''}>
              </div>
            </td>
            <td>
              <input type="text" id="schedule-row-note-${schedule.schedule_id}" value="${escapeHtml(schedule.note || '')}" placeholder="Optional note">
            </td>
            <td>
              <div class="action-btns">
                <button class="act-btn" onclick="saveSchedule(${schedule.schedule_id})">Save</button>
                <button class="act-btn del" onclick="deleteSchedule(${schedule.schedule_id})">Delete</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to load schedules');
    }
  }

  function setScheduleRowClosed(scheduleId, checked) {
    const opens = document.getElementById('schedule-row-opens-at-' + scheduleId);
    const closes = document.getElementById('schedule-row-closes-at-' + scheduleId);
    if (opens) opens.disabled = checked;
    if (closes) closes.disabled = checked;
  }

  function setScheduleCreateDays(days) {
    const selectedDays = new Set(days.map(String));
    document.querySelectorAll('.schedule-day-checkbox').forEach(checkbox => {
      checkbox.checked = selectedDays.has(checkbox.value);
    });
  }

  function attachScheduleForm() {
    const form = document.getElementById('schedule-form');
    if (!form || form.dataset.bound === '1') return;

    form.dataset.bound = '1';

    const closedToggle = document.getElementById('schedule-is-closed');
    if (closedToggle) {
      closedToggle.addEventListener('change', e => {
        setScheduleTimeDisabled('schedule', e.target.checked);
      });
    }

    document.querySelectorAll('.schedule-day-action').forEach(button => {
      button.addEventListener('click', () => {
        const selector = button.dataset.daySelector;
        if (selector === 'weekdays') setScheduleCreateDays([1, 2, 3, 4, 5]);
        if (selector === 'weekend') setScheduleCreateDays([0, 6]);
        if (selector === 'all') setScheduleCreateDays([0, 1, 2, 3, 4, 5, 6]);
      });
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();

      const payload = getScheduleCreatePayload();
      const validation = validateSchedulePayload(payload);

      if (validation) {
        showToast(validation);
        return;
      }

      try {
        for (const dayOfWeek of payload.dayOfWeeks) {
          const res = await fetch('/api/admin/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              departmentId: payload.departmentId,
              dayOfWeek,
              opensAt: payload.opensAt,
              closesAt: payload.closesAt,
              isClosed: payload.isClosed,
              note: payload.note
            })
          });
          const data = await res.json();

          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Failed to save schedule');
          }
        }

        form.reset();
        setScheduleTimeDisabled('schedule', false);
        await loadScheduleSettings();
        showToast(payload.dayOfWeeks.length === 1 ? 'Schedule saved' : 'Schedules saved');
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Failed to save schedule');
      }
    });
  }

  async function saveSchedule(scheduleId) {
    const payload = {
      departmentId: document.getElementById('schedule-row-department-' + scheduleId).value,
      dayOfWeek: document.getElementById('schedule-row-day-' + scheduleId).value,
      opensAt: document.getElementById('schedule-row-opens-at-' + scheduleId).value,
      closesAt: document.getElementById('schedule-row-closes-at-' + scheduleId).value,
      isClosed: document.getElementById('schedule-row-is-closed-' + scheduleId).checked,
      note: document.getElementById('schedule-row-note-' + scheduleId).value.trim()
    };
    const validation = validateSchedulePayload(payload);

    if (validation) {
      showToast(validation);
      return;
    }

    try {
      const res = await fetch('/api/admin/schedules/' + scheduleId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update schedule');
      }

      await loadScheduleSettings();
      showToast('Schedule updated');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to update schedule');
    }
  }

  async function deleteSchedule(scheduleId) {
    const ok = confirm('Delete this schedule?');
    if (!ok) return;

    try {
      const res = await fetch('/api/admin/schedules/' + scheduleId, { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete schedule');
      }

      await loadScheduleSettings();
      showToast('Schedule deleted');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to delete schedule');
    }
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

    const dept = departments.find(d => String(d.id) === String(id));
    queueOpen = !dept || dept.queueStatus === 'open';
    selectedCounterId = null;
    syncSelectedCounter();

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
    renderQueueControls();
    switchTab('main', document.querySelector('.tab-btn'));
  }


  function switchTab(tab, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
  }


  async function recallCurrentQueue() {
    const serving = patients.find(p => p.status === 'serving');

    if (!serving) {
      showToast('No patient is currently serving');
      return;
    }

    try {
      const res = await fetch('/api/admin/queues/' + serving.queueId + '/recall', {
        method: 'POST'
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to recall queue');
      }

      showToast(data.message || ('Recalled ' + serving.q));
    } catch (err) {
      console.error(err);
      showToast('Failed to recall queue');
    }
  }

  function recallQueue() {
    recallCurrentQueue();
  }

  async function callNextPatient() {
    if (isCallingNext) return;

    if (!activeDept) {
      showToast('No department selected');
      return;
    }

    const callNextButtons = Array.from(document.querySelectorAll('button[onclick="callNextPatient()"]'));

    try {
      isCallingNext = true;
      callNextButtons.forEach(btn => {
        btn.disabled = true;
      });

      const res = await fetch('/api/admin/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department_id: activeDept,
          counter_id: selectedCounterId
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to call next patient');
      }

      await fetchDepartmentQueues(activeDept);
      await fetchDepartmentStats(activeDept);
      await refreshDepartmentOverview();

      renderNextList();
      renderTable();
      renderNowServingCard();
      renderStats();

      if (data.completed_queue) {
        await showCompletedTransferPanel(data.completed_queue);
      } else {
        dismissTransferPanel();
      }

      if (data.next) {
        showToast(data.message || ('Now serving ' + data.next.code));
      } else {
        showToast('No waiting patients in this department');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to call next patient');
    } finally {
      isCallingNext = false;
      callNextButtons.forEach(btn => {
        btn.disabled = false;
      });
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
      await refreshDepartmentOverview();

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
      await refreshDepartmentOverview();
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

  async function cancelPatient(queueId, qCode) {
    if (!queueId) return;

    try {
      const res = await fetch('/api/admin/cancel/' + queueId, { method: 'PATCH' });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to cancel queue');
      }

      await fetchDepartmentQueues(activeDept);
      await fetchDepartmentStats(activeDept);
      await refreshDepartmentOverview();
      renderTable();
      renderNextList();
      renderNowServingCard();
      renderStats();
      showToast('Queue #' + qCode + ' cancelled');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to cancel queue');
    }
  }

  async function saveDepartmentStatus() {
    if (!activeDept) {
      showToast('No department selected');
      return;
    }

    const status = document.getElementById('dept-status-select').value;
    const pauseMessage = document.getElementById('dept-pause-message').value.trim();
    const pausedUntilRaw = document.getElementById('dept-paused-until').value;
    const pausedUntil = pausedUntilRaw ? pausedUntilRaw.replace('T', ' ') + ':00' : null;

    try {
      const res = await fetch('/api/admin/departments/' + activeDept + '/queue-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queue_status: status,
          pause_message: pauseMessage,
          paused_until: pausedUntil
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update department status');
      }

      const dept = departments.find(d => String(d.id) === String(activeDept));
      if (dept) {
        dept.queueStatus = data.queue_status;
        dept.pauseMessage = data.pause_message || '';
        dept.pausedUntil = data.paused_until || '';
      }

      queueOpen = data.queue_status === 'open';
      await refreshDepartmentOverview();
      renderQueueControls();
      showToast('Department status updated');
    } catch (err) {
      console.error(err);
      showToast(err.message);
    }
  }

  async function loadTransferDepartments() {
    const res = await fetch('/api/departments/status');
    const data = await readJsonResponse(res, 'Failed to load departments');

    return (data.departments || []).map(dept => ({
      id: Number(dept.department_id),
      name: dept.name,
      queueStatus: dept.queue_status || 'open'
    }));
  }

  async function showCompletedTransferPanel(sourceQueue) {
    if (!sourceQueue || !sourceQueue.queue_id) return;
    const panel = document.getElementById('queue-transfer-panel');
    const select = document.getElementById('transfer-department');
    const notesEl = document.getElementById('transfer-notes');

    if (!panel || !select || !notesEl) return;

    transferQueueId = Number(sourceQueue.queue_id);
    transferSourceQueue = sourceQueue;

    const sourceDepartmentId = sourceQueue.department_id || activeDept;
    let transferDepartments = [];

    try {
      transferDepartments = await loadTransferDepartments();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to load departments');
      return;
    }

    const options = transferDepartments
      .filter(dept => String(dept.id) !== String(sourceDepartmentId))
      .map(dept => `
	        <option value="${dept.id}" ${dept.queueStatus !== 'open' ? 'disabled' : ''}>
	          ${dept.name} (${dept.queueStatus})
	        </option>
	      `).join('');

    select.innerHTML = options || '<option value="">No available target departments</option>';

    const sourceEl = document.getElementById('transfer-source');
    if (sourceEl) {
      const sourceCode = sourceQueue.code || sourceQueue.q || sourceQueue.queue_id;
      const sourceName = sourceQueue.full_name || sourceQueue.name || 'Unknown patient';
      const sourceDepartment = sourceQueue.department_name || '';
      sourceEl.textContent = `${sourceCode} - ${sourceName}${sourceDepartment ? ' · ' + sourceDepartment : ''}`;
    }

    notesEl.value = '';
    panel.classList.remove('hidden');
  }

  function dismissTransferPanel() {
    transferQueueId = null;
    transferSourceQueue = null;
    const panel = document.getElementById('queue-transfer-panel');
    if (panel) panel.classList.add('hidden');
  }

  function openTransferModal(queueId) {
    showToast('Transfer is available after pressing Call Next on a serving patient');
  }

  function closeTransferModal() {
    dismissTransferPanel();
  }

  function closeTransferModalOuter(e) {
    dismissTransferPanel();
  }

  async function submitTransfer() {
    if (!transferQueueId) return;

    const toDepartmentId = document.getElementById('transfer-department').value;
    const notes = document.getElementById('transfer-notes').value.trim();

    if (!toDepartmentId) {
      showToast('Select a target department');
      return;
    }

    try {
      const res = await fetch('/api/admin/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queue_id: transferQueueId,
          target_department_id: toDepartmentId,
          reason: notes
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to transfer queue');
      }

      dismissTransferPanel();
      await fetchDepartmentQueues(activeDept);
      await fetchDepartmentStats(activeDept);
      await refreshDepartmentOverview();
      renderTable();
      renderNextList();
      renderNowServingCard();
      renderStats();
      showToast(data.message || 'Patient transferred successfully');
    } catch (err) {
      console.error(err);
      showToast(err.message);
    }
  }

  async function openHistoryModal(queueId) {
    if (!queueId) return;

    const list = document.getElementById('history-list');
    list.textContent = 'Loading history...';
    document.getElementById('history-modal-overlay').classList.add('open');

    try {
      const res = await fetch('/api/admin/queues/' + queueId + '/history');
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load history');
      }

      if (!data.logs.length) {
        list.innerHTML = `<div class="empty-state">No history recorded for this queue.</div>`;
        return;
      }

      list.innerHTML = data.logs.map(log => {
        const actor = log.actor_name || 'System';
        const counter = log.counter_name ? ` · ${log.counter_name}` : '';
        const transfer = log.action === 'transferred'
          ? ` · ${log.from_department_name || 'Previous department'} to ${log.to_department_name || 'new department'}`
          : '';
        const notes = log.notes ? `<div class="history-note">${log.notes}</div>` : '';

        return `
	          <div class="history-item">
	            <div class="history-main">${log.action.replace('_', ' ')}${counter}${transfer}</div>
	            <div class="history-meta">${actor} · ${formatHistoryTime(log.created_at)}</div>
	            ${notes}
	          </div>
	        `;
      }).join('');
    } catch (err) {
      console.error(err);
      list.innerHTML = `<div class="empty-state">Failed to load queue history.</div>`;
    }
  }

  function closeHistoryModal() {
    document.getElementById('history-modal-overlay').classList.remove('open');
  }

  function closeHistoryModalOuter(e) {
    if (e.target === document.getElementById('history-modal-overlay')) closeHistoryModal();
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
      const res = await fetch('/api/admin/departments/' + activeDept + '/queue-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueOpen: true })
      });
      if (!res.ok) throw new Error('Failed to open queue');
      const dept = departments.find(d => String(d.id) === String(activeDept));
      if (dept) dept.queueStatus = 'open';
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
      const res = await fetch('/api/admin/departments/' + activeDept + '/queue-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueOpen: false })
      });
      if (!res.ok) throw new Error('Failed to close queue');
      const dept = departments.find(d => String(d.id) === String(activeDept));
      if (dept) dept.queueStatus = 'closed';
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
    const firstName = document.getElementById('f-first').value.trim();
    const lastName = document.getElementById('f-last').value.trim();
    const name = `${firstName} ${lastName}`.trim();
    const sex = document.getElementById('f-gender').value;
    const ageRaw = document.getElementById('f-age').value;
    const reason = document.getElementById('f-notes').value.trim() || 'Walk-in queue entry';
    if (!name || !sex || !ageRaw) {
      alert('Please complete all required fields: first name, last name, gender, and age.');
      return;
    }
    const age = parseInt(ageRaw, 10);
    if (Number.isNaN(age) || age < 0) { alert('Please enter a valid age.'); return; }
    const priority = document.getElementById('f-priority').value;
    const counter = document.getElementById('f-counter').value;
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
            + (counter ? ' | Preferred counter: ' + counter : '')
            + (sex ? ' | Gender: ' + sex : '')
            + (ageRaw ? ' | Age: ' + ageRaw : ''),
          queueType: priority === 'high' ? 'pwd' : 'regular',
          priority: priority
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create queue');
      await refreshDepartmentOverview();
      await fetchDepartmentQueues(activeDept);
      renderTable();
      renderNextList();
      renderNowServingCard();
      closeModal();
      ['f-first', 'f-last', 'f-age', 'f-notes'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('f-gender').value = 'M';
      document.getElementById('f-priority').value = 'medium';
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
  window.recallCurrentQueue = recallCurrentQueue;
  window.skipQueue = skipQueue;
  window.callPatient = callPatient;
  window.deletePatient = deletePatient;
  window.cancelPatient = cancelPatient;
  window.saveDepartmentStatus = saveDepartmentStatus;
  window.openTransferModal = openTransferModal;
  window.closeTransferModal = closeTransferModal;
  window.closeTransferModalOuter = closeTransferModalOuter;
  window.dismissTransferPanel = dismissTransferPanel;
  window.submitTransfer = submitTransfer;
  window.openHistoryModal = openHistoryModal;
  window.closeHistoryModal = closeHistoryModal;
  window.closeHistoryModalOuter = closeHistoryModalOuter;
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
  window.loadHistoryPage = loadHistoryPage;
  window.runHistoryAiSearch = runHistoryAiSearch;
  window.loadScheduleSettings = loadScheduleSettings;
  window.saveSchedule = saveSchedule;
  window.deleteSchedule = deleteSchedule;
  window.setScheduleRowClosed = setScheduleRowClosed;


  (async function initDashboard() {
    try {
      await loadCurrentUser();
      await fetchBootstrapData();
      renderDepts();
      applyRoleUI();
      loadDepartmentsForStaffForm();
      attachStaffForm();
      attachCounterForm();
      attachScheduleForm();
      const historyAiPrompt = document.getElementById('history-ai-prompt');
      if (historyAiPrompt) {
        historyAiPrompt.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            runHistoryAiSearch();
          }
        });
      }
      const historySearch = document.getElementById('history-search');
      if (historySearch) {
        historySearch.addEventListener('input', e => {
          if (String(e.target.value || '').trim() === '') {
            resetHistoryFiltersAndReload().catch(err => {
              console.error(err);
            });
          }
        });
      }
      renderQueueControls();

      loadNotifications().catch(err => {
        console.error(err);
      });

      if (departments.length > 0) {
        activeDept = departments[0].id;
        queueOpen = departments[0].queueStatus === 'open';
        document.getElementById('active-dept-name').textContent = departments[0].name;

        if (departments.length === 1) {
          showPage('queue');
        }

        try {
          await fetchDepartmentQueues(activeDept);
          await fetchDepartmentStats(activeDept);
        } catch (err) {
          console.error(err);
          showToast(err.message);
        }
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to load dashboard data');
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

      const staffAccounts = data.staff || [];
      const currentUserId = Number(data.current_user_id);

      if (!staffAccounts.length) {
        tbody.innerHTML = `
        <tr>
          <td colspan="7" style="color: var(--text3); padding: 16px;">
            No staff accounts found.
          </td>
        </tr>
      `;
        syncStaffBulkSelection();
        return;
      }

      tbody.innerHTML = staffAccounts.map(staff => {
        const isSelf = Number(staff.user_id) === currentUserId;
        const departmentOptions = [
          `<option value="">No department</option>`,
          ...departments.map(dept => `
            <option value="${dept.id}" ${Number(dept.id) === Number(staff.department_id) ? 'selected' : ''}>
              ${escapeHtml(dept.name)}
            </option>
          `)
        ].join('');

        return `
      <tr data-staff-row="${staff.user_id}">
        <td>
          <input
            type="checkbox"
            class="staff-row-checkbox"
            value="${staff.user_id}"
            ${isSelf ? 'disabled' : ''}
            aria-label="Select ${escapeHtml(staff.full_name || staff.username || 'staff account')}"
          >
        </td>
        <td>
          <input type="text" id="staff-name-${staff.user_id}" value="${escapeHtml(staff.full_name || '')}" disabled>
        </td>
        <td>
          <input type="text" id="staff-username-${staff.user_id}" value="${escapeHtml(staff.username || '')}" disabled>
        </td>
        <td>
          <input type="tel" id="staff-contact-${staff.user_id}" value="${escapeHtml(staff.contact_number || '')}" disabled>
        </td>
        <td>
          <select id="staff-role-${staff.user_id}" onchange="syncStaffRoleDepartment(${staff.user_id})" disabled>
            <option value="admin" ${staff.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="staff" ${staff.role === 'staff' ? 'selected' : ''}>Staff</option>
          </select>
        </td>
        <td>
          <select id="staff-dept-${staff.user_id}" disabled>
            ${departmentOptions}
          </select>
          <input type="password" id="staff-password-${staff.user_id}" placeholder="New password" autocomplete="new-password" disabled>
        </td>
        <td>
          <div class="action-btns">
            <button class="act-btn" id="staff-edit-${staff.user_id}" onclick="toggleStaffEdit(${staff.user_id})">Edit</button>
          </div>
        </td>
      </tr>
    `;
      }).join('');

      document.querySelectorAll('.staff-row-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', syncStaffBulkSelection);
      });
      staffAccounts.forEach(staff => syncStaffRoleDepartment(staff.user_id));
      syncStaffBulkSelection();
    } catch (err) {
      console.error(err);
      showToast('Failed to load staff accounts');
    }
  }

  function attachStaffForm() {
    const form = document.getElementById('staff-form');
    if (!form || form.dataset.bound === '1') return;

    form.dataset.bound = '1';

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

    const deleteSelectedButton = document.getElementById('staff-delete-selected');
    if (deleteSelectedButton) {
      deleteSelectedButton.addEventListener('click', deleteSelectedStaffAccounts);
    }

    const selectAll = document.getElementById('staff-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', () => {
        document.querySelectorAll('.staff-row-checkbox:not(:disabled)').forEach(checkbox => {
          checkbox.checked = selectAll.checked;
        });
        syncStaffBulkSelection();
      });
    }
  }

  function setStaffRowEditing(userId, editing) {
    const row = document.querySelector(`[data-staff-row="${userId}"]`);
    const editButton = document.getElementById('staff-edit-' + userId);
    if (!row || !editButton) return;

    row.dataset.editing = editing ? '1' : '0';
    ['name', 'username', 'contact', 'role', 'dept', 'password'].forEach(field => {
      const input = document.getElementById(`staff-${field}-${userId}`);
      if (input) input.disabled = !editing;
    });
    syncStaffRoleDepartment(userId);
    editButton.textContent = editing ? 'Save' : 'Edit';
  }

  function syncStaffRoleDepartment(userId) {
    const role = document.getElementById('staff-role-' + userId);
    const department = document.getElementById('staff-dept-' + userId);
    if (!role || !department) return;

    department.required = role.value === 'staff';
    department.disabled = role.disabled || role.value !== 'staff';
  }

  async function toggleStaffEdit(userId) {
    const row = document.querySelector(`[data-staff-row="${userId}"]`);
    if (!row) return;

    const isEditing = row.dataset.editing === '1';
    if (!isEditing) {
      setStaffRowEditing(userId, true);
      return;
    }

    await saveStaffAccount(userId);
  }

  async function saveStaffAccount(userId) {
    const fullName = document.getElementById('staff-name-' + userId).value.trim();
    const username = document.getElementById('staff-username-' + userId).value.trim();
    const contact = document.getElementById('staff-contact-' + userId).value.trim();
    const role = document.getElementById('staff-role-' + userId).value;
    const departmentId = document.getElementById('staff-dept-' + userId).value;
    const password = document.getElementById('staff-password-' + userId).value;

    if (!fullName || !username || !role) {
      showToast('Name, username, and role are required');
      return;
    }

    if (role === 'staff' && !departmentId) {
      showToast('Staff accounts require a department');
      return;
    }

    try {
      const res = await fetch('/api/admin/staff/' + userId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          username,
          contact,
          role,
          departmentId,
          password
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update staff account');
      }

      showToast('Staff account updated');
      await loadStaffAccounts();
    } catch (err) {
      console.error(err);
      showToast(err.message);
    }
  }

  function getSelectedStaffIds() {
    return Array.from(document.querySelectorAll('.staff-row-checkbox:checked'))
      .map(checkbox => Number(checkbox.value))
      .filter(Boolean);
  }

  function syncStaffBulkSelection() {
    const checkboxes = Array.from(document.querySelectorAll('.staff-row-checkbox:not(:disabled)'));
    const checked = checkboxes.filter(checkbox => checkbox.checked);
    const selectAll = document.getElementById('staff-select-all');
    const deleteSelectedButton = document.getElementById('staff-delete-selected');

    if (selectAll) {
      selectAll.checked = checkboxes.length > 0 && checked.length === checkboxes.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < checkboxes.length;
      selectAll.disabled = checkboxes.length === 0;
    }

    if (deleteSelectedButton) {
      deleteSelectedButton.disabled = checked.length === 0;
    }
  }

  async function deleteSelectedStaffAccounts() {
    const userIds = getSelectedStaffIds();
    if (!userIds.length) {
      showToast('Select at least one staff account');
      return;
    }

    const ok = confirm(`Delete ${userIds.length} selected staff account${userIds.length === 1 ? '' : 's'}?`);
    if (!ok) return;

    try {
      const res = await fetch('/api/admin/staff', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: userIds })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete selected staff accounts');
      }

      showToast(`${data.deleted_count || userIds.length} staff account${userIds.length === 1 ? '' : 's'} deleted`);
      await loadStaffAccounts();
    } catch (err) {
      console.error(err);
      showToast(err.message);
    }
  }

  window.toggleStaffEdit = toggleStaffEdit;
  window.syncStaffRoleDepartment = syncStaffRoleDepartment;




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
  let currentQueueStatus = null;
  let patientPoller = null;
  let isSubmittingQueue = false;
  let isCancellingQueue = false;
  let isQueueOpen = true;
  let suggestionTimer = null;
  let latestSuggestion = null;
  let lastSuggestedConcern = '';
  let isSuggesting = false;

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
  const cancelQueueBtn = document.getElementById('btn-cancel-queue');
  const submitBtn = addQueueForm ? addQueueForm.querySelector('button[type="submit"]') : null;
  const suggestBtn = document.getElementById('btn-suggest-department');
  const suggestionStatus = document.getElementById('suggestion-status');

  function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  async function loadPatientProfile() {
    const account = document.getElementById('patient-account');
    if (!account) return;

    try {
      const res = await fetch('/api/me');
      const data = await res.json();

      if (!res.ok || !data.success || !data.user) return;

      const nameEl = document.getElementById('patient-account-name');
      const emailEl = document.getElementById('patient-account-email');

      if (nameEl) {
        nameEl.textContent = data.user.full_name || data.user.username || 'Patient';
      }

      if (emailEl) {
        emailEl.textContent = data.user.email || '';
      }

      account.hidden = false;
    } catch (err) {
      console.error('Failed to load patient profile', err);
    }
  }

  function setSuggestionStatus(message) {
    if (!suggestionStatus) return;
    suggestionStatus.textContent = message || '';
  }

  function applySuggestedDepartment(departmentName) {
    if (!addQueueForm || !departmentName) return false;
    const select = addQueueForm.serviceType;
    if (!select) return false;

    const option = Array.from(select.options).find(
      opt => String(opt.value || '').trim().toLowerCase() === String(departmentName).trim().toLowerCase()
    );

    if (!option) return false;
    select.value = option.value;
    return true;
  }

  async function requestVisitSuggestion(source = 'auto') {
    if (!addQueueForm) return;

    const concern = addQueueForm.concern.value.trim();
    if (concern.length < 8) {
      latestSuggestion = null;
      if (source === 'button') {
        showToast('Enter more details before requesting a suggestion.');
      }
      setSuggestionStatus('');
      return;
    }

    if (isSuggesting) return;

    isSuggesting = true;
    if (suggestBtn) {
      suggestBtn.disabled = true;
      suggestBtn.textContent = 'Suggesting...';
    }
    setSuggestionStatus('Checking suggestion...');

    try {
      const res = await fetch('/api/queue/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concern })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Suggestion failed');
      }

      latestSuggestion = data.ai || null;
      lastSuggestedConcern = concern;

      if (!data.ai) {
        setSuggestionStatus(data.message || 'Suggestion unavailable. You can still add to queue.');
        if (source === 'button') {
          showToast(data.message || 'Suggestion unavailable');
        }
        return;
      }

      const selected = data.ai.suggested_department
        ? applySuggestedDepartment(data.ai.suggested_department)
        : false;
      const reviewText = data.ai.priority_level === 'urgent_review'
        ? 'Needs staff review'
        : data.ai.priority_level === 'priority'
          ? 'Priority'
          : 'Normal';
      const deptText = data.ai.suggested_department
        ? `Suggested department: ${data.ai.suggested_department}${selected ? ' (applied)' : ''}`
        : 'No department suggestion';
      setSuggestionStatus(`${deptText} · Review: ${reviewText}. Suggestion only.`);
    } catch (err) {
      console.error(err);
      latestSuggestion = null;
      setSuggestionStatus('Suggestion unavailable. You can still add to queue.');
      if (source === 'button') {
        showToast(err.message || 'Suggestion unavailable');
      }
    } finally {
      isSuggesting = false;
      if (suggestBtn) {
        suggestBtn.disabled = !isQueueOpen;
        suggestBtn.textContent = 'Suggest Department';
      }
    }
  }

  function scheduleVisitSuggestion() {
    if (!addQueueForm) return;
    clearTimeout(suggestionTimer);
    suggestionTimer = setTimeout(() => {
      const concern = addQueueForm.concern.value.trim();
      if (concern.length < 8) {
        latestSuggestion = null;
        setSuggestionStatus('');
        return;
      }
      if (concern === lastSuggestedConcern) return;
      requestVisitSuggestion('auto').catch(err => {
        console.error(err);
      });
    }, 800);
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
    if (suggestBtn && !addQueueForm.classList.contains('hidden')) {
      suggestBtn.disabled = !open;
      if (!isSuggesting) suggestBtn.textContent = 'Suggest Department';
    }

    if (completeFormPrompt && !open && !addQueueForm.classList.contains('hidden')) {
      completeFormPrompt.textContent = 'Queue is currently closed';
    }

    if (completeFormPrompt && open && !addQueueForm.classList.contains('hidden')) {
      completeFormPrompt.textContent = 'Complete the form to join';
    }
  }

  function setCancelQueueVisible(visible) {
    if (!cancelQueueBtn) return;
    cancelQueueBtn.classList.toggle('hidden', !visible);
    cancelQueueBtn.disabled = isCancellingQueue;
  }

  function showQueueState(code, ahead, patientName = 'Joined', departmentName = '', status = 'waiting', ai = null, referralMessage = '') {
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
    const aiNote = document.getElementById('now-ai-note');
    if (aiNote) {
      if (referralMessage) {
        aiNote.textContent = referralMessage;
      } else if (ai && ai.suggested_department) {
        aiNote.textContent = `Suggested department: ${ai.suggested_department}. Note: Suggestion only. Clinic staff may change this.`;
      } else {
        aiNote.textContent = '';
      }
    }

    if (aheadStatus) {
      aheadStatus.textContent = Number(ahead || 0);
    }

    if (estWait) {
      estWait.textContent = `${Number(ahead || 0) * 5}m`;
    }

    setCancelQueueVisible(status === 'waiting');
  }

  function showJoinForm() {
    if (completeFormPrompt) {
      completeFormPrompt.classList.remove('hidden');
      completeFormPrompt.textContent = isQueueOpen ? 'Complete the form to join' : 'Queue is currently closed';
    }

    if (addQueueForm) {
      addQueueForm.classList.remove('hidden');
    }
    latestSuggestion = null;
    lastSuggestedConcern = '';
    setSuggestionStatus('');

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
    const aiNote = document.getElementById('now-ai-note');
    if (aiNote) {
      aiNote.textContent = '';
    }

    if (aheadStatus) {
      aheadStatus.textContent = '0';
    }

    if (estWait) {
      estWait.textContent = '0m';
    }

    setCancelQueueVisible(false);
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
      currentQueueStatus = data.status;

      showQueueState(
        data.code,
        data.ahead,
        data.full_name,
        data.department_name,
        data.status,
        data.ai || null,
        data.referral_message || ''
      );
      renderPatientSchedules();

      startPolling();
    } else {
      departmentId = null;
      currentQueueStatus = null;
      showJoinForm();
      renderPatientSchedules();
      attachForm();
    }
  }

  async function cancelCurrentQueue() {
    if (isCancellingQueue) return;

    const previousDepartmentId = departmentId;

    try {
      isCancellingQueue = true;
      setCancelQueueVisible(true);

      const res = await fetch('/api/queue/cancel', {
        method: 'PATCH'
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to cancel queue');
      }

      showToast('Queue cancelled');
      await refreshPatientStatus();
      await loadDepartmentStatuses();

      if (previousDepartmentId) {
        await loadQueue(previousDepartmentId);
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to cancel queue');
    } finally {
      isCancellingQueue = false;
      setCancelQueueVisible(currentQueueStatus === 'waiting');
    }
  }

  function attachForm() {
    if (!addQueueForm || addQueueForm.dataset.bound === '1') return;

    addQueueForm.dataset.bound = '1';

    if (suggestBtn) {
      suggestBtn.addEventListener('click', () => {
        requestVisitSuggestion('button').catch(err => {
          console.error(err);
        });
      });
    }
    if (addQueueForm.concern) {
      addQueueForm.concern.addEventListener('input', () => {
        scheduleVisitSuggestion();
      });
    }

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
        const concernForSubmit = addQueueForm.concern.value.trim();
        const aiPayload = concernForSubmit && concernForSubmit === lastSuggestedConcern
          ? latestSuggestion
          : null;
        const res = await fetch('/api/queue/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientName,
            serviceType,
            queueType,
            priority: queueType === 'pwd' ? 'high' : 'medium',
            concern,
            ai: aiPayload
          })
        });

        const data = await res.json();

        if (res.status === 409) {
          showToast(data.message || data.error || 'You already have an active queue.');
          await refreshPatientStatus();
          return;
        }

        if (res.status === 403) {
          showToast(data.message || data.error || 'Queue is currently closed.');
          await refreshPatientStatus();
          return;
        }

        if (!res.ok || !data.success) {
          showToast(data.message || data.error || 'Failed to join queue');
          return;
        }

        showToast('Queued: ' + data.code);

        departmentId = data.department_id;

        showQueueState(
          data.code,
          data.ahead,
          patientName,
          serviceType,
          'waiting',
          data.ai || null
        );
        renderPatientSchedules();

        startPolling();
      } catch (err) {
        console.error(err);
        showToast('Server error');
      } finally {
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
      li.classList.add('queue-item');

      const main = document.createElement('div');
      main.className = 'queue-item-main';

      const code = document.createElement('div');
      code.className = 'queue-item-code';
      code.textContent = q.code || '---';
      main.appendChild(code);

      if (q.full_name) {
        const name = document.createElement('div');
        name.className = 'queue-item-name';
        name.textContent = q.full_name;
        main.appendChild(name);
      }

      const status = document.createElement('span');
      status.className = 'queue-item-status';
      status.textContent = q.status || 'waiting';

      li.appendChild(main);
      li.appendChild(status);
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
        await loadDepartmentStatuses();

        if (departmentId) {
          await loadQueue(departmentId);
        }
      } catch (err) {
        console.error(err);
      }
    }, 5000);
  }

  const logoutBtn = document.getElementById('btn-logout');

  if (cancelQueueBtn) {
    cancelQueueBtn.addEventListener('click', cancelCurrentQueue);
  }

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
      await loadPatientProfile();
      await loadDepartmentStatuses();
      await refreshPatientStatus();
    } catch (err) {
      console.error(err);
      showToast('Failed to load queue status');
      attachForm();
    }
  });

  let departmentStatuses = [];

  async function loadDepartmentStatuses() {
    const list = document.getElementById('dept-status-list');
    const select = document.getElementById('inp-service');

    if (!list) return;

    try {
      const res = await fetch('/api/departments/status');
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load departments');
      }

      departmentStatuses = data.departments || [];

      renderDepartmentStatuses();
      syncDepartmentSelect();
      renderPatientSchedules();
    } catch (err) {
      console.error(err);

      list.innerHTML = `
      <div class="empty-state">Failed to load department status.</div>
    `;
    }
  }

  function renderDepartmentStatuses() {
    const list = document.getElementById('dept-status-list');
    if (!list) return;

    if (!departmentStatuses.length) {
      list.innerHTML = `<div class="empty-state">No departments found.</div>`;
      return;
    }

    list.innerHTML = departmentStatuses.map(dept => {
      const status = dept.queue_status || 'open';
      const label = status === 'open' ? 'Open' : status === 'pause' ? 'Paused' : 'Closed';

      return `
      <div class="dept-status-item">
        <div class="dept-status-name">${dept.name}</div>
        <div class="dept-status-meta">${Number(dept.active_count || 0)} active queue(s)</div>
        <span class="dept-status-badge ${status}">${label}</span>
      </div>
    `;
    }).join('');
  }

  const patientScheduleDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function formatPatientScheduleTime(value) {
    if (!value) return '';
    const [hour, minute] = String(value).split(':');
    const hourNumber = Number(hour);
    if (!Number.isFinite(hourNumber)) return value;
    const suffix = hourNumber >= 12 ? 'PM' : 'AM';
    const displayHour = hourNumber % 12 || 12;
    return `${displayHour}:${minute || '00'} ${suffix}`;
  }

  function getScheduleDepartmentsForDisplay() {
    const select = document.getElementById('inp-service');
    const selectedName = select && select.value ? select.value : '';

    if (departmentId) {
      return departmentStatuses.filter(dept => Number(dept.department_id) === Number(departmentId));
    }

    if (selectedName) {
      const selected = departmentStatuses.find(dept => dept.name === selectedName);
      if (selected) return [selected];
    }

    return departmentStatuses.filter(dept => (dept.schedules || []).length);
  }

  function renderPatientSchedules() {
    const container = document.getElementById('department-schedule');
    if (!container) return;

    container.innerHTML = '';

    const departmentsToShow = getScheduleDepartmentsForDisplay();
    const today = new Date().getDay();
    const hasSchedules = departmentsToShow.some(dept => (dept.schedules || []).length);

    if (!hasSchedules) {
      container.className = 'schedule-placeholder';
      container.innerHTML = `
        <div class="schedule-icon" aria-hidden="true">Cal</div>
        <div>
          <div class="schedule-title">No configured schedule yet</div>
          <p>
            Department open schedules are not available from the backend yet.
            Please use the secretary contact in the topbar for fallback assistance.
          </p>
        </div>
      `;
      return;
    }

    container.className = 'schedule-list';

    departmentsToShow.forEach(dept => {
      const schedules = [...(dept.schedules || [])].sort((a, b) => Number(a.day_of_week) - Number(b.day_of_week));
      if (!schedules.length) return;

      const group = document.createElement('div');
      group.className = 'schedule-group';

      const title = document.createElement('div');
      title.className = 'schedule-group-title';
      title.textContent = dept.name;
      group.appendChild(title);

      schedules.forEach(schedule => {
        const row = document.createElement('div');
        const day = Number(schedule.day_of_week);
        const isClosed = Number(schedule.is_closed) === 1 || schedule.is_closed === true;
        row.className = 'schedule-row' + (day === today ? ' today' : '');

        const dayEl = document.createElement('div');
        dayEl.className = 'schedule-day';
        dayEl.textContent = patientScheduleDayNames[day] || 'Day';

        const timeEl = document.createElement('div');
        timeEl.className = 'schedule-time';
        timeEl.textContent = isClosed
          ? 'Closed'
          : `${formatPatientScheduleTime(schedule.opens_at)} - ${formatPatientScheduleTime(schedule.closes_at)}`;

        row.appendChild(dayEl);
        row.appendChild(timeEl);

        if (schedule.note) {
          const noteEl = document.createElement('div');
          noteEl.className = 'schedule-note';
          noteEl.textContent = schedule.note;
          row.appendChild(noteEl);
        }

        group.appendChild(row);
      });

      container.appendChild(group);
    });
  }

  function syncDepartmentSelect() {
    const select = document.getElementById('inp-service');
    if (!select) return;

    select.innerHTML = '';

    departmentStatuses.forEach(dept => {
      const option = document.createElement('option');
      option.value = dept.name;
      option.textContent = dept.queue_status === 'open'
        ? dept.name
        : `${dept.name} (${dept.queue_status})`;

      option.disabled = dept.queue_status !== 'open';

      select.appendChild(option);
    });

    const firstOpen = departmentStatuses.find(d => d.queue_status === 'open');

    if (firstOpen) {
      select.value = firstOpen.name;
    }

    if (select.dataset.scheduleBound !== '1') {
      select.dataset.scheduleBound = '1';
      select.addEventListener('change', renderPatientSchedules);
    }
  }
}
