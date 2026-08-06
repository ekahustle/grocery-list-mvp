import {
  fetchRecipes,
  fetchIngredientsForRecipes,
  isSupabaseConfigured,
} from "./supabaseClient.js";
import {
  getLastSession,
  saveLastSession,
  getCurrentProgress,
  saveCurrentProgress,
  clearCurrentProgress,
} from "./storage.js";

const SLOT_COUNT = 15;
const MIN_FILLED = 5;

// Fallback gambar lokal (bundled di /images) untuk resep yang belum punya
// image_url di Supabase. Tambahkan entri baru di sini kalau ada resep baru
// dengan gambar lokal — kalau image_url sudah diisi di database, itu yang
// dipakai duluan (lihat imageUrlFor()).
const LOCAL_RECIPE_IMAGES = {
  "nasi goreng": "./images/nasi-goreng.jpeg",
  "ayam goreng lengkuas": "./images/ayam-goreng-lengkuas.jpeg",
  "sup bening bayam": "./images/sayur-bayam-bening.jpeg",
  "telur dadar": "./images/telur-dadar.jpeg",
  "tumis kangkung": "./images/tumis-kangkung.jpeg",
};

function imageUrlFor(recipe) {
  return recipe.image_url || LOCAL_RECIPE_IMAGES[(recipe.name || "").trim().toLowerCase()] || null;
}

const appEl = document.getElementById("app");
const stepperEl = document.getElementById("stepper");

// State di memori. Sumber kebenaran untuk "progress minggu ini" tetap
// disalin ke localStorage lewat saveCurrentProgress() supaya tahan refresh.
let allRecipes = [];
let progress = getCurrentProgress() || {
  step: 1,
  menuSlots: Array(SLOT_COUNT).fill(null),
  mergedIngredients: [],
  reviewStatuses: {},
  checklist: {},
};

function persist() {
  saveCurrentProgress(progress);
}

function setStep(step) {
  progress.step = step;
  persist();
  render();
}

