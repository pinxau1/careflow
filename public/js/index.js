const departments = [
  {
    id: "genmed",
    name: "Gen Med / Internal Medicine",
    type: "patient-care",
    emoji: "🩺",
    queue: 18,
    color: "#eaf7f2",
  },
  {
    id: "birthing",
    name: "Birthing / OB-GYN",
    type: "patient-care",
    emoji: "🍼",
    queue: 7,
    color: "#fef3f2",
  },
  {
    id: "geriatrics",
    name: "Geriatrics",
    type: "patient-care",
    emoji: "🧓",
    queue: 12,
    color: "#eff6ff",
  },
  {
    id: "radiology",
    name: "Radiology",
    type: "laboratory",
    emoji: "🫁",
    queue: 5,
    color: "#fefce8",
  },
  {
    id: "pathology",
    name: "Clinical Pathology",
    type: "laboratory",
    emoji: "🔬",
    queue: 9,
    color: "#f0fdf4",
  },
  {
    id: "pharmacy",
    name: "Pharmacy",
    type: "support",
    emoji: "💊",
    queue: 22,
    color: "#faf5ff",
  },
  {
    id: "cardiology",
    name: "Cardiology",
    type: "patient-care",
    emoji: "❤️",
    queue: 14,
    color: "#fff1f2",
  },
  {
    id: "neurology",
    name: "Neurology",
    type: "patient-care",
    emoji: "🧠",
    queue: 6,
    color: "#f0f4ff",
  },
];

const counters = [
  {
    room: "Room 1",
    num: "042",
    doctor: "Dr. Ana Santos",
    spec: "General Medicine",
    avg: "8 min",
  },
  {
    room: "Room 2",
    num: "039",
    doctor: "Dr. Marco Ramos",
    spec: "Internal Medicine",
    avg: "11 min",
  },
  {
    room: "Room 3",
    num: "041",
    doctor: "Dr. Liza Torres",
    spec: "General Practice",
    avg: "7 min",
  },
];

let patients = [
  {
    q: "042",
    name: "Rosario Mendoza",
    gender: "F",
    age: 72,
    priority: "high",
    status: "serving",
    counter: "Room 1 — Dr. Santos",
    wait: "Now",
    type: "pwd",
  },
  {
    q: "043",
    name: "Bernardo Ocampo",
    gender: "M",
    age: 58,
    priority: "medium",
    status: "waiting",
    counter: "Room 1 — Dr. Santos",
    wait: "~8 min",
    type: "regular",
  },
  {
    q: "044",
    name: "Teresita Villanueva",
    gender: "F",
    age: 41,
    priority: "low",
    status: "waiting",
    counter: "Room 2 — Dr. Ramos",
    wait: "~14 min",
    type: "regular",
  },
  {
    q: "039",
    name: "Armando Lim",
    gender: "M",
    age: 67,
    priority: "medium",
    status: "waiting",
    counter: "Room 3 — Dr. Torres",
    wait: "~19 min",
    type: "pwd",
  },
  {
    q: "045",
    name: "Carmen Buenaventura",
    gender: "F",
    age: 34,
    priority: "low",
    status: "waiting",
    counter: "Room 2 — Dr. Ramos",
    wait: "~22 min",
    type: "regular",
  },
  {
    q: "046",
    name: "Roberto Alcantara",
    gender: "M",
    age: 80,
    priority: "high",
    status: "waiting",
    counter: "Room 1 — Dr. Santos",
    wait: "~27 min",
    type: "pwd",
  },
  {
    q: "047",
    name: "Erlinda Cruz",
    gender: "F",
    age: 65,
    priority: "high",
    status: "waiting",
    counter: "Room 3 — Dr. Torres",
    wait: "~31 min",
    type: "pwd",
  },
  {
    q: "048",
    name: "Salvador Reyes",
    gender: "M",
    age: 52,
    priority: "low",
    status: "waiting",
    counter: "Room 2 — Dr. Ramos",
    wait: "~36 min",
    type: "regular",
  },
];

let activeFilter = "all";
let searchVal = "";
let currentQNum = 42;

// ── DEPARTMENT PAGE ──

function renderDepts() {
  const grid = document.getElementById("dept-grid");
  const filtered = departments.filter((d) => {
    const matchType = activeFilter === "all" || d.type === activeFilter;
    const matchSearch = d.name.toLowerCase().includes(searchVal.toLowerCase());
    return matchType && matchSearch;
  });

  if (!filtered.length) {
    grid.innerHTML =
      '<div style="color:var(--text3);font-size:13px;padding:40px 0">No departments found.</div>';
    return;
  }

  grid.innerHTML = filtered
    .map(
      (d) => `
    <div class="dept-card" onclick="openDept('${d.id}', '${d.name}')">
      <div class="dept-img" style="background:${d.color}">
        <div class="dept-img-bg">${d.emoji}</div>
      </div>
      <div class="dept-info">
        <div class="dept-name">${d.name}</div>
        <div class="dept-meta">
          <span class="dept-type ${d.type === "laboratory" ? "lab" : d.type === "support" ? "support" : ""}">${d.type.replace("-", " ")}</span>
          <span class="dept-queue">Queue: <span>${d.queue}</span></span>
        </div>
      </div>
    </div>
  `,
    )
    .join("");
}

