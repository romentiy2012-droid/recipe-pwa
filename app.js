'use strict';
// ============================================================
//  МОИ РЕЦЕПТЫ — Windows 98 Edition v3
// ============================================================

// ====== РЕГИСТРАЦИЯ SERVICE WORKER (сразу, не после загрузки БД) ======
if ('serviceWorker' in navigator) {
  const reg = () => navigator.serviceWorker.register('sw.js').catch(err => console.error('SW fail:', err));
  if (document.readyState === 'complete') reg();
  else window.addEventListener('load', reg, { once: true });
}

// ====== КОНСТАНТЫ ======
const DB_NAME = 'recipeDB';
const DB_VERSION = 2;
const STORE = 'recipes';
const CAT_STORE = 'categories';
const OTHER = 'Другое';
const DEFAULT_CATEGORIES = ['Супы', 'Вторые блюда', 'Салаты', 'Десерты', 'Напитки', OTHER];
const MAX_CAT_LEN = 30;
let db;

// ====== INDEXEDDB ======
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const store = d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('title', 'title', { unique: false });
      }
      if (!d.objectStoreNames.contains(CAT_STORE)) {
        const cs = d.createObjectStore(CAT_STORE, { keyPath: 'name' });
        DEFAULT_CATEGORIES.forEach(name => cs.add({ name, isDefault: true, createdAt: Date.now() }));
      }
    };
    req.onsuccess = e => {
      db = e.target.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = e => reject(e.target.error);
  });
}

