const grid = document.getElementById('display-grid');
const updated = document.getElementById('display-updated');
const clock = document.getElementById('display-clock');
const dateEl = document.getElementById('display-date');
const announcerEnableBtn = document.getElementById('announcer-enable-btn');
const announcerMuteBtn = document.getElementById('announcer-mute-btn');
const announcerTestBtn = document.getElementById('announcer-test-btn');
const announcerStatus = document.getElementById('announcer-status');
const announcerWarning = document.getElementById('announcer-warning');

const REFRESH_MS = 10000;
const PAGE_MS = 60000;
const MIN_COLUMN_WIDTH = 238;
const MAX_VISIBLE_COLUMNS = 7;

let currentColumns = [];
let currentPageIndex = 0;
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

  const destination = queue.subtitle || queue.column_title || queue.department_name || 'the counter';
  const spokenCode = formatQueueCodeForSpeech(queue.code);
  const message = `Ticket ${spokenCode}, please proceed to ${destination}.`;

  if (speakText(message)) {
    lastSpokenQueueCode = queue.code;
    lastSpokenAnnouncementKey = announcementKey;
    updateAnnouncerControls();
  }
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

  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
}

function toTimestamp(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function getVisibleColumnCount() {
  const boardWidth = grid ? grid.clientWidth : window.innerWidth;
  if (!boardWidth) return 5;
  return Math.max(1, Math.min(MAX_VISIBLE_COLUMNS, Math.floor(boardWidth / MIN_COLUMN_WIDTH)));
}

function getPageCount(columns = currentColumns) {
  const visibleColumns = getVisibleColumnCount();
  return Math.max(1, Math.ceil((columns || []).length / visibleColumns));
}

function getRecentMarker(columns) {
  const queues = columns.flatMap(column => (column.serving || []).map(queue => ({
    ...queue,
    column_id: column.column_id,
    column_title: column.title,
    subtitle: column.subtitle,
    department_name: column.department_name
  })));

  if (!queues.length) return { queue: null, eventId: 0, calledAt: 0 };

  const eventId = queues.reduce((max, queue) => Math.max(max, Number(queue.announcement_event_id || 0)), 0);
  const calledAt = queues.reduce((max, queue) => Math.max(max, toTimestamp(queue.called_at)), 0);
  const queue = [...queues].sort((a, b) => {
    const eventDiff = Number(b.announcement_event_id || 0) - Number(a.announcement_event_id || 0);
    if (eventDiff) return eventDiff;
    const calledDiff = toTimestamp(b.called_at) - toTimestamp(a.called_at);
    if (calledDiff) return calledDiff;
    return Number(b.queue_id || 0) - Number(a.queue_id || 0);
  })[0] || null;

  return { queue, eventId, calledAt };
}

function isRecentQueue(queue, marker) {
  if (!queue || !marker) return false;
  const eventId = Number(queue.announcement_event_id || 0);
  if (marker.eventId && eventId === marker.eventId) return true;
  return Boolean(marker.calledAt && toTimestamp(queue.called_at) === marker.calledAt);
}

function getQueueBadge(queue) {
  if (queue.is_emergency) return 'Emergency';
  if (queue.is_priority) return 'Priority';
  return queue.status === 'serving' ? 'Serving' : 'Waiting';
}

function renderQueueCode(queue, marker, className = '') {
  const classes = ['display-tv-code', className];
  if (isRecentQueue(queue, marker)) classes.push('recent-call');

  return `
    <div class="${classes.filter(Boolean).join(' ')}">
      ${escHtml(queue.code)}
    </div>
  `;
}

function renderWaitingList(column, marker) {
  const waiting = column.waiting || [];
  if (!waiting.length) {
    return `<div class="display-tv-empty">---</div>`;
  }

  return waiting.slice(0, 8).map(queue => {
    const badge = getQueueBadge(queue);
    const showBadge = badge !== 'Waiting';
    return `
      <div class="display-tv-waiting-row ${showBadge ? 'has-badge' : 'no-badge'}">
        ${renderQueueCode(queue, marker)}
        ${showBadge ? `<span class="display-tv-badge ${escAttr(badge.toLowerCase())}">${escHtml(badge)}</span>` : ''}
      </div>
    `;
  }).join('');
}

function renderServingList(column, marker) {
  const serving = column.serving || [];
  if (!serving.length) {
    return `<div class="display-tv-empty large">---</div>`;
  }

  return serving.map(queue => renderQueueCode(queue, marker, 'serving')).join('');
}

function renderColumn(column, marker, pageLabel) {
  const status = String(column.status || 'open').toLowerCase();
  const statusLabel = status === 'pause' ? 'Paused' : status.charAt(0).toUpperCase() + status.slice(1);

  return `
    <article class="display-tv-column ${escAttr(status)}">
      <header class="display-tv-column-head">
        <div>
          <div class="display-tv-title">${escHtml(column.title || 'Queue')}</div>
          ${column.subtitle ? `<div class="display-tv-subtitle">${escHtml(column.subtitle)}</div>` : ''}
        </div>
        <div class="display-status ${escAttr(status)}">${escHtml(statusLabel)}</div>
      </header>

      <section class="display-tv-serving">
        <div class="display-tv-section-label">Now Serving</div>
        <div class="display-tv-serving-row">
          ${renderServingList(column, marker)}
        </div>
      </section>

      <section class="display-tv-waiting">
        <div class="display-tv-section-label">Waiting</div>
        <div class="display-tv-waiting-list">
          ${renderWaitingList(column, marker)}
        </div>
      </section>

      <footer class="display-tv-footer">${escHtml(pageLabel)}</footer>
    </article>
  `;
}

function renderDisplay() {
  if (!grid) return;

  const columns = currentColumns || [];
  if (!columns.length) {
    grid.innerHTML = `<div class="empty-state">No queues configured</div>`;
    return;
  }

  const visibleColumns = getVisibleColumnCount();
  const pageCount = getPageCount(columns);
  currentPageIndex = Math.min(currentPageIndex, pageCount - 1);

  const start = currentPageIndex * visibleColumns;
  const pageColumns = columns.slice(start, start + visibleColumns);
  const marker = getRecentMarker(columns);
  const pageLabel = `Page ${currentPageIndex + 1}/${pageCount}`;

  grid.style.setProperty('--visible-columns', String(Math.max(1, pageColumns.length)));
  grid.innerHTML = `
    <div class="display-tv-board">
      ${pageColumns.map(column => renderColumn(column, marker, pageLabel)).join('')}
    </div>
  `;
}

function getLatestServingQueue(columns) {
  const marker = getRecentMarker(columns);
  return marker.queue;
}

async function loadDisplay() {
  try {
    const res = await fetch('/api/display/now-serving', { credentials: 'include' });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load display');
    }

    currentColumns = data.columns || [];
    currentServingQueue = getLatestServingQueue(currentColumns);

    const pageCount = getPageCount(currentColumns);
    if (currentPageIndex >= pageCount) {
      currentPageIndex = 0;
    }

    renderDisplay();

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

function advancePage() {
  const pageCount = getPageCount(currentColumns);
  if (pageCount <= 1) return;
  currentPageIndex = (currentPageIndex + 1) % pageCount;
  renderDisplay();
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

window.addEventListener('resize', renderDisplay);

updateAnnouncerControls();
updateClock();
loadDisplay();
setInterval(updateClock, 1000);
setInterval(loadDisplay, REFRESH_MS);
setInterval(advancePage, PAGE_MS);