function filterDepts(val) {
  searchVal = val;
  renderDepts();
}

function setFilter(f, el) {
  activeFilter = f;
  document
    .querySelectorAll(".filter-chip")
    .forEach((c) => c.classList.remove("active"));
  el.classList.add("active");
  renderDepts();
}

// ── PAGE & TAB NAVIGATION ──

function showPage(p) {
  document
    .querySelectorAll(".page")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById("page-" + p).classList.add("active");

  document.querySelectorAll(".side-btn").forEach((b, i) => {
    b.classList.remove("active");
    if (p === "dept" && i === 0) b.classList.add("active");
    if (p === "queue" && i === 1) b.classList.add("active");
  });
}

function openDept(id, name) {
  document.getElementById("active-dept-name").textContent = name;
  showPage("queue");
  renderCounters();
  renderServingCard();
  renderNextList();
  renderTable();
  updateStats();
  switchTab("main", document.querySelectorAll(".tab-btn")[0]);
}

function switchTab(tab, btn) {
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.remove("active"));
  if (btn) btn.classList.add("active");
  document.getElementById("tab-" + tab).classList.add("active");
}

// ── COUNTERS ──

function renderCounters() {
  document.getElementById("counters-row").innerHTML = counters
    .map(
      (c, i) => `
    <div class="counter-card ${i === 0 ? "active-counter" : ""}" onclick="selectCounter(${i}, this)">
      <div class="counter-room">${c.room}</div>
      <div class="counter-num">${c.num}</div>
      <div class="counter-doctor">${c.doctor}</div>
      <div class="counter-spec">${c.spec}</div>
      <div class="counter-avg">Avg ${c.avg}/patient</div>
    </div>
  `,
    )
    .join("");
}

function selectCounter(i, el) {
  document
    .querySelectorAll(".counter-card")
    .forEach((c) => c.classList.remove("active-counter"));
  el.classList.add("active-counter");
}

// ── NOW SERVING CARD ──

function renderServingCard() {
  const serving = patients.find((p) => p.status === "serving");
  if (!serving) return;

  document.getElementById("q-number").textContent = serving.q;
  document.getElementById("q-name").textContent = serving.name;
  document.getElementById("q-sub").textContent =
    serving.gender + " · " + serving.age + " years old";

  const chip = document.getElementById("q-priority");
  chip.className = "priority-chip " + serving.priority;
  chip.textContent =
    serving.priority.charAt(0).toUpperCase() + serving.priority.slice(1);

  const now = new Date();
  const hrs = now.getHours();
  const mins = now.getMinutes().toString().padStart(2, "0");
  const ampm = hrs >= 12 ? "PM" : "AM";
  const h = hrs % 12 || 12;
  document.getElementById("q-time").textContent =
    "Called at " + h + ":" + mins + " " + ampm;
}

// ── NEXT UP ──

function renderNextList() {
  const waiting = patients.filter((p) => p.status === "waiting").slice(0, 4);

  if (!waiting.length) {
    document.getElementById("next-list").innerHTML =
      '<div style="color:var(--text3);font-size:12px;padding:14px 0;text-align:center">No patients waiting</div>';
    return;
  }

  document.getElementById("next-list").innerHTML = waiting
    .map(
      (p) => `
    <div class="next-item">
      <div class="next-num">${p.q}</div>
      <div style="flex:1">
        <div class="next-pname">${p.name}</div>
        <div class="next-psub">${p.gender} · ${p.age}yrs · ${p.wait}</div>
      </div>
      <span class="priority-chip ${p.priority}" style="font-size:10px">${p.priority}</span>
    </div>
  `,
    )
    .join("");
}

// ── STATS ──

function updateStats() {
  const inQueue = patients.filter((p) => p.status !== "done").length;
  const waiting = patients.filter((p) => p.status === "waiting").length;

  document.getElementById("stat-queue").textContent = inQueue;
  document.getElementById("stat-waiting").textContent = waiting;
}

// ── QUEUE LINE TABLE ──