// Универсальный запуск транзакции: ждём complete, а не onsuccess запроса
function run(storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    let out;
    const r = fn(t.objectStore(storeName));
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const dbAdd = r => run(STORE, 'readwrite', s => s.add(r));
const dbPut = r => run(STORE, 'readwrite', s => s.put(r));
const dbPutMany = list => run(STORE, 'readwrite', s => { list.forEach(x => s.put(x)); });
const dbGetAll = () => run(STORE, 'readonly', s => s.getAll());
const dbGet = id => run(STORE, 'readonly', s => s.get(id));
const dbDelete = id => run(STORE, 'readwrite', s => s.delete(id));
const dbClear = () => run(STORE, 'readwrite', s => s.clear());

async function catGetAll() {
  const rows = await run(CAT_STORE, 'readonly', s => s.getAll());
  const rank = n => DEFAULT_CATEGORIES.indexOf(n);
  rows.sort((a, b) => {
    const ra = rank(a.name), rb = rank(b.name);
    if (ra !== -1 || rb !== -1) return (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb);
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  return rows.map(c => c.name);
}
const catAdd = name => run(CAT_STORE, 'readwrite', s => s.add({ name, isDefault: false, createdAt: Date.now() }));
const catPutMany = names => run(CAT_STORE, 'readwrite', s => {
  names.forEach(name => s.put({ name, isDefault: false, createdAt: Date.now() }));
});
const catDelete = name => run(CAT_STORE, 'readwrite', s => s.delete(name));

// ====== СОСТОЯНИЕ ======
const state = {
  filterCat: 'all',
  searchQuery: '',
  showFavorites: false,
  currentImage: null,      // Blob выбранного в форме фото
  viewingId: null,
  categories: [...DEFAULT_CATEGORIES],
  formDirty: false,        // в форме есть несохранённые изменения
  pendingDeleteCat: null
};

// ====== УТИЛИТЫ ======
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ====== КАРТИНКИ (Blob вместо base64) ======
const DATA_URL_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

function dataUrlToBlob(u) {
  if (typeof u !== 'string' || !DATA_URL_RE.test(u)) return null;
  try {
    const mime = u.slice(5, u.indexOf(';'));
    const bin = atob(u.slice(u.indexOf(',') + 1));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch { return null; }
}
function normalizeImage(v) {
  if (v instanceof Blob) return v;
  if (typeof v === 'string') return dataUrlToBlob(v);
  return null;
}
function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

let listUrls = [];    // object URL карточек списка
let modalUrls = [];   // object URL содержимого модалки
let previewUrl = null;
function makeUrl(blob, bucket) {
  const u = URL.createObjectURL(blob);
  bucket.push(u);
  return u;
}
function revokeAll(bucket) { bucket.forEach(u => URL.revokeObjectURL(u)); bucket.length = 0; }
function setImg(imgEl, image, bucket) {
  const blob = normalizeImage(image);
  if (imgEl && blob) imgEl.src = makeUrl(blob, bucket);
}

function compressImage(file, maxSize = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * k));
      const h = Math.max(1, Math.round(img.height * k));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';            // прозрачный PNG → белый, а не чёрный фон
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

// Старые записи (base64) → Blob, один раз
async function migrateImages() {
  try {
    const all = await dbGetAll();
    const changed = [];
    for (const r of all) {
      if (typeof r.image === 'string') {
        r.image = dataUrlToBlob(r.image);
        changed.push(r);
      }
    }
    if (changed.length) await dbPutMany(changed);
  } catch (err) { console.error('migrateImages', err); }
}

// ====== ДИАЛОГИ (замена confirm/alert) ======
let dlgResolve = null, dlgCancelId = null, dlgPrevFocus = null;

function ask({ title = 'Мои рецепты 98', icon = '❓', text = '', extraHTML = '', buttons, cancelId } = {}) {
  buttons = buttons || [{ id: 'ok', label: 'OK', primary: true }];
  return new Promise(resolve => {
    if (dlgResolve) { dlgResolve(null); dlgResolve = null; }
    dlgPrevFocus = document.activeElement;
    $('#dlgTitle').textContent = title;
    $('#dlgIcon').textContent = icon;
    $('#dlgBigIcon').textContent = icon;
    $('#dlgText').textContent = text;
    $('#dlgExtra').innerHTML = extraHTML;
    const box = $('#dlgActions');
    box.innerHTML = '';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = b.primary ? 'btn-primary' : 'btn-secondary';
      el.textContent = b.label;
      el.addEventListener('click', () => closeDlg(b.id));
      box.appendChild(el);
    });
    dlgCancelId = cancelId || buttons[buttons.length - 1].id;
    dlgResolve = resolve;
    $('#dlg').classList.remove('hidden');
    (box.querySelector('.btn-primary') || box.firstChild).focus();
  });
}
function closeDlg(id) {
  const r = dlgResolve;
  dlgResolve = null;
  $('#dlg').classList.add('hidden');
  try { dlgPrevFocus && dlgPrevFocus.focus && dlgPrevFocus.focus(); } catch { /* ignore */ }
  if (r) r(id);
}
const isDlgOpen = () => !$('#dlg').classList.contains('hidden');

const YNC = [
  { id: 'yes', label: 'Да', primary: true },
  { id: 'no', label: 'Нет' },
  { id: 'cancel', label: 'Отмена' }
];

// ====== ФИЛЬТР / РЕНДЕР ======
function updateFilterLabel() {
  const label = $('#categoryLabel');
  if (label) label.textContent = state.showFavorites ? 'Избранное' : (state.filterCat === 'all' ? 'Все блюда' : state.filterCat);
}

function setFilter(cat, fav = false) {
  state.filterCat = cat;
  state.showFavorites = fav;
  lsSet('filterCat', cat);
  return refresh();
}

let refreshSeq = 0;
async function refresh() {
  const seq = ++refreshSeq;
  const [recipes, cats] = await Promise.all([dbGetAll(), catGetAll()]);
  if (seq !== refreshSeq) return;            // пришёл более свежий запрос
  state.categories = cats;
  if (state.filterCat !== 'all' && !cats.includes(state.filterCat)) state.filterCat = 'all';
  updateFilterLabel();
  renderList(recipes);
  renderCategoryMenu(recipes);
}

function renderList(all) {
  const recipesEl = $('#recipes');
  const emptyEl = $('#empty');
  if (!recipesEl) return;

  let recipes = all;
  if (state.showFavorites) recipes = recipes.filter(r => r.favorite);
  else if (state.filterCat !== 'all') recipes = recipes.filter(r => (r.category || OTHER) === state.filterCat);
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    recipes = recipes.filter(r =>
      (r.title || '').toLowerCase().includes(q) ||
      (r.ingredients || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q));
  }
  recipes = recipes.slice().sort((a, b) => b.id - a.id);

  revokeAll(listUrls);
  recipesEl.innerHTML = '';

  $('#statusCount').textContent = 'Объектов: ' + recipes.length + ' из ' + all.length;
  $('#statusFilter').textContent = state.showFavorites ? 'Избранное' : (state.filterCat === 'all' ? 'Все категории' : state.filterCat);

  if (!recipes.length) { emptyEl && emptyEl.classList.remove('hidden'); return; }
  emptyEl && emptyEl.classList.add('hidden');

  recipes.forEach(r => {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.innerHTML =
      '<div class="img-wrap">' +
        (r.image ? '<img alt="" loading="lazy">' : '<div class="placeholder-img">🍽️</div>') +
      '</div>' +
      '<div class="info"><h3>' + escapeHtml(r.title) + '</h3>' +
      '<span class="cat">' + escapeHtml(r.category || OTHER) + (r.favorite ? ' ★' : '') + '</span></div>';
    if (r.image) setImg(card.querySelector('img'), r.image, listUrls);
    card.addEventListener('click', () => showDetail(r.id));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.id); }
    });
    recipesEl.appendChild(card);
  });
}

