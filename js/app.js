import {
  fetchRecipes,
  fetchIngredientsForRecipes,
  fetchAllIngredients,
  insertRecipe,
  insertIngredient,
  insertRecipeIngredients,
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
const modalRootEl = document.getElementById("modal-root");

// State di memori. Sumber kebenaran untuk "progress minggu ini" tetap
// disalin ke localStorage lewat saveCurrentProgress() supaya tahan refresh.
let allRecipes = [];
let allIngredients = []; // cache untuk autocomplete di form "Tambah Menu"
let addRecipeState = null; // state form modal "Tambah Menu", null kalau modal tertutup
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
async function renderStep1(options = {}) {
  appEl.innerHTML = `
    <section class="panel">
      <h1 class="panel__title">Pilih Menu Minggu Ini</h1>
      <p class="panel__desc">Isi minimal 5 dari 15 slot menu. Klik sebuah slot untuk memilih resep dari menu bank — resep yang sama boleh dipakai di beberapa slot. Bahan-bahannya nanti otomatis digabung tanpa duplikasi.</p>
      <div class="panel__toolbar">
        <button type="button" id="btn-add-recipe" class="btn btn--ghost btn--sm">+ Tambah Menu Baru</button>
      </div>
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
  const addRecipeBtn = document.getElementById("btn-add-recipe");

  addRecipeBtn.addEventListener("click", () => {
    if (!isSupabaseConfigured) {
      statusEl.innerHTML = `<div class="alert alert--warning">Supabase belum dikonfigurasi. Isi <code>js/config.js</code> dengan URL dan anon key project Supabase kamu, lalu muat ulang halaman.</div>`;
      return;
    }
    openAddRecipeModal();
  });

  if (!isSupabaseConfigured) {
    statusEl.innerHTML = `<div class="alert alert--warning">Supabase belum dikonfigurasi. Isi <code>js/config.js</code> dengan URL dan anon key project Supabase kamu, lalu muat ulang halaman.</div>`;
    return;
  }

  statusEl.innerHTML = `<div class="alert alert--info">Memuat menu bank…</div>`;

  try {
    if (allRecipes.length === 0) {
      allRecipes = await fetchRecipes();
    }
    statusEl.innerHTML = options.successMessage
      ? `<div class="alert alert--success">${escapeHtml(options.successMessage)}</div>`
      : "";
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
// Modal "Tambah Menu Baru" — dipicu dari Step 1, tidak mengubah progress.step
// ---------------------------------------------------------------------------
function handleModalKeydown(e) {
  if (e.key === "Escape") closeAddRecipeModal();
}

async function openAddRecipeModal() {
  addRecipeState = {
    name: "",
    description: "",
    imageUrl: "",
    selectedIngredients: [], // { id, tempId, name, category, isNew }
    searchQuery: "",
    newIngredientDraft: null, // { name, category, useCustomCategory, customCategory }
    createdRecipeId: null,
    createdRecipeObj: null,
    submitting: false,
    loadingIngredients: allIngredients.length === 0,
  };

  renderAddRecipeModal();
  document.addEventListener("keydown", handleModalKeydown);

  if (allIngredients.length === 0) {
    try {
      allIngredients = await fetchAllIngredients();
    } catch (err) {
      // Biarkan modal tetap terbuka -- pencarian bahan existing akan kosong,
      // tapi menambah bahan baru & submit tetap bisa dicoba (error yang
      // sebenarnya, kalau ada, akan muncul lagi saat submit).
      allIngredients = [];
    }
    if (!addRecipeState) return; // modal sudah ditutup selagi fetch berjalan
    addRecipeState.loadingIngredients = false;
    const searchInput = document.getElementById("modal-ingredient-search");
    if (searchInput) {
      searchInput.disabled = false;
      searchInput.placeholder = "Cari atau tambah bahan…";
    }
    renderModalAutocomplete();
  }
}

function closeAddRecipeModal() {
  if (addRecipeState && addRecipeState.submitting) return;
  modalRootEl.innerHTML = "";
  document.removeEventListener("keydown", handleModalKeydown);
  addRecipeState = null;
}

function renderAddRecipeModal() {
  const s = addRecipeState;
  modalRootEl.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-header">
          <h2 class="modal-title" id="modal-title">Tambah Menu Baru</h2>
          <button type="button" class="modal-close" id="modal-close" aria-label="Tutup">×</button>
        </div>
        <form id="add-recipe-form" novalidate>
          <div class="modal-body">
            <div id="modal-form-error"></div>
            <div class="field">
              <label class="field__label" for="modal-name">Nama Resep *</label>
              <input type="text" id="modal-name" class="input" placeholder="Contoh: Nasi Goreng" value="${escapeHtml(s.name)}" />
            </div>
            <div class="field">
              <label class="field__label" for="modal-description">Deskripsi</label>
              <textarea id="modal-description" class="input" placeholder="Opsional">${escapeHtml(s.description)}</textarea>
            </div>
            <div class="field">
              <label class="field__label" for="modal-image-url">URL Gambar</label>
              <input type="url" id="modal-image-url" class="input" placeholder="https://... (opsional)" value="${escapeHtml(s.imageUrl)}" />
            </div>
            <div class="field">
              <label class="field__label" for="modal-ingredient-search">Bahan-Bahan *</label>
              <div class="ingredient-picker">
                <input
                  type="text"
                  id="modal-ingredient-search"
                  class="input"
                  placeholder="${s.loadingIngredients ? "Memuat daftar bahan…" : "Cari atau tambah bahan…"}"
                  autocomplete="off"
                  value="${escapeHtml(s.searchQuery)}"
                  ${s.loadingIngredients ? "disabled" : ""}
                />
                <div class="ingredient-picker__dropdown" id="modal-autocomplete-results"></div>
              </div>
              <div class="selected-ingredient-list" id="modal-ingredient-list"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn--ghost" id="modal-cancel">Batal</button>
            <button type="submit" class="btn btn--primary" id="modal-submit">Simpan Menu</button>
          </div>
        </form>
      </div>
    </div>
  `;

  renderModalIngredientList();
  renderModalAutocomplete();
  attachAddRecipeModalHandlers();

  const nameInput = document.getElementById("modal-name");
  if (nameInput) nameInput.focus();
}

function attachAddRecipeModalHandlers() {
  document.getElementById("modal-name").addEventListener("input", (e) => {
    addRecipeState.name = e.target.value;
  });
  document.getElementById("modal-description").addEventListener("input", (e) => {
    addRecipeState.description = e.target.value;
  });
  document.getElementById("modal-image-url").addEventListener("input", (e) => {
    addRecipeState.imageUrl = e.target.value;
  });
  document.getElementById("modal-ingredient-search").addEventListener("input", (e) => {
    addRecipeState.searchQuery = e.target.value;
    addRecipeState.newIngredientDraft = null;
    renderModalAutocomplete();
  });

  document.getElementById("modal-close").addEventListener("click", closeAddRecipeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeAddRecipeModal);
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeAddRecipeModal();
  });

  // Cegah Enter di field manapun (search bahan, sub-form bahan baru, dst)
  // ikut men-submit form utama secara tidak sengaja -- submit hanya lewat
  // klik tombol "Simpan Menu".
  document.getElementById("add-recipe-form").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.tagName === "TEXTAREA" || e.target.id === "modal-submit") return;
    e.preventDefault();
  });

  document.getElementById("add-recipe-form").addEventListener("submit", (e) => {
    e.preventDefault();
    handleAddRecipeSubmit();
  });
}

