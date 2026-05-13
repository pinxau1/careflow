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
let focusedDepartmentId = params.get('department_id');
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

function escAttr(value) {
  return escHtml(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function getServiceLabel(queue, dept) {
  return queue.service_label
    || queue.destination_name
    || queue.subdepartment_name
    || queue.counter_name
    || dept.name
    || 'Service';
}

function getRoomLabel(queue) {
  return queue.room_label || '';
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

  const destination = queue.service_label || queue.destination_name || queue.counter_name || queue.department_name || 'the counter';
  const spokenCode = formatQueueCodeForSpeech(queue.code);
  const message = `Ticket ${spokenCode}, please proceed to ${destination}.`;

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

function getDisplayStatus(queue) {
  return queue.status === 'serving' ? 'serving' : 'waiting';
}

function getDisplayTimeLabel(queue, statusClass) {
  const time = formatTime(queue.called_at);
  if (!time) return '';
  return (statusClass === 'serving' ? 'Called ' : 'Queued ') + time;
}

function renderQueueRow(queue, dept) {
  const serviceLabel = getServiceLabel(queue, dept);
  const roomLabel = getRoomLabel(queue);
  const statusClass = getDisplayStatus(queue);
  const statusText = statusClass === 'serving' ? 'Serving' : 'Waiting';
  const timeLabel = getDisplayTimeLabel(queue, statusClass);
  return `
    <div class="display-queue-row ${statusClass}" aria-label="${escHtml(queue.code)} ${statusText}">
      <div class="display-queue-code">${escHtml(queue.code)}</div>
      <div class="display-queue-meta">
        <div class="display-queue-service">${escHtml(serviceLabel)}</div>
        <div class="display-queue-room">${escHtml(roomLabel || dept.name || '')}</div>
        ${timeLabel ? `<div class="display-queue-time">${escHtml(timeLabel)}</div>` : ''}
      </div>
      <div class="display-queue-status">${escHtml(statusText)}</div>
    </div>
  `;
}

function renderSubqueueColumn(group, dept) {
  const serviceLabel = group.label || dept.name;
  const roomLabel = group.room_label || '';
  const rows = [
    ...(group.serving || []),
    ...(group.waiting || [])
  ];

  return `
    <section class="display-service-group">
      <div class="display-service-head">
        <div>
          <div class="display-service-label">${escHtml(serviceLabel)}</div>
          <div class="display-service-room">${escHtml(roomLabel || dept.name)}</div>
        </div>
        <div class="display-service-count">${rows.length}</div>
      </div>
      <div class="display-service-list">
        ${rows.length
          ? rows.map(queue => renderQueueRow(queue, dept)).join('')
          : `<div class="display-next-empty">No tickets</div>`
        }
      </div>
    </section>
  `;
}

function renderDepartment(dept, focused = false) {
  const groups = (dept.groups || []).length
    ? dept.groups
    : [{
        label: dept.name,
        room_label: '',
        serving: dept.serving || [],
        waiting: dept.up_next || []
      }];
  const servingCount = groups.reduce((total, group) => total + (group.serving || []).length, 0);
  const waitingCount = groups.reduce((total, group) => total + (group.waiting || []).length, 0);

  return `
    <article
      class="display-card display-department-card ${focused ? 'is-focused' : ''}"
      data-department-id="${escAttr(dept.department_id)}"
      role="button"
      tabindex="0"
      aria-label="${focused ? 'Show all queues' : 'Focus ' + escAttr(dept.name)}"
    >
      <div class="display-card-head">
        <div>
          <div class="display-department">${escHtml(dept.name)}</div>
          <div class="display-department-meta">
            ${servingCount} serving / ${waitingCount} waiting
          </div>
        </div>
        <div class="display-status ${escHtml(dept.queue_status)}">${escHtml(dept.queue_status)}</div>
      </div>
      <div class="display-card-body">
        <div class="display-service-grid">
          ${groups.map(group => renderSubqueueColumn(group, dept)).join('')}
        </div>
      </div>
    </article>
  `;
}

function setFocusedDepartment(departmentId) {
  focusedDepartmentId = departmentId ? String(departmentId) : null;

  const nextUrl = new URL(window.location.href);
  if (focusedDepartmentId) {
    nextUrl.searchParams.set('department_id', focusedDepartmentId);
  } else {
    nextUrl.searchParams.delete('department_id');
  }
  window.history.replaceState({}, '', nextUrl);

  loadDisplay();
}

function renderDisplayControls(totalCount, visibleCount) {
  if (!focusedDepartmentId || totalCount <= visibleCount) return '';

  return `
    <div class="display-focus-bar">
      <button type="button" class="display-show-all-btn" id="display-show-all-btn">
        All queues
      </button>
    </div>
  `;
}

function bindDisplayInteractions() {
  const showAllBtn = document.getElementById('display-show-all-btn');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', event => {
      event.stopPropagation();
      setFocusedDepartment(null);
    });
  }

  grid.querySelectorAll('.display-department-card').forEach(card => {
    const departmentId = card.dataset.departmentId;
    const toggleFocus = () => {
      setFocusedDepartment(String(departmentId) === String(focusedDepartmentId) ? null : departmentId);
    };

    card.addEventListener('click', toggleFocus);
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleFocus();
    });
  });
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

    const sortedDepartments = [...departments]
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    let renderedDepartments = focusedDepartmentId
      ? sortedDepartments.filter(dept => String(dept.department_id) === String(focusedDepartmentId))
      : sortedDepartments;

    if (focusedDepartmentId && !renderedDepartments.length) {
      focusedDepartmentId = null;
      renderedDepartments = sortedDepartments;
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete('department_id');
      window.history.replaceState({}, '', nextUrl);
    }

    grid.innerHTML = sortedDepartments.length
      ? `
        ${renderDisplayControls(sortedDepartments.length, renderedDepartments.length)}
        <div class="display-layout display-department-grid ${focusedDepartmentId ? 'is-focused' : ''}">
          ${renderedDepartments.map(dept => renderDepartment(dept, Boolean(focusedDepartmentId))).join('')}
        </div>
      `
      : `<div class="empty-state">No departments configured.</div>`;
    bindDisplayInteractions();

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