function renderCategoryMenu(recipes) {
  const menu = $('#categoryMenu');
  if (!menu) return;
  const counts = { all: recipes.length };
  state.categories.forEach(c => { counts[c] = 0; });
  recipes.forEach(r => {
    const c = r.category || OTHER;
    if (counts[c] !== undefined) counts[c]++;
  });

  let html = '<button class="dropdown-item ' + (!state.showFavorites && state.filterCat === 'all' ? 'active' : '') + '" data-cat="all">' +
    '<span class="dd-check">' + (!state.showFavorites && state.filterCat === 'all' ? '✓' : '') + '</span>' +
    '<span>Все блюда</span><span class="dd-count">' + counts.all + '</span></button>';

  state.categories.forEach(cat => {
    const on = !state.showFavorites && state.filterCat === cat;
    const canDelete = !DEFAULT_CATEGORIES.includes(cat);
    html += '<button class="dropdown-item ' + (on ? 'active' : '') + '" data-cat="' + escapeHtml(cat) + '">' +
      '<span class="dd-check">' + (on ? '✓' : '') + '</span>' +
      '<span>' + escapeHtml(cat) + '</span>' +
      '<span class="dd-count">' + (counts[cat] || 0) + '</span>' +
      (canDelete ? '<span class="dd-del" data-del="' + escapeHtml(cat) + '" title="Удалить">✕</span>' : '') +
      '</button>';
  });
  html += '<button class="dropdown-item dd-add" data-cat="__add__"><span class="dd-check"></span><span>➕ Своя категория...</span></button>';
  menu.innerHTML = html;
}

function toggleCategoryMenu() { $('#categoryMenu').classList.toggle('hidden'); }
function closeCategoryMenu() { $('#categoryMenu').classList.add('hidden'); }

// ====== ФОРМА ======
function defaultCategory() {
  // Новый рецепт по умолчанию попадает в ТЕКУЩУЮ открытую категорию
  if (!state.showFavorites && state.filterCat !== 'all' && state.categories.includes(state.filterCat)) return state.filterCat;
  return state.categories[0] || OTHER;
}

function formHTML(recipe) {
  const r = recipe || {};
  const cats = state.categories.slice();
  if (r.category && !cats.includes(r.category)) cats.push(r.category);
  const selected = r.category || defaultCategory();
  return '<form id="recipeForm" novalidate>' +
    '<input type="hidden" id="recipeId" value="' + (r.id || '') + '">' +
    '<label>Название:<input type="text" id="title" required maxlength="200" placeholder="Например: Борщ" value="' + escapeHtml(r.title) + '" autocomplete="off"></label>' +
    '<label>Описание:<textarea id="description" rows="2" placeholder="Краткое описание">' + escapeHtml(r.description || '') + '</textarea></label>' +
    '<label>Категория:<select id="category">' +
      cats.map(c => '<option value="' + escapeHtml(c) + '"' + (c === selected ? ' selected' : '') + '>' + escapeHtml(c) + '</option>').join('') +
    '</select></label>' +
    '<label for="imageGal">Фотография:</label>' +
    '<div class="file-input-wrap">' +
      '<label class="file-input-label"><span>📷</span><span>Камера</span>' +
        '<input type="file" id="imageCam" accept="image/*" capture="environment"></label>' +
      '<label class="file-input-label"><span>🖼️</span><span>Галерея</span>' +
        '<input type="file" id="imageGal" accept="image/*"></label>' +
    '</div>' +
    '<div id="imagePreviewWrap" class="hidden">' +
      '<img id="imagePreview" alt="">' +
      '<button type="button" id="removeImage">Удалить фото</button>' +
    '</div>' +
    '<label>Ингредиенты (каждый с новой строки):<textarea id="ingredients" rows="4" placeholder="Мясо — 500 г&#10;Свёкла — 2 шт">' + escapeHtml(r.ingredients || '') + '</textarea></label>' +
    '<label>Приготовление:<textarea id="steps" rows="6" placeholder="1. Нарезать...&#10;2. Варить...">' + escapeHtml(r.steps || '') + '</textarea></label>' +
    '<div class="actions">' +
      '<button type="button" id="cancelBtn" class="btn-secondary">Отмена</button>' +
      '<button type="submit" class="btn-primary">OK</button>' +
    '</div></form>';
}

function setPreview(blob) {
  const preview = $('#imagePreview'), wrap = $('#imagePreviewWrap');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (blob) {
    previewUrl = URL.createObjectURL(blob);
    preview.src = previewUrl;
    wrap.classList.remove('hidden');
  } else {
    previewUrl = null;
    preview.removeAttribute('src');
    wrap.classList.add('hidden');
  }
}

