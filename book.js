'use strict';
const BookUI = { week: Book.monday(), config: window.RECIPES_CONFIG || {}, googleToken: null, importBusy: false };
function bookError(err) { console.error(err); toast(err.message || 'Не удалось выполнить действие'); }
function bookClick(el, action) { el.onclick = () => Promise.resolve().then(action).catch(bookError); }
async function initBook() {
  // Add identities without changing the recipe contents or revision date.
  const rows = await dbGetAllRaw(), changed = rows.filter(r => !r.uuid || !r.revisionId);
  if (changed.length) await run(STORE, 'readwrite', s => changed.forEach(r => s.put({ ...r, uuid: r.uuid || crypto.randomUUID(), revisionId: r.revisionId || crypto.randomUUID(), ancestors: r.ancestors || [] })));
  const config = (await metaGet('connections'))?.value || {};
  BookUI.config = { ...BookUI.config, ...config };
  const sort = $('#recipeSort'), tag = $('#tagFilter');
  sort.value = lsGet('recipeSort') || 'newest'; state.sort = sort.value; state.tag = lsGet('recipeTag') || '';
  sort.onchange = () => { state.sort = sort.value; lsSet('recipeSort', sort.value); refresh(); };
  tag.onchange = () => { state.tag = tag.value; lsSet('recipeTag', tag.value); refresh(); };
  await finishDropboxLogin();
}
function updateBookFilters(recipes) {
  const el = $('#tagFilter'); if (!el) return;
  const all = [...new Set(recipes.flatMap(r => Book.tags(r.tags)))].sort((a, b) => a.localeCompare(b, 'ru'));
  el.innerHTML = '<option value="">Все теги</option>' + all.map(t => '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>').join('');
  el.value = state.tag || '';
  if (el.selectedIndex < 0) { state.tag = ''; el.value = ''; }
}
async function bindBookForm(recipe) {
  const form = $('#recipeForm'); if (!form) return;
  $('#recipeUuid').value = recipe?.uuid || '';
  const rows = await dbGetAll(); if (form !== $('#recipeForm')) return;
  const selected = recipe?.relatedUuids || [];
  $('#relatedRecipes').dataset.ready = '1';
  $('#relatedRecipes').innerHTML = rows.filter(r => r.uuid !== recipe?.uuid).map(r => '<label class="check-row"><input type="checkbox" value="' + escapeHtml(r.uuid) + '"' + (selected.includes(r.uuid) ? ' checked' : '') + '><span>' + escapeHtml(r.title) + '</span></label>').join('') || '<p class="field-hint">Сначала добавь другие рецепты.</p>';
}
async function detailBookTools(recipe, servings) {
  const target = $('#relatedDetail'); if (!target) return;
  const rows = await dbGetAll(); if (target !== $('#relatedDetail')) return;
  const links = rows.filter(r => (recipe.relatedUuids || []).includes(r.uuid) || (r.relatedUuids || []).includes(recipe.uuid));
  target.innerHTML = links.length ? '<h3>Связанные рецепты</h3>' + links.map(r => '<button data-related-id="' + r.id + '">' + escapeHtml(r.title) + '</button>').join(' ') : '';
  target.querySelectorAll('button').forEach(el => bookClick(el, () => showDetail(Number(el.dataset.relatedId))));
}
async function showPlanner(preselected) {
  stopCooking();
  const [recipes, stored] = await Promise.all([dbGetAll(), metaGet('planner')]);
  const rows = Book.validPlan(stored?.value);
  const week = BookUI.week, end = Book.shift(week, 6);
  const days = Array.from({ length: 7 }, (_, i) => Book.shift(week, i));
  const mealNames = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };
  $('#modalTitle').textContent = 'Меню на неделю'; $('#modalIcon').textContent = '📅';
  $('#modalContent').innerHTML = '<div class="week-nav"><button id="weekPrev">←</button><strong>' + week.split('-').reverse().join('.') + ' — ' + end.split('-').reverse().join('.') + '</strong><button id="weekNext">→</button></div>' +
    days.map(date => '<section class="plan-day"><h3>' + new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) + '</h3>' +
      (rows.filter(p => !p.deletedAt && p.date === date).sort((a, b) => Object.keys(mealNames).indexOf(a.meal) - Object.keys(mealNames).indexOf(b.meal)).map(p => {
        const r = recipes.find(r => r.uuid === p.recipeUuid);
        return '<div class="plan-entry"><span>' + mealNames[p.meal] + ': <button data-plan-open="' + (r?.id || '') + '"' + (!r ? ' disabled' : '') + '>' + escapeHtml(r?.title || p.title || 'Рецепт недоступен') + '</button>' + (!r ? ' (в корзине или удалён)' : '') + (p.servings ? ' · ' + p.servings + ' порц.' : '') + '</span><button data-plan-remove="' + escapeHtml(p.id) + '" aria-label="Убрать блюдо">×</button></div>';
      }).join('') || '<p class="field-hint">Пока ничего не запланировано</p>') + '</section>').join('') +
    '<fieldset><legend>Добавить блюдо</legend><label>День<input id="planDate" type="date" value="' + (Book.day() >= week && Book.day() <= end ? Book.day() : week) + '"></label>' +
    '<label>Приём пищи<select id="planMeal">' + Object.entries(mealNames).map(([key, label]) => '<option value="' + key + '">' + label + '</option>').join('') + '</select></label>' +
    '<label>Рецепт<select id="planRecipe">' + recipes.map(r => '<option value="' + escapeHtml(r.uuid) + '"' + (preselected?.uuid === r.uuid ? ' selected' : '') + '>' + escapeHtml(r.title) + '</option>').join('') + '</select></label>' +
    '<label>Порций<input id="planServings" type="number" min="1" max="10000" step="1"></label><p class="field-hint" id="planPortionHint"></p><button id="planAdd">Добавить в меню</button></fieldset>' +
    '<div class="book-actions"><button id="planShopping">🛒 Покупки на эту неделю</button><button id="planToday">Текущая неделя</button><button id="planClose">Закрыть</button></div>';
  const portions = () => { const r = recipes.find(r => r.uuid === $('#planRecipe').value); $('#planServings').value = r?.servings || ''; $('#planServings').disabled = !r?.servings; $('#planPortionHint').textContent = r?.servings ? 'Количество продуктов пересчитается на эти порции.' : 'У рецепта не заданы исходные порции: в покупки попадут исходные количества.'; };
  $('#planRecipe').onchange = portions; portions();
  bookClick($('#weekPrev'), () => { BookUI.week = Book.shift(week, -7); return showPlanner(); });
  bookClick($('#weekNext'), () => { BookUI.week = Book.shift(week, 7); return showPlanner(); });
  bookClick($('#planToday'), () => { BookUI.week = Book.monday(); return showPlanner(); });
  bookClick($('#planAdd'), async () => {
    const r = recipes.find(r => r.uuid === $('#planRecipe').value), date = $('#planDate').value;
    const n = Kitchen.quantity($('#planServings').value);
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Выбери рецепт и день'); return; }
    if (r.servings && (!n || !Number.isInteger(n) || n > 10000)) { toast('Укажи число порций от 1 до 10000'); return; }
    rows.push({ id: crypto.randomUUID(), recipeUuid: r.uuid, title: r.title, date, meal: $('#planMeal').value, servings: r.servings ? n : null, updatedAt: Date.now() });
    await metaPut('planner', rows); BookUI.week = Book.monday(date); await showPlanner();
  });
  $$('[data-plan-remove]').forEach(el => bookClick(el, async () => { const p = rows.find(p => p.id === el.dataset.planRemove); p.deletedAt = p.updatedAt = Date.now(); await metaPut('planner', rows); await showPlanner(); }));
  $$('[data-plan-open]').forEach(el => bookClick(el, () => showDetail(Number(el.dataset.planOpen))));
  bookClick($('#planShopping'), async () => {
    const selected = rows.filter(p => !p.deletedAt && p.date >= week && p.date <= end).map(p => ({ recipe: recipes.find(r => r.uuid === p.recipeUuid), servings: p.servings })).filter(p => p.recipe);
    if (!selected.length) { toast('В меню этой недели нет доступных блюд'); return; }
    await addToShopping(selected); await showShopping();
  });
  $('#planClose').onclick = () => closeModal(); openModal();
}
async function showFridge() {
  $('#modalTitle').textContent = 'Что приготовить из продуктов'; $('#modalIcon').textContent = '🥕';
  $('#modalContent').innerHTML = '<label>Что есть под рукой?<textarea id="fridgeProducts" rows="3" placeholder="курица, картофель, лук"></textarea></label><p class="field-hint">Разделяй продукты запятыми. Поиск сравнивает названия в твоей книге; он не проверяет свежесть и не определяет взаимозаменяемость продуктов.</p><button id="fridgeFind">Подобрать блюда</button><div id="fridgeResults"></div><button id="fridgeClose">Закрыть</button>';
  $('#fridgeProducts').value = lsGet('fridgeProducts') || '';
  bookClick($('#fridgeFind'), async () => {
    const products = $('#fridgeProducts').value; lsSet('fridgeProducts', products);
    const matches = Book.fridge(await dbGetAll(), products), target = $('#fridgeResults');
    target.innerHTML = matches.length ? matches.map(({ recipe, found, missing }) => '<div class="fridge-result"><button data-fridge-id="' + recipe.id + '">' + escapeHtml(recipe.title) + '</button><p>Есть: ' + escapeHtml(found.join(', ')) + '</p><p>' + (missing.length ? 'Не хватает: ' + escapeHtml(missing.join(', ')) : 'Все указанные продукты найдены') + '</p></div>').join('') : '<p>Совпадений нет. Попробуй другие названия продуктов.</p>';
    target.querySelectorAll('button').forEach(el => bookClick(el, () => showDetail(Number(el.dataset.fridgeId))));
  });
  $('#fridgeClose').onclick = () => closeModal(); openModal();
}
async function showWebImport() {
  $('#modalTitle').textContent = 'Рецепт из интернета'; $('#modalIcon').textContent = '🌐';
  $('#modalContent').innerHTML = '<label>Найти рецепт в интернете<input id="webSearch" type="search" placeholder="например: пирог с яблоками"></label><button id="webSearchGo">Найти в поисковике ↗</button>' +
    '<hr><label>Ссылка на страницу рецепта<input id="webRecipeUrl" type="url" placeholder="https://..."></label><button id="webImportGo">Извлечь рецепт</button><p id="webImportStatus" role="status"></p>' +
    '<details><summary>Вставить HTML или текст вручную</summary><p class="field-hint">Если сайт блокирует загрузку, вставь исходный HTML страницы или скопированный текст рецепта. Перед сохранением откроется редактор.</p><textarea id="webHtml" rows="6" placeholder="HTML страницы или текст рецепта"></textarea><button id="webParse">Разобрать HTML</button><button id="webText">Открыть текст в редакторе</button></details><div id="webCandidates"></div><button id="webImportClose">Закрыть</button>';
  bookClick($('#webSearchGo'), () => { const q = $('#webSearch').value.trim(); if (q) window.open('https://www.google.com/search?q=' + encodeURIComponent(q + ' рецепт'), '_blank', 'noopener,noreferrer'); });
  async function showCandidates(html, source) {
    const candidates = Book.parseHTML(html, source);
    if (!candidates.length) throw new Error('Не найдена разметка рецепта. Вставь текст и открой его в редакторе.');
    const target = $('#webCandidates'); if (!target) return;
    target.innerHTML = '<h3>Найдены рецепты — выбери для проверки</h3>' + candidates.map((r, n) => '<button data-import-index="' + n + '">' + escapeHtml(r.title) + '</button>').join(' ');
    target.querySelectorAll('button').forEach(el => bookClick(el, () => openImportedRecipe(candidates[Number(el.dataset.importIndex)])));
    $('#webImportStatus').textContent = 'Найдено: ' + candidates.length;
  }
  bookClick($('#webImportGo'), async () => {
    const source = Book.url($('#webRecipeUrl').value);
    if (!source) throw new Error('Вставь полную ссылку http:// или https://');
    if (BookUI.importBusy) return; BookUI.importBusy = true;
    const button = $('#webImportGo'), status = $('#webImportStatus'); button.disabled = true; status.textContent = 'Загружаю страницу…';
    try {
      const settings = BookUI.config;
      let response;
      if (settings.importEndpoint) {
        response = await fetch(settings.importEndpoint.replace(/\/$/, '') + '/page?url=' + encodeURIComponent(source), { signal: AbortSignal.timeout(15000), credentials: 'omit' });
        if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || 'Сервис импорта: ' + response.status); }
        const result = await response.json(); await showCandidates(result.html, result.url || source);
      } else {
        try { response = await fetch(source, { credentials: 'omit', signal: AbortSignal.timeout(12000) }); if (!response.ok) throw new Error(); }
        catch { throw new Error('Сайт не разрешает прямое чтение. Подключи обработчик в «Облако и импорт» или вставь HTML/текст ниже.'); }
        const size = Number(response.headers.get('content-length')); if (size > 3 * 1024 * 1024) throw new Error('Страница слишком большая');
        await showCandidates(await response.text(), response.url || source);
      }
    } finally { BookUI.importBusy = false; if (button.isConnected) button.disabled = false; if (status.isConnected && status.textContent === 'Загружаю страницу…') status.textContent = 'Загрузка завершена. При ошибке используй ручной ввод ниже.'; }
  });
  bookClick($('#webParse'), () => showCandidates($('#webHtml').value, Book.url($('#webRecipeUrl').value)));
  bookClick($('#webText'), () => {
    const text = $('#webHtml').value.trim(); if (!text) throw new Error('Вставь текст рецепта');
    return openImportedRecipe({ title: text.split('\n')[0].slice(0, 200), steps: text, sourceUrl: Book.url($('#webRecipeUrl').value) });
  });
  $('#webImportClose').onclick = () => closeModal(); openModal();
}
async function openImportedRecipe(recipe) {
  if (await offerDraft()) return;
  openFormModal({ ...recipe, category: state.categories.includes(recipe.category) ? recipe.category : defaultCategory() });
  $('#servings').value = recipe.servings || '';
  state.formDirty = true; await persistDraft();
  // Keep the review editor open; importing never saves an unchecked recipe automatically.
  if (recipe.imageUrl) {
    const form = $('#recipeForm'), request = {};
    state.imageLoading = true; state.imageRequest = request;
    try {
      const endpoint = BookUI.config.importEndpoint;
      const imageUrl = endpoint ? endpoint.replace(/\/$/, '') + '/image?url=' + encodeURIComponent(recipe.imageUrl) : recipe.imageUrl;
      const response = await fetch(imageUrl, { credentials: 'omit', signal: AbortSignal.timeout(10000) });
      if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) return;
      const blob = await response.blob(); if (blob.size > 5 * 1024 * 1024) return;
      const image = await compressImage(blob);
      if (form !== $('#recipeForm') || state.imageRequest !== request || !isModalOpen()) return;
      state.currentImage = image; setPreview(image); scheduleDraft();
    } catch { toast('Текст извлечён; фото можно добавить отдельно'); }
    finally { if (state.imageRequest === request) state.imageLoading = false; }
  }
}
let pdfLibraryPromise;
function loadBookScript(src) { return new Promise((resolve, reject) => { const el = document.createElement('script'); el.src = src; el.onload = resolve; el.onerror = () => { el.remove(); reject(new Error('Не удалось загрузить ' + src)); }; document.head.appendChild(el); }); }
async function exportBookPDF(onlyRecipe, servings) {
  if (!pdfLibraryPromise) pdfLibraryPromise = (async () => { await loadBookScript('vendor/jspdf.umd.min.js'); await loadBookScript('vendor/book-font.js'); })().catch(err => { pdfLibraryPromise = null; throw err; });
  await pdfLibraryPromise;
  const recipes = onlyRecipe ? [onlyRecipe] : (await dbGetAll()).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  if (!recipes.length) { toast('Нет рецептов для PDF'); return; }
  const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.addFileToVFS('Book.ttf', window.BookFont); pdf.addFont('Book.ttf', 'Book', 'normal'); pdf.setFont('Book');
  pdf.setProperties({ title: onlyRecipe?.title || 'Моя кулинарная книга', author: 'Рецепты 98' });
  let y = 18;
  const plain = text => String(text || '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');
  const write = (text, size = 11) => {
    pdf.setFontSize(size);
    for (const line of pdf.splitTextToSize(plain(text), 174)) {
      if (y + size * .45 > 278) { pdf.addPage(); y = 18; }
      pdf.text(line, 18, y); y += size * .5;
    }
    y += 3;
  };
  for (let index = 0; index < recipes.length; index++) {
    const r = recipes[index]; if (index) { pdf.addPage(); y = 18; }
    write(r.title, 20); write(r.category, 10); if (r.description) write(r.description);
    if (r.image) {
      try {
        const image = await blobToDataUrl(normalizeImage(r.image)), info = pdf.getImageProperties(image);
        const h = Math.min(65, 140 * info.height / info.width), w = h * info.width / info.height;
        if (y + h > 278) { pdf.addPage(); y = 18; }
        pdf.addImage(image, info.fileType, 18, y, w, h); y += h + 6;
      } catch { /* An unreadable photo must not stop the text export. */ }
    }
    const n = onlyRecipe ? servings : r.servings;
    if (r.servings) write('Порций: ' + (n || r.servings));
    write('Ингредиенты', 14); Kitchen.scaled(r, n).forEach(i => write('• ' + Kitchen.line(i)));
    write('Приготовление', 14); write(r.steps || 'Шаги не указаны');
    if (r.notes) { write('Мои заметки', 14); write(r.notes); }
    if (r.tags?.length) write('Теги: ' + r.tags.join(', '), 10);
    if (r.sourceUrl) write('Источник: ' + r.sourceUrl, 9);
  }
  const pages = pdf.getNumberOfPages();
  for (let n = 1; n <= pages; n++) { pdf.setPage(n); pdf.setFontSize(9); pdf.text(n + ' / ' + pages, 190, 289, { align: 'right' }); }
  pdf.save('recipes-' + Book.day() + '.pdf'); toast('PDF подготовлен');
}

async function handleSharedRecipe() {
  const query = new URLSearchParams(location.search);
  const raw = query.get('recipe_url') || query.get('share_url') || (query.get('share_text') || '').match(/https?:\/\/[^\s]+/)?.[0];
  if (!Book.url(raw)) return;
  const clean = new URL(location.href);
  ['recipe_url', 'share_url', 'share_text', 'share_title'].forEach(k => clean.searchParams.delete(k));
  history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
  await showWebImport(); $('#webRecipeUrl').value = Book.url(raw);
  $('#webImportStatus').textContent = 'Ссылка получена. Нажми «Извлечь рецепт» для просмотра перед сохранением.';
}
