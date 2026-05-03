const grid = document.getElementById('display-grid');
const updated = document.getElementById('display-updated');
const clock = document.getElementById('display-clock');
const dateEl = document.getElementById('display-date');
const announcerEnableBtn = document.getElementById('announcer-enable-btn');
const announcerMuteBtn = document.getElementById('announcer-mute-btn');
const announcerTestBtn = document.getElementById('announcer-test-btn');
const announcerStatus = document.getElementById('announcer-status');
const announcerWarning = document.getElementById('announcer-warning');
const params = new URLSearchParams(window.location.search);
let featuredDepartmentId = params.get('department_id');
let currentServingQueue = null;
let lastSpokenQueueCode = '';
let lastSpokenAnnouncementKey = '';
let announcerVoices = [];

const speechSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
let announcerEnabled = readStoredBoolean('careflow_display_announcer_enabled', false);
let announcerMuted = readStoredBoolean('careflow_display_announcer_muted', false);

function readStoredBoolean(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch (err) {
    return fallback;
  }
}

function writeStoredBoolean(key, value) {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch (err) {
    console.warn('Unable to save announcer setting', err);
  }
}

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

function formatQueueCodeForSpeech(code) {
  const digitWords = {
    0: 'zero',
    1: 'one',
    2: 'two',
    3: 'three',
    4: 'four',
    5: 'five',
    6: 'six',
    7: 'seven',
    8: 'eight',
    9: 'nine'
  };

  return String(code || '')
    .trim()
    .toUpperCase()
    .split('')
    .map(char => digitWords[char] || char)
    .join(' ');
}

function refreshVoices() {
  if (!speechSupported) return;
  announcerVoices = window.speechSynthesis.getVoices() || [];
}

function getAnnouncementVoice() {
  if (!announcerVoices.length) refreshVoices();
  return announcerVoices.find(voice => voice.lang === 'en-PH')
    || announcerVoices.find(voice => voice.lang && voice.lang.toLowerCase().startsWith('en-ph'))
    || announcerVoices.find(voice => voice.lang === 'en-US')
    || announcerVoices.find(voice => voice.lang && voice.lang.toLowerCase().startsWith('en-us'))
    || null;
}

function getAnnouncementLang(voice) {
  if (voice && voice.lang && voice.lang.toLowerCase().startsWith('en-ph')) return 'en-PH';
  return 'en-US';
}

function speakText(text, { ignoreMuted = false } = {}) {
  if (!speechSupported || !announcerEnabled || (!ignoreMuted && announcerMuted)) return false;
  if (!text) return false;

  const voice = getAnnouncementVoice();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = getAnnouncementLang(voice);
  utterance.rate = 0.9;
  utterance.volume = 1;
  utterance.pitch = 1;
  if (voice) utterance.voice = voice;

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}

function getAnnouncementKey(queue) {
  if (!queue || !queue.code) return '';
  if (queue.announcement_event_id) return 'event:' + queue.announcement_event_id;
  return [
    'queue',
    queue.queue_id || queue.code,
    queue.called_at || ''
  ].join(':');
}

function speakAnnouncement(queue) {
  if (!queue || !queue.code) return;

  const announcementKey = getAnnouncementKey(queue);
  if (!announcementKey) return;
  if (announcementKey === lastSpokenAnnouncementKey) return;
  if (!queue.announcement_event_id && queue.code === lastSpokenQueueCode) return;
  if (!announcerEnabled || announcerMuted) return;

  const destination = queue.counter_name || queue.department_name || 'the counter';
  const spokenCode = formatQueueCodeForSpeech(queue.code);
  const message = `Now serving queue number ${spokenCode}. Please proceed to ${destination}.`;

  if (speakText(message)) {
    lastSpokenQueueCode = queue.code;
    lastSpokenAnnouncementKey = announcementKey;
    updateAnnouncerControls();
  }
}