function bindForm(recipe) {
  state.currentImage = normalizeImage(recipe && recipe.image);
  state.formDirty = false;
  const form = $('#recipeForm');
  if (!form) return;
  if (state.currentImage) setPreview(state.currentImage);

  const markDirty = () => { state.formDirty = true; };
  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);

  const onFile = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      state.currentImage = await compressImage(file);
      setPreview(state.currentImage);
      state.formDirty = true;
    } catch (err) { toast('Ошибка загрузки фото'); console.error(err); }
  };
  $('#imageCam').addEventListener('change', onFile);
  $('#imageGal').addEventListener('change', onFile);

  $('#removeImage').addEventListener('click', () => {
    state.currentImage = null;
    setPreview(null);
    state.formDirty = true;
  });
  $('#cancelBtn').addEventListener('click', () => requestCloseModal());
  form.addEventListener('submit', e => { e.preventDefault(); saveForm(); });
}

// Сохранение формы. true — сохранено (или формы нет), false — не удалось.
async function saveForm() {
  if (!$('#recipeForm')) return true;
  const title = $('#title').value.trim();
  if (!title) { toast('Введите название рецепта'); $('#title').focus(); return false; }

  const data = {
    title,
    description: $('#description').value.trim(),
    category: $('#category').value,
    ingredients: $('#ingredients').value.trim(),
    steps: $('#steps').value.trim(),
    image: state.currentImage,
    updatedAt: Date.now()
  };
  const id = $('#recipeId').value;
  try {
    if (id) {
      data.id = Number(id);
      const old = await dbGet(data.id);
      if (old && old.favorite) data.favorite = true;
      data.createdAt = (old && old.createdAt) || Date.now();
      await dbPut(data);
    } else {
      data.createdAt = Date.now();
      await dbAdd(data);
    }
  } catch (err) {
    console.error(err);
    toast('Ошибка сохранения (возможно, нет места)');
    return false;
  }

  const hidden = state.showFavorites
    ? !data.favorite
    : (state.filterCat !== 'all' && state.filterCat !== data.category);
  state.formDirty = false;
  closeModal();
  toast((id ? 'Рецепт сохранён' : 'Рецепт создан') + ' в «' + data.category + '»' + (hidden ? ' (скрыт текущим фильтром)' : ''));
  await refresh();
  return true;
}

// ====== МОДАЛКА (+ кнопка «Назад» на телефоне) ======
let modalPushed = false, ignorePop = false;
const isModalOpen = () => !$('#modal').classList.contains('hidden');

function openModal() {
  $('#modal').classList.remove('hidden');
  if (!modalPushed) { history.pushState({ modal: 1 }, ''); modalPushed = true; }
}

function closeModal(opts = {}) {
  $('#modal').classList.add('hidden');
  revokeAll(modalUrls);
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  state.viewingId = null;
  state.formDirty = false;
  state.currentImage = null;
  if (modalPushed) {
    modalPushed = false;
    if (!opts.popped) { ignorePop = true; history.back(); }
  }
}

// Закрытие с проверкой несохранённых данных. true — закрыто.
async function requestCloseModal(opts = {}) {
  if (!isModalOpen()) return true;
  if (state.formDirty) {
    const a = await ask({ title: 'Рецепт', icon: '❓', text: 'Рецепт изменён. Сохранить изменения?', buttons: YNC, cancelId: 'cancel' });
    if (a === 'cancel' || !a) return false;
    if (a === 'yes') return saveForm();
  }
  closeModal(opts);
  return true;
}

window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  if (modalPushed && isModalOpen()) {
    modalPushed = false;     // браузер уже убрал запись истории
    requestCloseModal({ popped: true }).then(ok => {
      if (!ok && isModalOpen()) { history.pushState({ modal: 1 }, ''); modalPushed = true; }
    });
  }
});

function openFormModal(recipe) {
  revokeAll(modalUrls);
  $('#modalTitle').textContent = recipe ? 'Редактирование рецепта' : 'Создание рецепта';
  $('#modalIcon').textContent = recipe ? '✏️' : '📝';
  $('#modalContent').innerHTML = formHTML(recipe);
  bindForm(recipe);
  openModal();
  if (!recipe) $('#title').focus();
}