function buildRows(list) {
  const sorted = [...list].sort((a, b) => {
    const po = { high: 0, medium: 1, low: 2 };
    if (a.status === "serving") return -1;
    if (b.status === "serving") return 1;
    return po[a.priority] - po[b.priority];
  });

  if (!sorted.length) {
    return '<div class="q-item" style="color:var(--text3);font-size:12px;padding:18px 18px;grid-column:1/-1">No patients in this queue.</div>';
  }

  return sorted
    .map(
      (p) => `
    <div class="q-item">
      <div><span class="priority-chip ${p.priority}">${p.priority}</span></div>
      <div class="td-queue">${p.q}</div>
      <div style="font-weight:600;font-size:13px">${p.name}</div>
      <div><span class="status-badge ${p.status}">${p.status}</span></div>
      <div style="font-size:12px;color:var(--text3)">${p.counter}</div>
      <div class="ai-wait"><strong>${p.wait}</strong></div>
      <div>
        <div class="action-btns">
          <button class="act-btn" onclick="callPatient('${p.q}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            Call
          </button>
          <button class="act-btn del" onclick="deletePatient('${p.q}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            Remove
          </button>
        </div>
      </div>
    </div>
  `,
    )
    .join("");
}

function renderTable() {
  const pwd = patients.filter((p) => p.type === "pwd");
  const regular = patients.filter((p) => p.type === "regular");
  document.getElementById("line-count").textContent =
    "(" + patients.length + " patients)";
  document.getElementById("pwd-tbody").innerHTML = buildRows(pwd);
  document.getElementById("regular-tbody").innerHTML = buildRows(regular);
}

// ── QUEUE ACTIONS ──

function recallQueue() {
  const serving = patients.find((p) => p.status === "serving");
  if (!serving) {
    showToast("No patient currently being served.");
    return;
  }
  showToast("Queue #" + serving.q + " recalled — announcement sent");
}

function skipQueue() {
  const serving = patients.find((p) => p.status === "serving");
  const nextUp = patients.find((p) => p.status === "waiting");

  if (!nextUp) {
    showToast("No patients in queue to call next.");
    return;
  }

  if (serving) serving.status = "done";
  nextUp.status = "serving";

  renderServingCard();
  renderNextList();
  renderTable();
  updateStats();
  showToast("Now serving Queue #" + nextUp.q + " — " + nextUp.name);
}

function callPatient(q) {
  const p = patients.find((p) => p.q === q);
  showToast("Calling Queue #" + q + (p ? " — " + p.name : "") + "…");
}

function deletePatient(q) {
  const p = patients.find((p) => p.q === q);
  patients = patients.filter((p) => p.q !== q);
  renderTable();
  renderNextList();
  updateStats();
  showToast(
    "Patient #" + q + (p ? " (" + p.name + ")" : "") + " removed from queue",
  );
}

// ── AI PANEL ──

function toggleAI() {
  document.getElementById("ai-panel").classList.toggle("open");
}

function acceptAI() {
  const idx = patients.findIndex((p) => p.q === "047");
  if (idx > -1) {
    const removed = patients.splice(idx, 1)[0];
    removed.priority = "high";
    const firstWaiting = patients.findIndex((p) => p.status === "waiting");
    patients.splice(firstWaiting >= 0 ? firstWaiting : 0, 0, removed);
    renderTable();
    renderNextList();
  }
  document.getElementById("ai-panel").classList.remove("open");
  document.getElementById("ai-ping").style.display = "none";
  showToast("Q-047 Erlinda Cruz promoted to top of queue");
}

// ── MODAL ──

function openModal() {
  document.getElementById("modal-overlay").classList.add("open");
}

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
}

function closeModalOuter(e) {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
}

function addPatient() {
  const first = document.getElementById("f-first").value.trim();
  const last = document.getElementById("f-last").value.trim();
  if (!first || !last) {
    showToast("Please enter the patient's name.");
    return;
  }

  const gender = document.getElementById("f-gender").value;
  const age = parseInt(document.getElementById("f-age").value) || 0;
  const priority = document.getElementById("f-priority").value;
  const type = document.getElementById("f-type").value;
  const counter = document.getElementById("f-counter").value;

  const maxQ = patients.length
    ? Math.max(...patients.map((p) => parseInt(p.q)))
    : 48;
  const newQ = String(maxQ + 1).padStart(3, "0");
  const waitMins =
    patients.filter((p) => p.status === "waiting").length * 6 + 5;

  patients.push({
    q: newQ,
    name: first + " " + last,
    gender,
    age,
    priority,
    status: "waiting",
    counter,
    wait: "~" + waitMins + " min",
    type,
  });

  renderTable();
  renderNextList();
  updateStats();
  closeModal();

  ["f-first", "f-last", "f-age", "f-notes"].forEach(
    (id) => (document.getElementById(id).value = ""),
  );
  document.getElementById("f-priority").value = "medium";
  document.getElementById("f-type").value = "regular";

  showToast(first + " " + last + " added as Queue #" + newQ);
}

// ── NOTIFICATIONS ──

function toggleNotif() {
  document.getElementById("notif-panel").classList.toggle("open");
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#notif-btn") && !e.target.closest("#notif-panel")) {
    document.getElementById("notif-panel").classList.remove("open");
  }
});

// ── TOAST ──

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 3000);
}

// ── INIT ──
renderDepts();