function getLatestServingQueue(departments) {
  const servingQueues = [];

  departments.forEach(dept => {
    (dept.serving || []).forEach(queue => {
      servingQueues.push({
        ...queue,
        department_id: queue.department_id || dept.department_id,
        department_name: queue.department_name || dept.name
      });
    });
  });

  if (!servingQueues.length) return null;

  return servingQueues.sort((a, b) => {
    const aEvent = Number(a.announcement_event_id || 0);
    const bEvent = Number(b.announcement_event_id || 0);
    if (aEvent !== bEvent) return bEvent - aEvent;

    const aCalled = a.called_at ? new Date(a.called_at).getTime() : 0;
    const bCalled = b.called_at ? new Date(b.called_at).getTime() : 0;
    if (aCalled !== bCalled) return bCalled - aCalled;

    return Number(b.queue_id || 0) - Number(a.queue_id || 0);
  })[0];
}

function updateAnnouncerControls() {
  if (announcerWarning) {
    announcerWarning.hidden = speechSupported;
  }

  if (announcerEnableBtn) {
    announcerEnableBtn.disabled = !speechSupported;
    announcerEnableBtn.textContent = announcerEnabled ? 'Announcer Enabled' : 'Enable Announcer';
    announcerEnableBtn.classList.toggle('enabled', announcerEnabled);
  }

  if (announcerMuteBtn) {
    announcerMuteBtn.disabled = !speechSupported || !announcerEnabled;
    announcerMuteBtn.textContent = announcerMuted ? 'Unmute' : 'Mute';
    announcerMuteBtn.classList.toggle('muted', announcerMuted);
  }

  if (announcerTestBtn) {
    announcerTestBtn.disabled = !speechSupported;
  }

  if (announcerStatus) {
    if (!speechSupported) {
      announcerStatus.textContent = 'Announcer unavailable';
    } else if (!announcerEnabled) {
      announcerStatus.textContent = 'Announcer off';
    } else if (announcerMuted) {
      announcerStatus.textContent = 'Announcer muted';
    } else if (lastSpokenQueueCode) {
      announcerStatus.textContent = 'Last announced ' + lastSpokenQueueCode;
    } else {
      announcerStatus.textContent = 'Announcer ready';
    }
  }
}

function enableAnnouncer() {
  if (!speechSupported) return;
  announcerEnabled = true;
  writeStoredBoolean('careflow_display_announcer_enabled', true);
  updateAnnouncerControls();
  speakAnnouncement(currentServingQueue);
}

function toggleMute() {
  if (!speechSupported || !announcerEnabled) return;
  announcerMuted = !announcerMuted;
  writeStoredBoolean('careflow_display_announcer_muted', announcerMuted);
  if (announcerMuted) {
    window.speechSynthesis.cancel();
  }
  updateAnnouncerControls();
}

function updateClock() {
  if (!clock) return;

  clock.textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
}