// ---------------------------------------------------------------------------
// Stepper header
// ---------------------------------------------------------------------------
function renderStepper() {
  const steps = [
    { n: 1, label: "Pilih Menu" },
    { n: 2, label: "Review Stok" },
    { n: 3, label: "Belanja" },
  ];
  stepperEl.innerHTML = steps
    .map((s, i) => {
      const state =
        s.n === progress.step
          ? "active"
          : s.n < progress.step
          ? "done"
          : "todo";
      return `
        <div class="step step--${state}">
          <span class="step__dot">${s.n < progress.step ? "✓" : s.n}</span>
          <span class="step__label">${s.label}</span>
        </div>
        ${i < steps.length - 1 ? '<span class="step__line"></span>' : ""}
      `;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Step 1 — Pilih Menu Mingguan (grid)
// ---------------------------------------------------------------------------
async function renderStep1() {
  appEl.innerHTML = `
    <section class="panel">
      <h1 class="panel__title">Pilih Menu Minggu Ini</h1>
      <p class="panel__desc">Isi minimal 5 dari 15 slot menu. Klik sebuah slot untuk memilih resep dari menu bank — resep yang sama boleh dipakai di beberapa slot. Bahan-bahannya nanti otomatis digabung tanpa duplikasi.</p>
      <div id="recipe-status" class="status"></div>
      <div id="menu-slot-grid" class="menu-slot-grid"></div>
      <div class="panel__footer">
        <span id="selection-count" class="badge-mono">0/${SLOT_COUNT} terisi</span>
        <button id="btn-next" class="btn btn--primary" disabled>Lanjut ke Review Stok →</button>
      </div>
    </section>
  `;

  const statusEl = document.getElementById("recipe-status");
  const gridEl = document.getElementById("menu-slot-grid");
  const countEl = document.getElementById("selection-count");
  const nextBtn = document.getElementById("btn-next");

  if (!isSupabaseConfigured) {
    statusEl.innerHTML = `<div class="alert alert--warning">Supabase belum dikonfigurasi. Isi <code>js/config.js</code> dengan URL dan anon key project Supabase kamu, lalu muat ulang halaman.</div>`;
    return;
  }

  statusEl.innerHTML = `<div class="alert alert--info">Memuat menu bank…</div>`;

  try {
    if (allRecipes.length === 0) {
      allRecipes = await fetchRecipes();
    }
    statusEl.innerHTML = "";
  } catch (err) {
    statusEl.innerHTML = `<div class="alert alert--error">Gagal memuat menu: ${escapeHtml(
      err.message || String(err)
    )}</div>`;
    return;
  }

  if (allRecipes.length === 0) {
    statusEl.innerHTML = `<div class="alert alert--warning">Menu bank masih kosong. Tambahkan resep lewat Supabase Table Editor / SQL Editor.</div>`;
    return;
  }

  let openSlotIndex = null;

  function renderGrid() {
    gridEl.innerHTML = Array.from({ length: SLOT_COUNT }, (_, i) => slotHtml(i)).join("");
    attachSlotHandlers();
    updateSelectionUi();
  }

  function slotHtml(index) {
    const recipeId = progress.menuSlots[index];
    const recipe = recipeId ? allRecipes.find((r) => String(r.id) === String(recipeId)) : null;
    const isOpen = openSlotIndex === index;
    return `
      <div class="menu-slot ${recipe ? "menu-slot--filled" : ""} ${isOpen ? "menu-slot--open" : ""}" data-index="${index}">
        <button type="button" class="menu-slot__trigger">
          ${
            recipe
              ? slotFilledBodyHtml(recipe)
              : `<span class="menu-slot__index">${index + 1}</span><span class="menu-slot__placeholder">+ Pilih menu</span>`
          }
        </button>
        ${isOpen ? slotAccordionHtml(recipe) : ""}
      </div>
    `;
  }

  function slotFilledBodyHtml(recipe) {
    const initial = (recipe.name || "?").trim().charAt(0).toUpperCase();
    const imgUrl = imageUrlFor(recipe);
    return `
      ${
        imgUrl
          ? `<img class="menu-slot__img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(recipe.name)}" />`
          : `<div class="menu-slot__img menu-slot__img--placeholder">${initial}</div>`
      }
      <span class="menu-slot__name">${escapeHtml(recipe.name)}</span>
    `;
  }

  function slotAccordionHtml(currentRecipe) {
    return `
      <div class="menu-slot__accordion-panel">
        <div class="menu-slot__accordion-list">
          ${allRecipes
            .map((r) => {
              const initial = (r.name || "?").trim().charAt(0).toUpperCase();
              const selected = currentRecipe && currentRecipe.id === r.id;
              const imgUrl = imageUrlFor(r);
              return `
                <button type="button" class="menu-slot__option ${selected ? "menu-slot__option--selected" : ""}" data-recipe-id="${r.id}">
                  ${
                    imgUrl
                      ? `<img class="menu-slot__option-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(r.name)}" />`
                      : `<div class="menu-slot__option-img menu-slot__option-img--placeholder">${initial}</div>`
                  }
                  <span class="menu-slot__option-name">${escapeHtml(r.name)}</span>
                </button>
              `;
            })
            .join("")}
        </div>
        ${
          currentRecipe
            ? `<button type="button" class="menu-slot__clear">Kosongkan slot</button>`
            : ""
        }
      </div>
    `;
  }

  function attachSlotHandlers() {
    gridEl.querySelectorAll(".menu-slot").forEach((slotEl) => {
      const index = Number(slotEl.dataset.index);

      slotEl.querySelector(".menu-slot__trigger").addEventListener("click", () => {
        openSlotIndex = openSlotIndex === index ? null : index;
        renderGrid();
      });

      slotEl.querySelectorAll(".menu-slot__option").forEach((optionEl) => {
        optionEl.addEventListener("click", (e) => {
          e.stopPropagation();
          progress.menuSlots[index] = optionEl.dataset.recipeId;
          persist();
          openSlotIndex = null;
          renderGrid();
        });
      });

      const clearBtn = slotEl.querySelector(".menu-slot__clear");
      if (clearBtn) {
        clearBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          progress.menuSlots[index] = null;
          persist();
          openSlotIndex = null;
          renderGrid();
        });
      }
    });
  }

  function updateSelectionUi() {
    const count = progress.menuSlots.filter(Boolean).length;
    countEl.textContent = `${count}/${SLOT_COUNT} terisi`;
    countEl.classList.toggle("badge-mono--ok", count >= MIN_FILLED);
    nextBtn.disabled = count < MIN_FILLED;
  }

  renderGrid();

  nextBtn.addEventListener("click", async () => {
    nextBtn.disabled = true;
    nextBtn.textContent = "Memuat bahan…";
    try {
      await proceedToReview();
    } catch (err) {
      statusEl.innerHTML = `<div class="alert alert--error">Gagal memuat bahan: ${escapeHtml(
        err.message || String(err)
      )}</div>`;
      nextBtn.disabled = false;
      nextBtn.textContent = "Lanjut ke Review Stok →";
    }
  });
}

// Gabungkan bahan dari resep terpilih, dedupe pakai ingredient_id (bukan
// pencocokan nama/string) sebagai kunci.
async function proceedToReview() {
  const filledRecipeIds = [...new Set(progress.menuSlots.filter(Boolean))];
  const rows = await fetchIngredientsForRecipes(filledRecipeIds);

  const merged = new Map(); // ingredient_id -> { id, name, category }
  for (const row of rows) {
    const ing = row.ingredients;
    if (!ing) continue;
    if (!merged.has(ing.id)) {
      merged.set(ing.id, { id: ing.id, name: ing.name, category: ing.category || "Lainnya" });
    }
  }

  progress.mergedIngredients = Array.from(merged.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "id")
  );

  // Bangun default status review berdasarkan riwayat sesi terakhir.
  const lastSession = getLastSession();
  const lastStatuses = lastSession ? lastSession.statuses || {} : {};
  const defaults = {};
  for (const ing of progress.mergedIngredients) {
    defaults[ing.id] = lastStatuses[ing.id] === "ada" ? "ada" : "tidak_ada";
  }
  progress.reviewStatuses = defaults;
  progress.checklist = {};
  setStep(2);
}

