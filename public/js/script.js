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

  // ─── DATA ───
  // In production these would be fetched from your API.
  // The shape is kept identical to the original so your
  // backend calls can replace these arrays directly.
  const departments = [
    { id:'genmed',    name:'Gen Med / Internal Medicine', type:'patient-care', queue:18, color:'#e8f7f2', emoji:'🏥' },
    { id:'birthing',  name:'Birthing / OB-GYN',           type:'patient-care', queue:7,  color:'#fef3f2', emoji:'🤱' },
    { id:'geriatrics',name:'Geriatrics',                  type:'patient-care', queue:12, color:'#eff6ff', emoji:'🧓' },
    { id:'radiology', name:'Radiology',                   type:'laboratory',   queue:5,  color:'#fefce8', emoji:'🔬' },
    { id:'pathology', name:'Clinical Pathology',          type:'laboratory',   queue:0,  color:'#f0fdf4', emoji:'🧪' },
    { id:'pharmacy',  name:'Pharmacy',                    type:'support',      queue:3,  color:'#faf5ff', emoji:'💊' },
    { id:'cardiology',name:'Cardiology',                  type:'patient-care', queue:14, color:'#fff1f2', emoji:'❤️' },
    { id:'neurology', name:'Neurology',                   type:'patient-care', queue:6,  color:'#f0f4ff', emoji:'🧠' },
  ];

  const counters = [
    { room:'Room 1', num:'042', doctor:'Dr. Ana Santos',  spec:'General Medicine',  avg:'8 min'  },
    { room:'Room 2', num:'039', doctor:'Dr. Marco Ramos', spec:'Internal Medicine', avg:'11 min' },
    { room:'Room 3', num:'041', doctor:'Dr. Liza Torres', spec:'General Practice',  avg:'7 min'  },
  ];

  let patients = [
    { q:'042', name:'Imong Nawng',   gender:'F', age:72, priority:'high',   status:'serving', counter:'Room 1 — Dr. Santos', wait:'Serving now' },
    { q:'043', name:'Imong Mama',    gender:'M', age:58, priority:'medium', status:'waiting', counter:'Room 1 — Dr. Santos', wait:'~8 min'      },
    { q:'044', name:'Imong Tae',     gender:'F', age:41, priority:'low',    status:'waiting', counter:'Room 2 — Dr. Ramos', wait:'~14 min'     },
    { q:'039', name:'Imong Betlog',  gender:'M', age:67, priority:'medium', status:'waiting', counter:'Room 3 — Dr. Torres',wait:'~19 min'     },
    { q:'045', name:'Rain',          gender:'F', age:34, priority:'low',    status:'waiting', counter:'Room 2 — Dr. Ramos', wait:'~22 min'     },
    { q:'046', name:'SK Girl',       gender:'M', age:80, priority:'high',   status:'waiting', counter:'Room 1 — Dr. Santos', wait:'~27 min'    },
    { q:'047', name:'Shaken',        gender:'F', age:65, priority:'high',   status:'waiting', counter:'Room 3 — Dr. Torres',wait:'~31 min'     },
    { q:'048', name:'AJ Nicole',     gender:'M', age:52, priority:'low',    status:'waiting', counter:'Room 2 — Dr. Ramos', wait:'~36 min'     },
  ];

  let activeDept    = 'genmed';
  let activeFilter  = 'all';
  let searchVal     = '';

  // ─── DEPARTMENT GRID ───
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

  // ─── PAGE NAVIGATION ───
  function showPage(p) {
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.getElementById('page-' + p).classList.add('active');
    document.querySelectorAll('.side-btn').forEach((b, i) => {
      b.classList.remove('active');
      if ((p === 'dept'  && i === 0) ||
          (p === 'queue' && i === 1)) b.classList.add('active');
    });
  }

  function openDept(id, name) {
    activeDept = id;
    document.getElementById('active-dept-name').textContent = name;
    showPage('queue');
    renderCounters();
    renderNextList();
    renderTable();
    switchTab('main', document.querySelector('.tab-btn'));
  }

  // ─── TABS ───
  function switchTab(tab, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
  }

  // ─── COUNTER CARDS ───
  function renderCounters() {
    const row = document.getElementById('counters-row');
    row.innerHTML = counters.map((c, i) => `
      <div class="counter-card ${i === 0 ? 'active-counter' : ''}" onclick="selectCounter(${i}, this)">
        <div class="counter-room">${c.room}</div>
        <div class="counter-num">${c.num}</div>
        <div class="counter-doctor">${c.doctor}</div>
        <div class="counter-spec">${c.spec}</div>
        <div class="counter-avg">Avg ${c.avg}/patient</div>
      </div>
    `).join('');
  }

  function selectCounter(i, el) {
    document.querySelectorAll('.counter-card').forEach(c => c.classList.remove('active-counter'));
    el.classList.add('active-counter');
  }

  // ─── NEXT-UP LIST ───
  function renderNextList() {
    const waiting = patients.filter(p => p.status === 'waiting').slice(0, 4);
    document.getElementById('next-list').innerHTML = waiting.map(p => `
      <div class="next-item">
        <div class="next-num">${p.q}</div>
        <div>
          <div class="next-pname">${p.name}</div>
          <div class="next-psub">${p.gender} · ${p.age} yrs · ${p.wait}</div>
        </div>
        <span class="priority-chip ${p.priority}" style="margin-left:auto;font-size:11px">${p.priority}</span>
      </div>
    `).join('');
  }

  // ─── QUEUE TABLE ───
  function renderTable() {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sorted = [...patients].sort((a, b) => {
      if (a.status === 'serving') return -1;
      if (b.status === 'serving') return 1;
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    document.getElementById('line-count').textContent = `(${patients.length} patients)`;
    document.getElementById('queue-tbody').innerHTML = sorted.map(p => `
      <tr>
        <td><span class="priority-chip ${p.priority}">${p.priority}</span></td>
        <td class="td-queue">${p.q}</td>
        <td style="font-weight:500">${p.name}</td>
        <td><span class="status-badge ${p.status}">${p.status}</span></td>
        <td style="font-size:13px;color:var(--text2)">${p.counter}</td>
        <td class="ai-wait"><strong>${p.wait}</strong></td>
        <td>
          <div class="action-btns">
            <button class="act-btn" onclick="callPatient('${p.q}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              Call
            </button>
            <button class="act-btn del" onclick="deletePatient('${p.q}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              Remove
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // ─── QUEUE ACTIONS ───
  let qNum = 42;

  function recallQueue() {
    showToast('Queue #0' + qNum + ' recalled — announcement sent');
  }

  function skipQueue() {
    qNum++;
    document.getElementById('q-number').textContent = '0' + qNum;
    const p = patients.find(p => parseInt(p.q) === qNum);
    if (p) {
      document.getElementById('q-name').textContent = p.name;
      document.getElementById('q-sub').textContent  = p.gender + ' · ' + p.age + ' years';
      const pc = document.getElementById('q-priority');
      pc.className   = 'priority-chip ' + p.priority;
      pc.textContent = p.priority.charAt(0).toUpperCase() + p.priority.slice(1);
    }
    showToast('Skipped to Queue #0' + qNum);
  }

  function callPatient(q)   { showToast('Calling Queue #' + q + '…'); }

  function deletePatient(q) {
    patients = patients.filter(p => p.q !== q);
    renderTable();
    renderNextList();
    showToast('Patient #' + q + ' removed from queue');
  }

  // ─── AI PANEL ───
  function toggleAI() {
    document.getElementById('ai-panel').classList.toggle('open');
  }

  function acceptAI() {
    const idx = patients.findIndex(p => p.q === '047');
    if (idx > -1) {
      patients[idx].priority = 'high';
      const removed = patients.splice(idx, 1)[0];
      const firstWaiting = patients.findIndex(p => p.status === 'waiting');
      patients.splice(Math.max(firstWaiting, 0), 0, removed);
      renderTable();
      renderNextList();
    }
    document.getElementById('ai-panel').classList.remove('open');
    document.getElementById('ai-ping').style.display = 'none';
    showToast('Q-047 promoted to top of queue');
  }

  // ─── ADD PATIENT MODAL ───
  function openModal()  { document.getElementById('modal-overlay').classList.add('open'); }
  function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }

  function closeModalOuter(e) {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  }

  function addPatient() {
    const first = document.getElementById('f-first').value.trim();
    const last  = document.getElementById('f-last').value.trim();
    if (!first || !last) { alert('Please enter patient name.'); return; }

    const gender   = document.getElementById('f-gender').value;
    const age      = document.getElementById('f-age').value || '—';
    const priority = document.getElementById('f-priority').value;
    const counter  = document.getElementById('f-counter').value;
    const maxQ     = Math.max(...patients.map(p => parseInt(p.q)));
    const newQ     = String(maxQ + 1).padStart(3, '0');

    patients.push({
      q: newQ, name: first + ' ' + last,
      gender, age: parseInt(age) || 0,
      priority, status: 'waiting', counter,
      wait: '~' + (patients.length * 5 + 5) + ' min'
    });

    renderTable();
    renderNextList();
    closeModal();
    ['f-first','f-last','f-age','f-notes'].forEach(id => {
      document.getElementById(id).value = '';
    });
    showToast('Patient ' + first + ' ' + last + ' added as Queue #' + newQ);
  }

  // ─── NOTIFICATIONS ───
  function toggleNotif() {
    document.getElementById('notif-panel').classList.toggle('open');
  }

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
      t.style.cssText = [
        'position:fixed','bottom:100px','left:50%',
        'transform:translateX(-50%)',
        'background:#111','color:#fff',
        'padding:10px 20px','border-radius:8px',
        'font-size:13px','font-weight:500',
        'z-index:999','opacity:0','transition:opacity 0.2s',
        'white-space:nowrap','box-shadow:0 4px 16px rgba(0,0,0,0.3)'
      ].join(';');
      document.body.appendChild(t);
    }
    t.textContent  = msg;
    t.style.opacity = '1';
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => t.style.opacity = '0', 2800);
  }

  // ─── EXPOSE GLOBALS (called from inline HTML onclick attributes) ───
  window.filterDepts    = filterDepts;
  window.setFilter      = setFilter;
  window.showPage       = showPage;
  window.openDept       = openDept;
  window.switchTab      = switchTab;
  window.selectCounter  = selectCounter;
  window.recallQueue    = recallQueue;
  window.skipQueue      = skipQueue;
  window.callPatient    = callPatient;
  window.deletePatient  = deletePatient;
  window.toggleAI       = toggleAI;
  window.acceptAI       = acceptAI;
  window.openModal      = openModal;
  window.closeModal     = closeModal;
  window.closeModalOuter= closeModalOuter;
  window.addPatient     = addPatient;
  window.toggleNotif    = toggleNotif;

  // ─── INIT ───
  renderDepts();
  renderCounters();
  renderNextList();
  renderTable();

} // end isDashboard


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