function deriveIngredientCategories() {
  const categories = new Set();
  for (const ing of allIngredients) {
    if (ing.category) categories.add(ing.category);
  }
  return Array.from(categories).sort((a, b) => a.localeCompare(b, "id"));
}

function renderModalIngredientList() {
  const listEl = document.getElementById("modal-ingredient-list");
  if (!listEl) return;

  if (addRecipeState.selectedIngredients.length === 0) {
    listEl.innerHTML = `<p class="selected-ingredient-list__empty">Belum ada bahan ditambahkan.</p>`;
    return;
  }

  listEl.innerHTML = addRecipeState.selectedIngredients
    .map(
      (ing) => `
      <div class="selected-ingredient-row">
        <span class="selected-ingredient-row__name">${escapeHtml(ing.name)}</span>
        ${ing.category ? `<span class="tag">${escapeHtml(ing.category)}</span>` : ""}
        ${ing.isNew ? `<span class="tag tag--new">baru</span>` : ""}
        <button type="button" class="selected-ingredient-row__remove" data-temp-id="${escapeHtml(ing.tempId)}" aria-label="Hapus bahan">×</button>
      </div>`
    )
    .join("");

  listEl.querySelectorAll(".selected-ingredient-row__remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tempId = btn.dataset.tempId;
      addRecipeState.selectedIngredients = addRecipeState.selectedIngredients.filter(
        (ing) => ing.tempId !== tempId
      );
      renderModalIngredientList();
      renderModalAutocomplete();
    });
  });
}