// ====== ДЕТАЛИ ======
async function showDetail(id) {
  const r = await dbGet(id);
  if (!r) return;
  revokeAll(modalUrls);
  state.viewingId = id;
  state.formDirty = false;
  $('#modalTitle').textContent = r.title;
  $('#modalIcon').textContent = '📄';

  const ingredients = (r.ingredients || '').split('\n').map(s => s.trim()).filter(Boolean)
    .map(i => '<li>' + escapeHtml(i) + '</li>').join('');

  $('#modalContent').innerHTML =
    '<div class="recipe-detail">' +
      (r.image ? '<img class="main-img" id="detailImg" alt="">' : '') +
      '<div class="detail-header"><h2>' + escapeHtml(r.title) + '</h2>' +
        '<button class="detail-fav-btn ' + (r.favorite ? 'active' : '') + '" id="favToggle" title="В избранное">' + (r.favorite ? '★' : '☆') + '</button></div>' +
      '<span class="cat-badge">' + escapeHtml(r.category || OTHER) + '</span>' +
      (r.description ? '<p class="description">' + escapeHtml(r.description) + '</p>' : '') +
      (ingredients ? '<h3>Ингредиенты</h3><ul class="ingredients-list">' + ingredients + '</ul>' : '') +
      (r.steps ? '<h3>Приготовление</h3><div class="steps-text">' + escapeHtml(r.steps) + '</div>' : '') +
      '<div class="detail-actions">' +
        '<button class="edit-btn" id="dEdit">Изменить</button>' +
        '<button class="delete-btn" id="dDelete">Удалить</button>' +
        '<button class="close-btn" id="dClose">Закрыть</button>' +
      '</div></div>';
  if (r.image) setImg($('#detailImg'), r.image, modalUrls);

  $('#dClose').onclick = () => closeModal();
  $('#dEdit').onclick = () => openFormModal(r);
  $('#dDelete').onclick = async () => {
    const a = await ask({ title: 'Удаление', icon: '🗑️', text: 'Удалить рецепт «' + r.title + '»?',
      buttons: [{ id: 'yes', label: 'Удалить', primary: true }, { id: 'no', label: 'Отмена' }], cancelId: 'no' });
    if (a !== 'yes') return;
    await dbDelete(r.id);
    closeModal();
    toast('Рецепт удалён');
    refresh();
  };
  $('#favToggle').onclick = async () => {
    r.favorite = !r.favorite;
    await dbPut(r);
    $('#favToggle').textContent = r.favorite ? '★' : '☆';
    $('#favToggle').classList.toggle('active', r.favorite);
    toast(r.favorite ? 'Добавлено в избранное' : 'Убрано из избранного');
    refresh();
  };
  openModal();
  $('#dEdit').focus();
}

// ====== КАТЕГОРИИ ======
const catExists = name => state.categories.some(c => c.toLowerCase() === name.toLowerCase());

async function addCategory() {
  const input = $('#newCatName');
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) { toast('Введите название'); return; }
  if (name.length < 2) { toast('Слишком короткое название'); return; }
  if (name.length > MAX_CAT_LEN) { toast('Слишком длинное название'); return; }
  if (catExists(name)) { toast('Такая категория уже есть'); return; }
  try {
    await catAdd(name);
  } catch (err) { toast('Не удалось добавить категорию'); console.error(err); return; }
  input.value = '';
  $('#catModal').classList.add('hidden');
  state.categories.push(name);
  await setFilter(name);          // сразу открываем новую категорию — «Создать» положит рецепт в неё
  toast('Категория «' + name + '» добавлена');
}

async function deleteCategory(cat) {
  const all = await dbGetAll();
  const moved = all.filter(r => r.category === cat).map(r => ({ ...r, category: OTHER }));
  if (moved.length) await dbPutMany(moved);
  await catDelete(cat);
  if (state.filterCat === cat) { state.filterCat = 'all'; lsSet('filterCat', 'all'); }
  toast('Категория «' + cat + '» удалена');
  await refresh();
}