function renderDepartment(dept, featured = false) {
  const serving = dept.serving || [];
  const upNext = dept.up_next || [];
  const firstServing = serving[0];
  const remainingCount = Number(dept.waiting_count ?? upNext.length);
  const nextItem = upNext[0];

  const servingHtml = firstServing
    ? `
      <div class="display-call-layout">
        <div class="display-call-dot"></div>
        <div class="display-call-info">
          <div class="display-call-label">${escHtml(firstServing.counter_name || 'Counter pending')}</div>
          <div class="display-ticket">${escHtml(firstServing.code)}</div>
          <div class="display-patient">${escHtml(firstServing.full_name || 'Patient')}</div>
          <div class="display-time">${firstServing.called_at ? 'Called ' + formatTime(firstServing.called_at) : ''}</div>
        </div>
      </div>
    `
    : `
      <div class="display-call-layout">
        <div class="display-call-dot muted"></div>
        <div class="display-call-info">
          <div class="display-call-label">No active call</div>
          <div class="display-ticket muted">---</div>
          <div class="display-patient">Waiting for next patient</div>
        </div>
      </div>
    `;

  const compactServingHtml = firstServing
    ? `
      <div class="display-compact-call">
        <div class="display-call-dot small"></div>
        <div class="display-call-info">
          <div class="display-call-label">${escHtml(firstServing.code)}</div>
          <div class="display-time">${firstServing.called_at ? 'Called ' + formatTime(firstServing.called_at) : 'Now serving'}</div>
        </div>
      </div>
    `
    : `
      <div class="display-compact-call">
        <div class="display-call-dot muted small"></div>
        <div class="display-call-info">
          <div class="display-call-label muted">---</div>
          <div class="display-time">No active call</div>
        </div>
      </div>
    `;

  return `
    <article class="display-card ${featured ? 'featured' : 'compact'}" data-department-id="${escHtml(dept.department_id)}">
      <div class="display-card-head">
        <div class="display-department">${escHtml(dept.name)}</div>
        <div class="display-status ${escHtml(dept.queue_status)}">${escHtml(dept.queue_status)}</div>
      </div>
      ${featured ? `
        <div class="display-main">
          <div class="display-serving">
            ${servingHtml}
          </div>
          <aside class="display-count-panel">
            <div class="display-count-label">Remaining</div>
            <div class="display-count-number">${remainingCount}</div>
            <div class="display-count-sub">waiting</div>
          </aside>
        </div>
        <div class="display-next">
          <div class="display-next-title">Up Next</div>
          ${nextItem
            ? `
              <div class="display-next-item">
                <span>${escHtml(nextItem.code)}</span>
                <small>${escHtml(nextItem.full_name || 'Patient')}</small>
              </div>
            `
            : `<div class="display-next-empty">No waiting patients</div>`
          }
        </div>
      ` : `
        <div class="display-compact-body">
          ${compactServingHtml}
          <div class="display-compact-count">
            <div class="display-count-label">Remaining</div>
            <div class="display-count-number">${remainingCount}</div>
            <div class="display-count-sub">waiting</div>
          </div>
        </div>
      `}
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
    currentServingQueue = getLatestServingQueue(departments);
    const featuredId = featuredDepartmentId || (departments[0] ? String(departments[0].department_id) : null);
    const sortedDepartments = [...departments].sort((a, b) => {
      if (String(a.department_id) === String(featuredId)) return -1;
      if (String(b.department_id) === String(featuredId)) return 1;
      return String(a.name).localeCompare(String(b.name));
    });
    const featuredDept = sortedDepartments.find(dept => String(dept.department_id) === String(featuredId)) || sortedDepartments[0] || null;
    const supportingDepartments = sortedDepartments.filter(dept => !featuredDept || String(dept.department_id) !== String(featuredDept.department_id));

    grid.innerHTML = sortedDepartments.length
      ? `
        <div class="display-layout">
          <div class="display-featured-column">
            ${featuredDept ? renderDepartment(featuredDept, true) : ''}
          </div>
          <div class="display-supporting-column">
            ${supportingDepartments.map(dept => renderDepartment(dept, false)).join('')}
          </div>
        </div>
      `
      : `<div class="empty-state">No departments configured.</div>`;

    grid.querySelectorAll('.display-card').forEach(card => {
      card.addEventListener('click', () => {
        featuredDepartmentId = card.dataset.departmentId;
        loadDisplay();
      });
    });

    updated.textContent = 'Updated ' + new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    speakAnnouncement(currentServingQueue);
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="empty-state">Unable to load display.</div>`;
    updated.textContent = 'Refresh failed';
  }
}

if (speechSupported) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

if (announcerEnableBtn) {
  announcerEnableBtn.addEventListener('click', enableAnnouncer);
}

if (announcerMuteBtn) {
  announcerMuteBtn.addEventListener('click', toggleMute);
}

if (announcerTestBtn) {
  announcerTestBtn.addEventListener('click', () => {
    if (!speechSupported) return;
    if (!announcerEnabled) {
      announcerEnabled = true;
      writeStoredBoolean('careflow_display_announcer_enabled', true);
      updateAnnouncerControls();
    }
    if (announcerMuted) {
      updateAnnouncerControls();
      return;
    }
    speakText('Announcer is ready.');
  });
}

updateAnnouncerControls();
updateClock();
loadDisplay();
setInterval(updateClock, 1000);
setInterval(loadDisplay, 10000);