// ---------------------------------------------------------------------------
// Step 2 — Review Stok (berbasis riwayat 1 minggu terakhir)
// ---------------------------------------------------------------------------
function renderStep2() {
  const lastSession = getLastSession();
  const lastStatuses = lastSession ? lastSession.statuses || {} : {};

  const reviewGroup = [];
  const newGroup = [];
  for (const ing of progress.mergedIngredients) {
    if (lastStatuses[ing.id] === "ada") {
      reviewGroup.push(ing);
    } else {
      newGroup.push(ing);
    }
  }

  appEl.innerHTML = `
    <section class="panel">
      <h1 class="panel__title">Review Stok Bahan</h1>
      <p class="panel__desc">Tandai bahan mana yang sudah ada di rumah (<strong>Ada</strong>) dan mana yang perlu dibeli (<strong>Tidak Ada</strong>).</p>

      ${
        reviewGroup.length
          ? `
        <div class="group">
          <h2 class="group__title">🔄 Perlu Direview Ulang <span class="group__count">${reviewGroup.length}</span></h2>
          <p class="group__hint">Minggu lalu statusnya "Ada" — cek lagi apakah masih tersedia.</p>
          <div class="ingredient-list" id="review-group"></div>
        </div>`
          : ""
      }

      ${
        newGroup.length
          ? `
        <div class="group">
          <h2 class="group__title">🆕 Stok Baru <span class="group__count">${newGroup.length}</span></h2>
          <p class="group__hint">Belum ada riwayat untuk bahan ini.</p>
          <div class="ingredient-list" id="new-group"></div>
        </div>`
          : ""
      }

      <div class="panel__footer">
        <button id="btn-back" class="btn btn--ghost">← Ubah Menu</button>
        <button id="btn-finish-review" class="btn btn--primary">Selesai Review →</button>
      </div>
    </section>
  `;

  const reviewListEl = document.getElementById("review-group");
  const newListEl = document.getElementById("new-group");
  if (reviewListEl) reviewListEl.innerHTML = reviewGroup.map(ingredientRowHtml).join("");
  if (newListEl) newListEl.innerHTML = newGroup.map(ingredientRowHtml).join("");

  appEl.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".ingredient-row");
      const id = row.dataset.id;
      const status = btn.dataset.status;
      progress.reviewStatuses[id] = status;
      persist();
      row.querySelectorAll(".toggle-btn").forEach((b) => {
        b.classList.toggle("toggle-btn--active", b.dataset.status === status);
      });
    });
  });

  document.getElementById("btn-back").addEventListener("click", () => setStep(1));
  document.getElementById("btn-finish-review").addEventListener("click", () => {
    // Simpan sesi ini sebagai riwayat terbaru. Bahan minggu lalu yang tidak
    // muncul lagi di daftar minggu ini otomatis tidak ikut tersimpan --
    // artinya status lamanya hangus dengan sendirinya.
    saveLastSession(progress.reviewStatuses);

    progress.checklist = {};
    for (const ing of progress.mergedIngredients) {
      if (progress.reviewStatuses[ing.id] === "tidak_ada") {
        progress.checklist[ing.id] = false;
      }
    }
    setStep(3);
  });
}