// ====== ЭКСПОРТ / ИМПОРТ ======
async function exportData() {
  try {
    const [recipes, cats] = await Promise.all([dbGetAll(), catGetAll()]);
    const out = { app: 'recipes98', version: 1, exportedAt: new Date().toISOString(), categories: cats, recipes: [] };
    for (const r of recipes) {
      const { id, image, ...rest } = r;
      const blob = normalizeImage(image);
      rest.image = blob ? await blobToDataUrl(blob) : null;
      out.recipes.push(rest);
    }
    const file = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = 'recipes-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('Экспортировано рецептов: ' + out.recipes.length);
  } catch (err) { console.error(err); toast('Ошибка экспорта'); }
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

async function importData(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch { toast('Файл не похож на JSON'); return; }
  if (!obj || obj.app !== 'recipes98' || !Array.isArray(obj.recipes)) { toast('Это не файл рецептов'); return; }
  if (obj.recipes.length > 5000) { toast('Слишком много рецептов в файле'); return; }

  try {
    const existing = await dbGetAll();
    const known = new Set(existing.map(r => r.title + '|' + r.createdAt));
    const cats = await catGetAll();
    const lower = new Set(cats.map(c => c.toLowerCase()));
    const newCats = [];
    const addCat = raw => {
      const n = str(raw, MAX_CAT_LEN).trim().replace(/\s+/g, ' ');
      if (n.length < 2) return null;
      const found = cats.concat(newCats).find(c => c.toLowerCase() === n.toLowerCase());
      if (found) return found;
      newCats.push(n); lower.add(n.toLowerCase());
      return n;
    };
    (Array.isArray(obj.categories) ? obj.categories : []).forEach(addCat);

    const toAdd = [];
    let skipped = 0;
    for (const x of obj.recipes) {
      if (!x || typeof x !== 'object') { skipped++; continue; }
      const title = str(x.title, 200).trim();
      if (!title) { skipped++; continue; }
      const createdAt = Number.isFinite(x.createdAt) ? x.createdAt : Date.now();
      if (known.has(title + '|' + createdAt)) { skipped++; continue; }
      known.add(title + '|' + createdAt);
      toAdd.push({
        title,
        description: str(x.description, 1000),
        category: addCat(x.category) || OTHER,
        ingredients: str(x.ingredients, 5000),
        steps: str(x.steps, 20000),
        image: dataUrlToBlob(x.image),      // только настоящие data:image/*, остальное отбрасывается
        favorite: x.favorite === true,
        createdAt,
        updatedAt: Date.now()
      });
    }
    if (newCats.length) await catPutMany(newCats);
    if (toAdd.length) await run(STORE, 'readwrite', s => { toAdd.forEach(r => s.add(r)); });
    toast('Импортировано: ' + toAdd.length + (skipped ? ', пропущено: ' + skipped : ''));
    await refresh();
  } catch (err) { console.error(err); toast('Ошибка импорта'); }
}

async function clearAll() {
  const a = await ask({ title: 'Очистить всё', icon: '⚠️', text: 'Удалить ВСЕ рецепты? Это действие нельзя отменить.',
    buttons: [{ id: 'yes', label: 'Удалить всё', primary: true }, { id: 'no', label: 'Отмена' }], cancelId: 'no' });
  if (a !== 'yes') return;
  await dbClear();
  toast('Все рецепты удалены');
  await refresh();
}

// ====== ЧАСЫ ======
function updateClock() {
  const d = new Date();
  const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const a = $('#trayClock'), b = $('#statusClock');
  if (a) a.textContent = time;
  if (b) b.textContent = time;
}

// ====== ПУСК ======
function closeStartMenu() {
  $('#startMenu').classList.add('hidden');
  $$('.start-submenu').forEach(sm => sm.classList.add('hidden'));
}
function renderStartSubCategories() {
  $('#startSubCategories').innerHTML = state.categories.map(cat =>
    '<button class="start-menu-item" data-action="set-cat" data-cat="' + escapeHtml(cat) + '">' +
    '<span class="smi-icon">🏷️</span><span class="smi-label">' + escapeHtml(cat) + '</span></button>').join('');
}
function toggleSub(id) {
  $$('.start-submenu').forEach(sm => { if (sm.id !== id) sm.classList.add('hidden'); });
  $('#' + id).classList.toggle('hidden');
}

// ====== МЕНЮ-БАР (Файл / Правка / Вид / Справка) ======
const MENUS = {
  file: [['export', '📤 Экспорт рецептов…'], ['import', '📥 Импорт рецептов…'], ['-'], ['shutdown', '🔌 Завершение работы…']],
  edit: [['create', '📝 Создать рецепт'], ['clear-all', '🗑️ Очистить всё']],
  view: [['recipes', '📁 Все блюда'], ['favorites', '❤️ Избранное']],
  help: [['about', 'ℹ️ О программе']]
};
let openMenuKey = null;
function closeMenuPop() { $('#menuPop').classList.add('hidden'); openMenuKey = null; }
function showMenuPop(key, anchor) {
  if (openMenuKey === key) { closeMenuPop(); return; }
  const pop = $('#menuPop');
  pop.innerHTML = MENUS[key].map(([act, label]) =>
    act === '-' ? '<div class="dd-sep"></div>'
      : '<button class="dropdown-item" data-act="' + act + '"><span>' + label + '</span></button>').join('');
  const rect = anchor.getBoundingClientRect();
  pop.style.left = Math.max(0, Math.min(rect.left, window.innerWidth - 210)) + 'px';
  pop.style.top = rect.bottom + 'px';
  pop.classList.remove('hidden');
  openMenuKey = key;
}

// ====== ДЕЙСТВИЯ ======
// Действия, которые переключают/заменяют экран, сначала аккуратно закрывают открытую форму
const NEEDS_CLOSE = new Set(['create', 'recipes', 'favorites', 'clear-all', 'import', 'set-cat']);

async function runAction(a, arg) {
  if (NEEDS_CLOSE.has(a) && isModalOpen()) {
    if (!(await requestCloseModal())) return;
  }
  switch (a) {
    case 'create': openFormModal(null); break;
    case 'recipes': await setFilter('all'); break;
    case 'favorites': await setFilter('all', true); break;
    case 'set-cat': await setFilter(arg); break;
    case 'export': await exportData(); break;
    case 'import': $('#importFile').click(); break;
    case 'clear-all': await clearAll(); break;
    case 'about':
      await ask({ title: 'О программе', icon: 'ℹ️', text: 'Мои рецепты 98\nВерсия 3.0\n\nПрогрессивное веб-приложение в стиле Windows 98\n\n© 2026' });
      break;
    case 'shutdown': await shutdownFlow(); break;
  }
}

// ====== ЗАВЕРШЕНИЕ РАБОТЫ ======
let sdTimers = [], sdWakeable = false;

async function shutdownFlow() {
  closeStartMenu(); closeMenuPop(); closeCategoryMenu();
  const radios =
    '<label class="dlg-radio"><input type="radio" name="sdmode" value="off" checked> Завершить работу</label>' +
    '<label class="dlg-radio"><input type="radio" name="sdmode" value="restart"> Перезагрузить компьютер</label>';
  const a = await ask({ title: 'Завершение работы', icon: '🔌', text: 'Что должен сделать компьютер?', extraHTML: radios,
    buttons: [{ id: 'ok', label: 'OK', primary: true }, { id: 'cancel', label: 'Отмена' }], cancelId: 'cancel' });
  if (a !== 'ok') return;
  const checked = document.querySelector('input[name="sdmode"]:checked');
  const mode = checked ? checked.value : 'off';

  if (isModalOpen()) {
    if (state.formDirty) {
      const s = await ask({ title: 'Завершение работы', icon: '⚠️', text: 'Рецепт не сохранён. Сохранить перед выходом?', buttons: YNC, cancelId: 'cancel' });
      if (s === 'cancel' || !s) return;
      if (s === 'yes') { if (!(await saveForm())) return; }
      else closeModal();
    } else {
      closeModal();
    }
  }
  doShutdown(mode);
}

function doShutdown(mode) {
  const sd = $('#shutdown');
  sdTimers.forEach(clearTimeout); sdTimers = [];
  sdWakeable = false;
  sd.dataset.stage = 'splash';
  sd.classList.remove('hidden');
  sdTimers.push(setTimeout(() => {
    if (mode === 'restart') { location.reload(); return; }
    try { window.close(); } catch { /* вкладку закрыть нельзя — остаёмся на экране выключения */ }
    sd.dataset.stage = 'off';
    sdWakeable = true;
  }, 1800));
}

function wakeUp() {
  if (!sdWakeable) return;
  sdWakeable = false;
  $('#shutdown').classList.add('hidden');
  toast('Добро пожаловать!');
  refresh();
}

// ====== ФОКУС-ЛОВУШКА ======
function topModal() {
  for (const id of ['dlg', 'catModal', 'modal']) {
    const m = document.getElementById(id);
    if (m && !m.classList.contains('hidden')) return m;
  }
  return null;
}
function trapFocus(e) {
  const m = topModal();
  if (!m) return;
  const f = [...m.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1], act = document.activeElement;
  if (!m.contains(act)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && act === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
}

// ====== ОБРАБОТЧИКИ ======
function bindEvents() {
  // Поиск
  $('#searchInput').addEventListener('input', debounce(e => {
    state.searchQuery = e.target.value.trim();
    refresh();
  }, 150));

  // Категории (выпадающий список)
  $('#categoryToggle').addEventListener('click', e => { e.stopPropagation(); closeMenuPop(); toggleCategoryMenu(); });
  $('#categoryMenu').addEventListener('click', async e => {
    const delBtn = e.target.closest('.dd-del');
    if (delBtn) {
      e.stopPropagation();
      const cat = delBtn.dataset.del;
      closeCategoryMenu();
      const a = await ask({ title: 'Удаление категории', icon: '⚠️',
        text: 'Удалить категорию «' + cat + '»?\nВсе рецепты этой категории будут перемещены в «' + OTHER + '».',
        buttons: [{ id: 'yes', label: 'Удалить', primary: true }, { id: 'no', label: 'Отмена' }], cancelId: 'no' });
      if (a === 'yes') await deleteCategory(cat);
      return;
    }
    const item = e.target.closest('.dropdown-item');
    if (!item) return;
    const cat = item.dataset.cat;
    closeCategoryMenu();
    if (cat === '__add__') {
      if (isModalOpen() && !(await requestCloseModal())) return;
      $('#catModal').classList.remove('hidden');
      setTimeout(() => $('#newCatName').focus(), 50);
      return;
    }
    if (isModalOpen() && !(await requestCloseModal())) return;
    setFilter(cat);
  });

  // Клик вне меню
  document.addEventListener('click', e => {
    if (!e.target.closest('.dropdown-wrap')) closeCategoryMenu();
    if (!e.target.closest('#startMenu') && !e.target.closest('#startBtn')) closeStartMenu();
    if (!e.target.closest('#menuPop') && !e.target.closest('.menu-item')) closeMenuPop();
  });

  // Создать / быстрые иконки
  $('#addBtn').addEventListener('click', () => runAction('create'));
  $('#iconAdd').addEventListener('click', () => runAction('create'));
  $('#iconRecipes').addEventListener('click', () => runAction('recipes'));
  $('#iconFav').addEventListener('click', () => runAction('favorites'));

  // Основная модалка
  $('#modalCloseBtn').addEventListener('click', () => requestCloseModal());
  $('#modal .modal-backdrop').addEventListener('click', () => {
    if (!$('#startMenu').classList.contains('hidden')) return;   // этот клик только закроет Пуск
    requestCloseModal();
  });

  // Кнопки заголовка окна
  $('#btnClose').addEventListener('click', () => shutdownFlow());
  $('#btnMinimize').addEventListener('click', () => toast('Свернуть нельзя — только закрыть 😉'));
  $('#btnMaximize').addEventListener('click', () => toast('Развернуть нельзя — окно уже на весь экран 😉'));

  // Пуск
  $('#startBtn').addEventListener('click', e => { e.stopPropagation(); closeMenuPop(); $('#startMenu').classList.toggle('hidden'); });
  $('#startMenu').addEventListener('click', async e => {
    const item = e.target.closest('.start-menu-item');
    if (!item) return;
    const action = item.dataset.action;
    if (action === 'categories') { renderStartSubCategories(); toggleSub('startSubCategories'); return; }
    if (action === 'settings') { toggleSub('startSubSettings'); return; }
    closeStartMenu();
    await runAction(action, item.dataset.cat);
  });

  // Меню-бар
  $$('.menu-item').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    closeCategoryMenu();
    showMenuPop(btn.dataset.menu, btn);
  }));
  $('#menuPop').addEventListener('click', e => {
    const it = e.target.closest('[data-act]');
    if (!it) return;
    closeMenuPop();
    runAction(it.dataset.act);
  });

  // Импорт
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await importData(f);
  });

  // Новая категория
  $('#saveNewCatBtn').addEventListener('click', addCategory);
  $('#newCatName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addCategory(); }
  });
  $$('[data-close]').forEach(el => el.addEventListener('click', () => {
    const m = document.getElementById(el.dataset.close);
    if (m) m.classList.add('hidden');
  }));

  // Диалог
  $('#dlgCloseBtn').addEventListener('click', () => closeDlg(dlgCancelId));

  // Экран выключения
  const sd = $('#shutdown');
  sd.addEventListener('click', wakeUp);
  document.addEventListener('keydown', e => { if (!sd.classList.contains('hidden')) { wakeUp(); e.preventDefault(); } }, true);

  // Клавиатура: Esc и Tab
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab') { trapFocus(e); return; }
    if (e.key !== 'Escape') return;
    if (isDlgOpen()) { closeDlg(dlgCancelId); return; }
    if (!$('#catModal').classList.contains('hidden')) { $('#catModal').classList.add('hidden'); return; }
    if (openMenuKey) { closeMenuPop(); return; }
    if (!$('#categoryMenu').classList.contains('hidden')) { closeCategoryMenu(); return; }
    if (!$('#startMenu').classList.contains('hidden')) { closeStartMenu(); return; }
    if (isModalOpen()) requestCloseModal();
  });
}

// ====== СТАРТ ======
(async () => {
  try {
    await openDB();
  } catch (err) {
    console.error(err);
    toast('Не удалось открыть базу данных (приватный режим?)');
    return;
  }
  await migrateImages();

  const saved = lsGet('filterCat');
  if (saved) state.filterCat = saved;       // если категории уже нет — refresh() сбросит на «Все»

  bindEvents();
  updateClock();
  setInterval(updateClock, 30000);
  await refresh();

  // Просим браузер не вычищать хранилище (особенно важно для iOS Safari)
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* ignore */ }
})();