function renderModalAutocomplete() {
  const dropdownEl = document.getElementById("modal-autocomplete-results");
  if (!dropdownEl) return;

  if (addRecipeState.newIngredientDraft) {
    dropdownEl.innerHTML = newIngredientFormHtml(addRecipeState.newIngredientDraft);
    attachNewIngredientFormHandlers();
    return;
  }

  const query = addRecipeState.searchQuery.trim();
  if (!query) {
    dropdownEl.innerHTML = "";
    return;
  }

  const selectedIds = new Set(
    addRecipeState.selectedIngredients.filter((ing) => ing.id).map((ing) => ing.id)
  );
  const lowerQuery = query.toLowerCase();
  const matches = allIngredients
    .filter((ing) => !selectedIds.has(ing.id) && ing.name.toLowerCase().includes(lowerQuery))
    .slice(0, 8);
  const exactMatch = allIngredients.some((ing) => ing.name.toLowerCase() === lowerQuery);

  const optionsHtml = matches
    .map(
      (ing) => `
      <button type="button" class="ingredient-picker__option" data-ingredient-id="${ing.id}">
        <span>${escapeHtml(ing.name)}</span>
        ${ing.category ? `<span class="tag">${escapeHtml(ing.category)}</span>` : ""}
      </button>`
    )
    .join("");

  const addNewHtml = exactMatch
    ? ""
    : `<button type="button" class="ingredient-picker__option ingredient-picker__option--add-new" id="modal-add-new-ingredient">
        + Tambah bahan baru: "${escapeHtml(query)}"
      </button>`;

  dropdownEl.innerHTML = optionsHtml + addNewHtml;

  dropdownEl.querySelectorAll(".ingredient-picker__option[data-ingredient-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ing = allIngredients.find((i) => String(i.id) === String(btn.dataset.ingredientId));
      if (!ing) return;
      addRecipeState.selectedIngredients.push({
        id: ing.id,
        tempId: String(ing.id),
        name: ing.name,
        category: ing.category || "",
        isNew: false,
      });
      addRecipeState.searchQuery = "";
      const searchInput = document.getElementById("modal-ingredient-search");
      if (searchInput) searchInput.value = "";
      renderModalIngredientList();
      renderModalAutocomplete();
    });
  });

  const addNewBtn = document.getElementById("modal-add-new-ingredient");
  if (addNewBtn) {
    addNewBtn.addEventListener("click", () => {
      addRecipeState.newIngredientDraft = {
        name: query,
        category: "",
        useCustomCategory: false,
        customCategory: "",
      };
      renderModalAutocomplete();
    });
  }
}

