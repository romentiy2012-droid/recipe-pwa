'use strict';
async function createBookSnapshot() {
  const [recipes, categories, planner, shopping, tombstones, shoppingTime] = await Promise.all([dbGetAllRaw(), catGetAll(), metaGet('planner'), metaGet('shopping'), metaGet('tombstones'), metaGet('shoppingUpdatedAt')]);
  const out = { app: 'recipes98', version: 3, exportedAt: new Date().toISOString(), categories, planner: planner?.value || [], shopping: shopping?.value || [], shoppingUpdatedAt: shoppingTime?.value || 0, tombstones: tombstones?.value || [], recipes: [] };
  for (const r of recipes) {
    const { id, image, ...rest } = r;
    const blob = normalizeImage(image); out.recipes.push({ ...rest, image: blob ? await blobToDataUrl(blob) : null });
  }
  return out;
}
function safeCloudRecipe(x) {
  return { uuid: Book.clean(x.uuid, 150), revisionId: Book.clean(x.revisionId, 150), ancestors: (Array.isArray(x.ancestors) ? x.ancestors : []).filter(v => typeof v === 'string').slice(-100),
    title: Book.clean(x.title, 200), description: Book.clean(x.description, 1000), category: Book.clean(x.category, 30) || OTHER,
    ingredients: Book.clean(x.ingredients), ingredientItems: Kitchen.items(x), steps: Book.clean(x.steps), notes: Book.clean(x.notes), tags: Book.tags(x.tags), sourceUrl: Book.url(x.sourceUrl),
    relatedUuids: (Array.isArray(x.relatedUuids) ? x.relatedUuids : []).filter(v => typeof v === 'string').slice(0, 500),
    servings: Number.isInteger(x.servings) && x.servings > 0 && x.servings <= 10000 ? x.servings : null,
    favorite: x.favorite === true, image: typeof x.image === 'string' && DATA_URL_RE.test(x.image) ? x.image : null,
    createdAt: Number.isFinite(x.createdAt) ? x.createdAt : 0, updatedAt: Number.isFinite(x.updatedAt) ? x.updatedAt : 0,
    ...(Number.isFinite(x.deletedAt) && x.deletedAt > 0 ? { deletedAt: x.deletedAt } : {}), ...(typeof x.conflictOf === 'string' ? { conflictOf: x.conflictOf } : {}) };
}
function validateCloudSnapshot(s) {
  if (!s || s.app !== 'recipes98' || !Array.isArray(s.recipes) || s.recipes.length > 5000 || ![3].includes(s.version)) throw new Error('Неподходящая версия облачного файла');
  return { ...s, recipes: s.recipes.map(safeCloudRecipe).filter(r => r.uuid && r.title), categories: (Array.isArray(s.categories) ? s.categories : []).filter(v => typeof v === 'string').map(v => v.slice(0, 30)).slice(0, 500),
    tombstones: (Array.isArray(s.tombstones) ? s.tombstones : []).filter(t => t && typeof t.uuid === 'string').slice(0, 10000).map(t => ({ uuid: t.uuid.slice(0, 150), deletedAt: Number.isFinite(t.deletedAt) ? t.deletedAt : 0 })) };
}
async function applyCloudSnapshot(snapshot) {
  const existing = await dbGetAllRaw(), byUuid = new Map(existing.map(r => [r.uuid, r]));
  const recipes = snapshot.recipes.map(safeCloudRecipe).map(r => ({ ...r, image: dataUrlToBlob(r.image), ...(byUuid.has(r.uuid) ? { id: byUuid.get(r.uuid).id } : {}) }));
  const keep = new Set(recipes.map(r => r.uuid));
  const shopping = (Array.isArray(snapshot.shopping) ? snapshot.shopping : []).slice(0, 5000).filter(i => i && typeof i.name === 'string').map(i => ({ name: i.name.slice(0, 500), amount: Kitchen.quantity(i.amount), unit: Book.clean(i.unit, 30), checked: i.checked === true }));
  await new Promise((resolve, reject) => {
    const t = db.transaction([STORE, CAT_STORE, META_STORE], 'readwrite', { durability: 'strict' });
    const store = t.objectStore(STORE), meta = t.objectStore(META_STORE), cats = t.objectStore(CAT_STORE);
    existing.filter(r => !keep.has(r.uuid)).forEach(r => store.delete(r.id));
    recipes.forEach(r => store.put(r));
    [...new Set([...DEFAULT_CATEGORIES, ...snapshot.categories, ...recipes.map(r => r.category)])].forEach(name => cats.put({ name, createdAt: Date.now() }));
    meta.put({ key: 'planner', value: Book.validPlan(snapshot.planner) }); meta.put({ key: 'shopping', value: shopping });
    meta.put({ key: 'shoppingUpdatedAt', value: snapshot.shoppingUpdatedAt || 0 }); meta.put({ key: 'tombstones', value: snapshot.tombstones });
    t.oncomplete = resolve; t.onabort = t.onerror = () => reject(t.error || new Error('Не удалось сохранить синхронизацию'));
  });
  await refresh();
}
async function showCloud() {
  const config = BookUI.config, sync = (await metaGet('syncStatus'))?.value;
  $('#modalTitle').textContent = 'Облако и импорт'; $('#modalIcon').textContent = '☁️';
  $('#modalContent').innerHTML = '<p>Синхронизация объединяет рецепты и меню между устройствами. Одновременные правки рецепта сохраняются отдельными копиями с пометкой «конфликт». Для покупок используется самый поздний список.</p><p id="cloudStatus" role="status">' + escapeHtml(sync ? 'Последняя синхронизация: ' + new Date(sync.at).toLocaleString('ru-RU') + ' · ' + sync.provider : 'Синхронизации ещё не было') + '</p>' +
    '<div class="book-actions"><button id="googleConnect">Войти в Google Drive</button><button id="googleSync">Синхронизировать Drive</button><button id="dropboxConnect">Войти в Dropbox</button><button id="dropboxSync">Синхронизировать Dropbox</button><button id="cloudDisconnect">Выйти на этом устройстве</button></div>' +
    '<details id="connectionSettings"><summary>Настройка подключений</summary><p class="field-hint">Для первого подключения владелец приложения регистрирует OAuth-клиенты в Google и Dropbox. Здесь нужны только публичные идентификаторы, без паролей и секретных ключей. Инструкция: <a href="https://github.com/romentiy2012-droid/recipe-pwa/blob/main/SETUP.md" target="_blank" rel="noopener">SETUP.md</a>.</p>' +
    '<label>Google Client ID<input id="googleClientId" type="text" value="' + escapeHtml(config.googleClientId || '') + '"></label><label>Dropbox App key<input id="dropboxAppKey" type="text" value="' + escapeHtml(config.dropboxAppKey || '') + '"></label><label>Адрес обработчика импорта<input id="importEndpoint" type="url" placeholder="https://recipes-import.example.workers.dev" value="' + escapeHtml(config.importEndpoint || '') + '"></label><button id="saveConnections">Сохранить настройки</button></details>' +
    '<p class="field-hint">Подключения и токены не включаются в резервные копии. После истечения входа потребуется снова нажать «Войти». Для другого устройства используй те же OAuth-приложения. Подключение ChatGPT к Drive отдельно от входа в эту кулинарную книгу.</p><button id="cloudRecovery">Восстановить данные до последней синхронизации</button><button id="cloudClose">Закрыть</button>';
  if (!config.googleClientId && !config.dropboxAppKey && !config.importEndpoint) $('#connectionSettings').open = true;
  const googleButton = $('#googleConnect');
  if (config.googleClientId && !window.google?.accounts?.oauth2) {
    googleButton.disabled = true;
    loadBookScript('https://accounts.google.com/gsi/client').then(() => { if (googleButton.isConnected) googleButton.disabled = false; }).catch(err => { if (googleButton.isConnected) googleButton.disabled = false; bookError(err); });
  }
  // Google popup must be opened synchronously from a user gesture.
  googleButton.onclick = () => {
    try {
      if (!config.googleClientId) throw new Error('Сначала укажи Google Client ID в настройках');
      if (!window.google?.accounts?.oauth2) throw new Error('Библиотека Google ещё не загрузилась. Открой настройки снова с интернетом.');
      const client = google.accounts.oauth2.initTokenClient({ client_id: config.googleClientId, scope: 'https://www.googleapis.com/auth/drive.appdata',
        callback: response => { if (response.error) { bookError(new Error(response.error)); return; } BookUI.googleToken = { token: response.access_token, expiresAt: Date.now() + Number(response.expires_in) * 1000 }; $('#cloudStatus').textContent = 'Google Drive подключён. Нажми «Синхронизировать Drive».'; }, error_callback: e => bookError(new Error(e.type || 'Окно входа Google закрыто')) });
      client.requestAccessToken({ prompt: 'select_account' });
    } catch (e) { bookError(e); }
  };
  bookClick($('#saveConnections'), async () => {
    const endpoint = $('#importEndpoint').value.trim();
    if (endpoint && (!Book.url(endpoint) || new URL(endpoint).protocol !== 'https:')) throw new Error('Обработчик должен иметь адрес https://');
    const settings = { googleClientId: $('#googleClientId').value.trim(), dropboxAppKey: $('#dropboxAppKey').value.trim(), importEndpoint: endpoint };
    if (settings.googleClientId !== BookUI.config.googleClientId) BookUI.googleToken = null;
    if (settings.dropboxAppKey !== BookUI.config.dropboxAppKey) sessionStorage.removeItem('recipes98-dropbox');
    await metaPut('connections', settings); BookUI.config = settings; await showCloud(); toast('Настройки сохранены');
  });
  bookClick($('#dropboxConnect'), connectDropbox);
  bookClick($('#googleSync'), () => syncBookCloud('Google Drive'));
  bookClick($('#dropboxSync'), () => syncBookCloud('Dropbox'));
  bookClick($('#cloudDisconnect'), async () => { BookUI.googleToken = null; sessionStorage.removeItem('recipes98-dropbox'); toast('Вход на этом устройстве завершён'); });
  bookClick($('#cloudRecovery'), async () => {
    const recovery = (await metaGet('syncRecovery'))?.value; if (!recovery) throw new Error('Копии перед синхронизацией пока нет');
    const result = await ask({ title: 'Восстановление', text: 'Вернуть рецепты, меню и покупки к состоянию до последней синхронизации? Последующие локальные изменения будут заменены.', buttons: [{ id: 'cancel', label: 'Отмена', primary: true }, { id: 'restore', label: 'Восстановить' }], cancelId: 'cancel' });
    if (result === 'restore') { await applyCloudSnapshot(validateCloudSnapshot(recovery)); toast('Локальная копия восстановлена. Для отката облака сначала проверь данные.'); }
  });
  $('#cloudClose').onclick = () => closeModal(); openModal();
}
function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function connectDropbox() {
  const key = BookUI.config.dropboxAppKey; if (!key) throw new Error('Сначала укажи Dropbox App key');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48))), state = crypto.randomUUID();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const redirect = new URL('./', location.href).href;
  sessionStorage.setItem('recipes98-pkce', JSON.stringify({ verifier, state, redirect, key, at: Date.now() }));
  const target = new URL('https://www.dropbox.com/oauth2/authorize');
  Object.entries({ client_id: key, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: redirect, state, token_access_type: 'online' }).forEach(([k, v]) => target.searchParams.set(k, v));
  location.assign(target.href);
}
async function finishDropboxLogin() {
  const params = new URLSearchParams(location.search); if (!params.has('code') && !params.has('error')) return;
  const saved = sessionStorage.getItem('recipes98-pkce'); if (!saved) return;
  sessionStorage.removeItem('recipes98-pkce');
  const code = params.get('code'), state = params.get('state'), error = params.get('error');
  const cleanUrl = new URL(location.href); ['code', 'state', 'error', 'error_description'].forEach(k => cleanUrl.searchParams.delete(k)); history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
  try {
    const flow = JSON.parse(saved);
    if (flow.state !== state || Date.now() - flow.at > 10 * 60000) throw new Error('Проверка входа Dropbox не пройдена. Повтори вход.');
    if (error || !code) throw new Error('Вход в Dropbox отменён');
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', signal: AbortSignal.timeout(15000), body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: flow.key, code_verifier: flow.verifier, redirect_uri: flow.redirect }) });
    const data = await response.json(); if (!response.ok || !data.access_token) throw new Error('Dropbox не выдал доступ: ' + (data.error_description || data.error || response.status));
    sessionStorage.setItem('recipes98-dropbox', JSON.stringify({ token: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 })); toast('Dropbox подключён. Открой «Облако» для синхронизации.');
  } catch (err) { bookError(err); }
}
function cloudToken(provider) {
  let auth = provider === 'Google Drive' ? BookUI.googleToken : null;
  if (provider === 'Dropbox') { try { auth = JSON.parse(sessionStorage.getItem('recipes98-dropbox')); } catch {} }
  if (!auth?.token || !Number.isFinite(auth.expiresAt) || auth.expiresAt < Date.now() + 30000) throw new Error('Сначала нажми «Войти» для ' + provider);
  return auth.token;
}
async function checkedFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(response.status === 401 ? 'Срок входа истёк. Войди в облако снова.' : 'Ошибка облака: ' + response.status);
  return response;
}
async function cloudSnapshots(provider, token) {
  const headers = { Authorization: 'Bearer ' + token };
  if (provider === 'Google Drive') {
    const query = new URLSearchParams({ spaces: 'appDataFolder', q: "trashed = false and mimeType = 'application/json'", fields: 'files(id,name),nextPageToken', pageSize: '100' });
    const list = await (await checkedFetch('https://www.googleapis.com/drive/v3/files?' + query, { headers })).json();
    const files = (list.files || []).filter(f => /^recipes98-device-[a-z0-9-]+\.json$/i.test(f.name));
    if (list.nextPageToken || files.length > 30) throw new Error('Слишком много облачных файлов: требуется очистка старых устройств');
    const snapshots = [];
    for (const file of files) snapshots.push(validateCloudSnapshot(await (await checkedFetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media', { headers })).json()));
    return { files, snapshots };
  }
  const listResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/devices', limit: 100 }), signal: AbortSignal.timeout(30000) });
  if (listResponse.status === 409) {
    const error = await listResponse.json(); if (!String(error.error_summary).startsWith('path/not_found')) throw new Error('Dropbox: ' + error.error_summary);
    await checkedFetch('https://api.dropboxapi.com/2/files/create_folder_v2', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/devices', autorename: false }) });
    return { files: [], snapshots: [] };
  }
  if (!listResponse.ok) throw new Error('Dropbox: ' + listResponse.status);
  const list = await listResponse.json(), files = (list.entries || []).filter(f => f['.tag'] === 'file' && /^[a-z0-9-]+\.json$/i.test(f.name));
  if (list.has_more || files.length > 30) throw new Error('Слишком много облачных файлов');
  const snapshots = [];
  for (const file of files) snapshots.push(validateCloudSnapshot(await (await checkedFetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { ...headers, 'Dropbox-API-Arg': JSON.stringify({ path: file.path_lower }) } })).json()));
  return { files, snapshots };
}
async function writeCloudSnapshot(provider, token, device, snapshot, files) {
  const headers = { Authorization: 'Bearer ' + token }, body = JSON.stringify(snapshot);
  if (new Blob([body]).size > 100 * 1024 * 1024) throw new Error('Книга превышает 100 МБ. Сохрани JSON и уменьши число фотографий перед синхронизацией.');
  if (provider === 'Dropbox') {
    await checkedFetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: '/devices/' + device + '.json', mode: 'overwrite', autorename: false, mute: true }) }, body }); return;
  }
  const name = 'recipes98-device-' + device + '.json', old = files.find(f => f.name === name);
  if (old) { await checkedFetch('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(old.id) + '?uploadType=media', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body }); return; }
  const boundary = 'recipes98_' + crypto.randomUUID().replace(/-/g, '');
  const multipart = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name, parents: ['appDataFolder'] }) + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + boundary + '--';
  await checkedFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { ...headers, 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipart });
}
let cloudBusy = false;
async function syncBookCloud(provider) {
  if (cloudBusy) return;
  const token = cloudToken(provider); cloudBusy = true;
  const status = $('#cloudStatus');
  try {
    status.textContent = 'Получаю данные из ' + provider + '…';
    let device = (await metaGet('deviceId'))?.value;
    if (!device) { device = crypto.randomUUID(); await metaPut('deviceId', device); }
    const local = await createBookSnapshot(), remote = await cloudSnapshots(provider, token);
    const merged = Book.merge([...remote.snapshots, local]);
    await metaPut('syncRecovery', local);
    // Each device owns its cloud file; another device's concurrent upload cannot be overwritten.
    await writeCloudSnapshot(provider, token, device, merged, remote.files);
    await applyCloudSnapshot(merged);
    await metaPut('syncStatus', { at: Date.now(), provider });
    if (status.isConnected) status.textContent = 'Синхронизировано: ' + merged.recipes.length + ' рецептов' + (merged.conflicts ? '. Сохранены конфликтные копии: ' + merged.conflicts : '') + '. На другом устройстве тоже нажми «Синхронизировать».';
  } catch (err) { if (status.isConnected) status.textContent = 'Синхронизация не завершена: ' + err.message; throw err; } finally { cloudBusy = false; }
}