function ingredientRowHtml(ing) {
  const status = progress.reviewStatuses[ing.id] || "tidak_ada";
  return `
    <div class="ingredient-row" data-id="${ing.id}">
      <div class="ingredient-row__info">
        <span class="ingredient-row__name">${escapeHtml(ing.name)}</span>
        <span class="tag">${escapeHtml(ing.category || "Lainnya")}</span>
      </div>
      <div class="toggle">
        <button class="toggle-btn toggle-btn--ada ${status === "ada" ? "toggle-btn--active" : ""}" data-status="ada">Ada</button>
        <button class="toggle-btn toggle-btn--tidak ${status === "tidak_ada" ? "toggle-btn--active" : ""}" data-status="tidak_ada">Tidak Ada</button>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Step 3 — Grocery List Final (checklist, satu halaman)
// ---------------------------------------------------------------------------
function renderStep3() {
  const toBuy = progress.mergedIngredients.filter(
    (ing) => progress.reviewStatuses[ing.id] === "tidak_ada"
  );

  const byCategory = new Map();
  for (const ing of toBuy) {
    const cat = ing.category || "Lainnya";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(ing);
  }

  const total = toBuy.length;
  const boughtCount = toBuy.filter((ing) => progress.checklist[ing.id]).length;

  appEl.innerHTML = `
    <section class="panel">
      <h1 class="panel__title">Grocery List Minggu Ini</h1>
      <p class="panel__desc">Bahan yang perlu dibeli, digabung otomatis dari semua menu terpilih.</p>

      ${
        total === 0
          ? `<div class="alert alert--success">Semua bahan sudah tersedia di rumah. Tidak perlu belanja! 🎉</div>`
          : `
        <div class="progress-bar">
          <div class="progress-bar__fill" style="width:${Math.round((boughtCount / total) * 100)}%"></div>
        </div>
        <p class="progress-label"><span class="badge-mono">${boughtCount}/${total} dibeli</span></p>
        <div id="grocery-groups"></div>
      `
      }

      <div class="panel__footer">
        <button id="btn-back-review" class="btn btn--ghost">← Edit Review Stok</button>
        <button id="btn-new-week" class="btn btn--primary">Mulai Minggu Baru</button>
      </div>
    </section>
  `;

  if (total > 0) {
    const groupsEl = document.getElementById("grocery-groups");
    groupsEl.innerHTML = Array.from(byCategory.entries())
      .map(
        ([cat, items]) => `
        <div class="group">
          <h2 class="group__title">${escapeHtml(cat)}</h2>
          <div class="checklist">
            ${items
              .map(
                (ing) => `
              <label class="checklist-item ${progress.checklist[ing.id] ? "checklist-item--done" : ""}" data-id="${ing.id}">
                <input type="checkbox" ${progress.checklist[ing.id] ? "checked" : ""} />
                <span class="checklist-item__name">${escapeHtml(ing.name)}</span>
              </label>
            `
              )
              .join("")}
          </div>
        </div>
      `
      )
      .join("");

    groupsEl.querySelectorAll(".checklist-item").forEach((item) => {
      item.querySelector("input").addEventListener("change", (e) => {
        const id = item.dataset.id;
        progress.checklist[id] = e.target.checked;
        persist();
        item.classList.toggle("checklist-item--done", e.target.checked);
        renderProgressBarOnly();
      });
    });
  }

  function renderProgressBarOnly() {
    const bought = toBuy.filter((ing) => progress.checklist[ing.id]).length;
    const fill = document.querySelector(".progress-bar__fill");
    const label = document.querySelector(".progress-label .badge-mono");
    if (fill) fill.style.width = `${Math.round((bought / total) * 100)}%`;
    if (label) label.textContent = `${bought}/${total} dibeli`;
  }

  document.getElementById("btn-back-review").addEventListener("click", () => setStep(2));
  document.getElementById("btn-new-week").addEventListener("click", () => {
    clearCurrentProgress();
    progress = {
      step: 1,
      menuSlots: Array(SLOT_COUNT).fill(null),
      mergedIngredients: [],
      reviewStatuses: {},
      checklist: {},
    };
    render();
  });
}

// ---------------------------------------------------------------------------
// Router sederhana + util
// ---------------------------------------------------------------------------
function render() {
  renderStepper();
  if (progress.step === 1) renderStep1();
  else if (progress.step === 2) renderStep2();
  else renderStep3();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

render();