function newIngredientFormHtml(draft) {
  const categories = deriveIngredientCategories();
  return `
    <div class="new-ingredient-form">
      <div class="field">
        <label class="field__label" for="modal-new-ing-name">Nama Bahan Baru</label>
        <input type="text" id="modal-new-ing-name" class="input" value="${escapeHtml(draft.name)}" />
      </div>
      <div class="field">
        <label class="field__label" for="modal-new-ing-category">Kategori</label>
        <select id="modal-new-ing-category" class="input">
          <option value="">— Pilih kategori —</option>
          ${categories
            .map(
              (c) =>
                `<option value="${escapeHtml(c)}" ${draft.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`
            )
            .join("")}
          <option value="__custom__" ${draft.useCustomCategory ? "selected" : ""}>Lainnya (isi manual)</option>
        </select>
      </div>
      ${
        draft.useCustomCategory
          ? `<div class="field">
              <label class="field__label" for="modal-new-ing-custom-category">Kategori Baru</label>
              <input type="text" id="modal-new-ing-custom-category" class="input" placeholder="Contoh: Camilan" value="${escapeHtml(draft.customCategory)}" />
            </div>`
          : ""
      }
      <div class="new-ingredient-form__actions">
        <button type="button" class="btn btn--ghost btn--sm" id="modal-new-ing-cancel">Batal</button>
        <button type="button" class="btn btn--primary btn--sm" id="modal-new-ing-confirm">Tambah Bahan</button>
      </div>
    </div>
  `;
}

function attachNewIngredientFormHandlers() {
  const nameInput = document.getElementById("modal-new-ing-name");
  const categorySelect = document.getElementById("modal-new-ing-category");
  const customCategoryInput = document.getElementById("modal-new-ing-custom-category");
  const cancelBtn = document.getElementById("modal-new-ing-cancel");
  const confirmBtn = document.getElementById("modal-new-ing-confirm");

  if (nameInput) {
    nameInput.addEventListener("input", (e) => {
      addRecipeState.newIngredientDraft.name = e.target.value;
    });
  }
  if (categorySelect) {
    categorySelect.addEventListener("change", (e) => {
      const value = e.target.value;
      addRecipeState.newIngredientDraft.useCustomCategory = value === "__custom__";
      addRecipeState.newIngredientDraft.category = value === "__custom__" ? "" : value;
      renderModalAutocomplete();
    });
  }
  if (customCategoryInput) {
    customCategoryInput.addEventListener("input", (e) => {
      addRecipeState.newIngredientDraft.customCategory = e.target.value;
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      addRecipeState.newIngredientDraft = null;
      renderModalAutocomplete();
    });
  }
  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      const draft = addRecipeState.newIngredientDraft;
      const name = draft.name.trim();
      if (!name) return;
      const category = (draft.useCustomCategory ? draft.customCategory : draft.category).trim();
      addRecipeState.selectedIngredients.push({
        id: null,
        tempId: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        category,
        isNew: true,
      });
      addRecipeState.newIngredientDraft = null;
      addRecipeState.searchQuery = "";
      const searchInput = document.getElementById("modal-ingredient-search");
      if (searchInput) searchInput.value = "";
      renderModalIngredientList();
      renderModalAutocomplete();
    });
  }
}

async function handleAddRecipeSubmit() {
  const s = addRecipeState;
  const errorEl = document.getElementById("modal-form-error");
  const submitBtn = document.getElementById("modal-submit");

  const name = s.name.trim();
  if (!name) {
    errorEl.innerHTML = `<div class="alert alert--error">Nama resep wajib diisi.</div>`;
    const nameInput = document.getElementById("modal-name");
    if (nameInput) nameInput.focus();
    return;
  }
  if (s.selectedIngredients.length === 0) {
    errorEl.innerHTML = `<div class="alert alert--error">Tambahkan minimal 1 bahan untuk resep ini.</div>`;
    return;
  }

  errorEl.innerHTML = "";
  s.submitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Menyimpan…";

  try {
    if (!s.createdRecipeId) {
      const recipe = await insertRecipe({
        name,
        description: s.description.trim() || null,
        image_url: s.imageUrl.trim() || null,
      });
      s.createdRecipeId = recipe.id;
      s.createdRecipeObj = recipe;
    }

    const resolvedIds = [];
    for (const ing of s.selectedIngredients) {
      if (!ing.id) {
        const created = await insertIngredient({ name: ing.name, category: ing.category || null });
        ing.id = created.id;
        if (!allIngredients.some((i) => i.id === created.id)) {
          allIngredients.push(created);
        }
      }
      resolvedIds.push(ing.id);
    }

    await insertRecipeIngredients(s.createdRecipeId, resolvedIds);

    allRecipes.push(s.createdRecipeObj);
    allRecipes.sort((a, b) => a.name.localeCompare(b.name, "id"));

    const successMessage = `Resep "${s.createdRecipeObj.name}" berhasil ditambahkan ke menu bank.`;
    closeAddRecipeModal();
    renderStep1({ successMessage });
  } catch (err) {
    s.submitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Simpan Menu";
    errorEl.innerHTML = `<div class="alert alert--error">Gagal menyimpan menu: ${escapeHtml(
      err.message || String(err)
    )}. Data yang sudah diisi tetap tersimpan -- klik Simpan lagi untuk mencoba ulang.</div>`;
  }
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
