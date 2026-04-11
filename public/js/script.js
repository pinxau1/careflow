let index = document.getElementById('indexFlow');
let patient = document.getElementById('patientFlow');

if (index) {

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  $$(".feature-list li").forEach(item => {
    item.addEventListener("click", () => {
      $$(".feature-list li").forEach(i => i.classList.remove("active-feature"));
      item.classList.add("active-feature");

      const page = item.dataset.page;

      $$(".page").forEach(p => p.classList.add("hidden"));
      $("#page-" + page).classList.remove("hidden");

      $("#page-title").textContent =
        page === "dashboard" ? "Queue Dashboard" : "Settings";
    });
  });

  const backdrop = $("#modal-backdrop");

  function openModal(id) {
    backdrop.classList.remove("hidden");
    $("#" + id).classList.remove("hidden");
  }

  function closeModal(id) {
    backdrop.classList.add("hidden");
    $("#" + id).classList.add("hidden");
  }

  $("#btn-add-patient-open").onclick = () => openModal("modal-add-patient");
  $("#btn-quick-add-open").onclick = () => openModal("modal-quick-add");
  $("#btn-emergency-open").onclick = () => openModal("modal-emergency");

  $$(".modal-close, [data-modal]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.modal;
      closeModal(id);
    });
  });

  backdrop.onclick = () => {
    $$(".modal").forEach(m => m.classList.add("hidden"));
    backdrop.classList.add("hidden");
  };

  let selectedCategory = null;

  $$(".cat-btn").forEach(btn => {
    btn.onclick = () => {
      $$(".cat-btn").forEach(b => b.classList.remove("active-cat"));
      btn.classList.add("active-cat");

      selectedCategory = btn.dataset.prefix;

      $("#preview-code").textContent = selectedCategory + "001";
      $("#preview-sub").textContent = "Next available code";
    };
  });

  $$(".visit-btn").forEach(btn => {
    btn.onclick = () => {
      $$(".visit-btn").forEach(b => b.classList.remove("active-visit"));
      btn.classList.add("active-visit");
    };
  });

  $$(".mode-btn").forEach(btn => {
    btn.onclick = () => {
      $$(".mode-btn").forEach(b => b.classList.remove("active-mode"));
      btn.classList.add("active-mode");
    };
  });




  $("#filter-btn").onclick = () => {
    $("#filter-menu").classList.toggle("hidden");
  };

  $$(".filter-option").forEach(opt => {
    opt.onclick = () => {
      $$(".filter-option").forEach(o => o.classList.remove("active"));
      opt.classList.add("active");

      $("#filter-btn").innerHTML = `
        <span class="material-symbols-outlined">filter_list</span>
        Filter: ${opt.textContent}
        <span class="material-symbols-outlined">arrow_drop_down</span>
      `;

      $("#filter-menu").classList.add("hidden");
    };
  });




  $("#queue-search").addEventListener("input", (e) => {
    const val = e.target.value.toLowerCase();

    $$("#queue-table tbody tr").forEach(row => {
      const text = row.innerText.toLowerCase();
      row.style.display = text.includes(val) ? "" : "none";
    });
  });




  const status = $("#queue-status");

  status.querySelectorAll("div").forEach(btn => {
    btn.onclick = () => {
      status.dataset.status = btn.dataset.value;
    };
  });




  $("#btn-call-next").onclick = () => {
    const code = $("#current-queue").textContent;
    const name = $("#serving-name").textContent;

    showToast("toast-calling", `${code} — ${name}`);
  };




  function showToast(id, msg) {
    const toast = $("#" + id);
    if (msg) {
      const el = toast.querySelector(".toast-msg");
      if (el) el.textContent = msg;
    }

    toast.classList.remove("hidden");

    setTimeout(() => {
      toast.classList.add("hidden");
    }, 3000);
  }




  let voidTarget = null;

  $$("[data-action='void']").forEach(btn => {
    btn.onclick = () => {
      voidTarget = btn.closest("tr");

      $("#void-patient-label").textContent = btn.dataset.name;
      openModal("modal-void");
    };
  });

  $("#btn-confirm-void").onclick = () => {
    if (voidTarget) {
      voidTarget.remove();
      voidTarget = null;
    }
    closeModal("modal-void");
  };




  $$(".banner-close").forEach(btn => {
    btn.onclick = () => {
      $("#" + btn.dataset.target).classList.add("hidden");
    };
  });




  $$(".counter-tab").forEach(tab => {
    tab.onclick = () => {
      $$(".counter-tab").forEach(t => t.classList.remove("active-tab"));
      tab.classList.add("active-tab");

      const counter = tab.dataset.counter;

      $$(".counter-card").forEach(card => {
        if (counter === "all" || card.dataset.counter === counter) {
          card.style.display = "";
        } else {
          card.style.display = "none";
        }
      });
    };
  });

  let logout = document.getElementById('btn-logout');

  logout.addEventListener("click", async (e) => {
    e.preventDefault();

    try {
      await fetch('/logout', {
        method: 'POST',
        credentials: 'include'
      });

      window.location.href = '/login.html';
    } catch (err) {
      console.error('Logout failed', err);
    }
  })
}

if (patient) {
  function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  const addQueueForm = document.getElementById('add-queue-form');

  addQueueForm.addEventListener('submit', async (e) => {

    e.preventDefault();
    const patientName = addQueueForm.name.value;
    const serviceType = addQueueForm.serviceType.value;
    const concern = addQueueForm.concern.value;

    try {
      const res = await fetch('api/queue/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientName, serviceType, concern })
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error);
        showToast(data.error || 'Failed');
        return;
      }

      showToast(`Queued: ${data.code}`);
    } catch (err) {
      showToast('Server error');
    }

    showToast('Successfully submitted');



  });
}
