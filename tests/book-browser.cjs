// Run: node tests/browser.cjs (starts its own local HTTP server).
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const path = require('node:path'), fs = require('node:fs');
  const root = path.resolve(__dirname, '..');
  const server = require('node:http').createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      const types = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'text/plain'); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(8000, '127.0.0.1', resolve));
  const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
  let browser;
  try { browser = await engine.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote'] } : {}) });
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, acceptDownloads: true });
    const page = await context.newPage();
    const eventually = async (read, check = Boolean) => { for (let n = 0; n < 100; n++) { if (check(await read())) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('Expected persisted state was not reached'); };
    const errors = []; page.on('pageerror', e => errors.push(e.message));

    await page.goto('http://127.0.0.1:8000/');
    await page.waitForFunction(() => typeof db !== 'undefined' && db && typeof state.sort === 'string');
    await page.evaluate(async () => {
      await dbAdd({ title: 'Курица', category: 'Вторые блюда', servings: 2, ingredients: 'Курица — 500 г\nЛук — 1 шт', steps: 'Нарезать\nЗапечь', createdAt: 1 });
      await dbAdd({ title: 'Салат', category: 'Салаты', servings: 2, ingredients: 'Огурец — 2 шт\nЛук — 1 шт', steps: 'Нарезать\nСмешать', createdAt: 2 });
      await refresh();
    });
    await page.locator('.recipe-card').filter({ hasText: 'Курица' }).click();
    await page.locator('#dEdit').click();
    await page.locator('#recipeTags').fill('быстро, семейное');
    await page.locator('#recipeNotes').fill('Добавить паприку по вкусу');
    await page.locator('#recipeSource').fill('https://food.ru/recipe/123');
    await page.locator('summary').filter({ hasText: 'Связанные рецепты' }).click();
    await page.locator('#relatedRecipes input').check();
    await page.locator('#recipeForm button[type=submit]').click();
    await page.waitForFunction(() => !document.querySelector('#recipeForm'));
    await page.locator('#tagFilter').selectOption('семейное');
    assert.equal(await page.locator('.recipe-card').count(), 1);
    await page.locator('.recipe-card').click();
    await page.locator('#relatedDetail button').waitFor();
    assert.match(await page.locator('#modalContent').innerText(), /Добавить паприку/);
    await page.locator('#relatedDetail button').click();
    await eventually(() => page.locator('#modalTitle').innerText(), text => text === 'Салат');
    await page.locator('#dClose').click();
    await page.locator('#tagFilter').selectOption('');
    await page.locator('#recipeSort').selectOption('title');
    await eventually(() => page.locator('.recipe-card h3').first().innerText(), text => text === 'Курица');
    await page.locator('[data-extra-action=fridge]').click();
    await page.locator('#fridgeProducts').fill('курица, лук');
    await page.locator('#fridgeFind').click();
    await page.locator('.fridge-result').first().waitFor();
    assert.match(await page.locator('.fridge-result').first().innerText(), /Все указанные продукты найдены/);
    await page.locator('#fridgeClose').click();
    await page.locator('[data-extra-action=planner]').click();
    await page.locator('#planRecipe').selectOption({ label: 'Курица' });
    await page.locator('#planServings').fill('4');
    await page.locator('#planAdd').click();
    await page.locator('.plan-entry').waitFor();
    await page.locator('#planShopping').click();
    await page.locator('#shoppingItems').waitFor();
    assert.match(await page.locator('#shoppingItems').innerText(), /1\s?000 г/);
    await page.locator('#closeShopping').click();
    await page.reload();
    await page.locator('[data-extra-action=planner]').click();
    await page.locator('.plan-entry').waitFor();
    await page.locator('#planClose').click();
    const html = '<html><script type="application/ld+json">' + JSON.stringify({ '@graph': [{ '@type': 'Recipe', name: 'Пирог', recipeYield: '4 servings', recipeIngredient: ['Мука — 500 г'], recipeInstructions: [{ '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Смешать' }, { '@type': 'HowToStep', text: 'Выпечь' }] }], keywords: 'выпечка, сладкое' }] }) + '</script></html>';
    const parsed = await page.evaluate(html => Book.parseHTML(html, 'https://food.ru/pie'), html);
    assert.equal(parsed[0].servings, 4); assert.equal(parsed[0].steps, 'Смешать\nВыпечь'); assert.equal(parsed[0].imageUrl, '');
    await page.locator('[data-extra-action=web-import]').click();
    await page.locator('#modalContent details summary').click();
    await page.locator('#webRecipeUrl').fill('https://food.ru/pie');
    await page.locator('#webHtml').fill(html);
    await page.locator('#webParse').click();
    await page.locator('[data-import-index]').click();
    await page.locator('#recipeForm').waitFor();
    assert.equal(await page.locator('#title').inputValue(), 'Пирог');
    await page.locator('#recipeForm button[type=submit]').click();
    await page.waitForFunction(() => document.querySelectorAll('.recipe-card').length === 3);
    // URL importer uses configured endpoint and handles previews instead of auto-saving.
    await page.evaluate(() => { BookUI.config.importEndpoint = 'https://import.test'; });
    await page.route('https://import.test/page?**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ html, url: 'https://food.ru/pie' }) }));
    await page.locator('[data-extra-action=web-import]').click();
    await page.locator('#webRecipeUrl').fill('https://food.ru/pie');
    await page.locator('#webImportGo').click();
    await page.locator('[data-import-index]').waitFor();
    assert.equal(await page.locator('.recipe-card').count(), 3);
    await page.locator('#webImportClose').click();
    // Real PDF with embedded Cyrillic font and multiple recipes.
    const pdfDownload = page.waitForEvent('download');
    await page.locator('[data-extra-action=pdf]').click();
    const pdf = await pdfDownload;
    await pdf.saveAs('/tmp/recipe-book-v5.pdf');
    assert.equal(require('node:fs').readFileSync('/tmp/recipe-book-v5.pdf').subarray(0, 4).toString(), '%PDF');
    // Mock cloud HTTP transport; verify merge, uploaded snapshots, and a second sync.
    const local = await page.evaluate(() => createBookSnapshot());
    const remote = structuredClone(local);
    remote.recipes[0].title = 'Курица с другого устройства';
    remote.recipes[0].revisionId = 'remote-edit'; remote.recipes[0].updatedAt += 1000;
    remote.recipes[0].ancestors.push(local.recipes[0].revisionId);
    let driveBody, dropboxBody;
    await page.route('https://www.googleapis.com/drive/v3/files?**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ files: [{ id: 'remote', name: 'recipes98-device-remote.json' }] }) }));
    await page.route('https://www.googleapis.com/drive/v3/files/remote?alt=media', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(remote) }));
    await page.route('https://www.googleapis.com/upload/drive/v3/files?**', async r => { driveBody = r.request().postData(); await r.fulfill({ contentType: 'application/json', body: '{"id":"local"}' }); });
    await page.locator('[data-extra-action=cloud]').click();
    await page.evaluate(() => { BookUI.googleToken = { token: 'mock', expiresAt: Date.now() + 3600000 }; });
    await page.locator('#googleSync').click();
    await eventually(() => page.locator('#cloudStatus').innerText(), text => text.startsWith('Синхронизировано:'));
    assert.match(driveBody, /Курица с другого устройства/);
    assert.equal(await page.evaluate(async () => (await dbGetAll()).some(r => r.title === 'Курица с другого устройства')), true);
    assert.equal(await page.evaluate(async () => (await metaGet('syncRecovery')).value.recipes.length), 3);
    await page.route('https://api.dropboxapi.com/2/files/list_folder', r => r.fulfill({ contentType: 'application/json', body: '{"entries":[],"has_more":false}' }));
    await page.route('https://content.dropboxapi.com/2/files/upload', async r => { dropboxBody = JSON.parse(r.request().postData()); await r.fulfill({ contentType: 'application/json', body: '{}' }); });
    await page.evaluate(() => sessionStorage.setItem('recipes98-dropbox', JSON.stringify({ token: 'mock', expiresAt: Date.now() + 3600000 })));
    await page.locator('#dropboxSync').click();
    await eventually(() => page.locator('#cloudStatus').innerText(), text => text.startsWith('Синхронизировано:'));
    await eventually(async () => dropboxBody?.recipes?.length, n => n === 3);
    await eventually(() => page.evaluate(() => cloudBusy), busy => busy === false);
    assert.equal(dropboxBody.planner.length, 1); assert.ok(dropboxBody.recipes[0].uuid);
    // Real PKCE construction and callback, mocked token endpoint (no real account login).
    let oauthUrl;
    await page.evaluate(async () => { BookUI.config.dropboxAppKey = 'public-key'; await metaPut('connections', BookUI.config); });
    await page.route('https://www.dropbox.com/oauth2/authorize?**', async r => { oauthUrl = new URL(r.request().url()); await r.fulfill({ contentType: 'text/html', body: '<html>mock authorization</html>' }); });
    await page.locator('#dropboxConnect').click();
    await eventually(async () => oauthUrl);
    assert.equal(oauthUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(oauthUrl.searchParams.get('code_challenge').length >= 43);
    await page.route('https://api.dropboxapi.com/oauth2/token', r => r.fulfill({ contentType: 'application/json', body: '{"access_token":"callback-token","expires_in":14400}' }));
    await page.goto('http://127.0.0.1:8000/?code=mock-code&state=' + oauthUrl.searchParams.get('state'));
    await eventually(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('recipes98-dropbox') || 'null')?.token), value => value === 'callback-token');
    assert.equal(new URL(page.url()).searchParams.has('code'), false);
    // Offline PDF must load from service worker cache, not a CDN.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => new Promise(resolve => navigator.serviceWorker.controller ? resolve() : navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))));
    await context.setOffline(true); await page.reload();
    const offlineDownload = page.waitForEvent('download');
    await page.locator('[data-extra-action=pdf]').click(); await offlineDownload;
    assert.deepEqual(errors, []);
    console.log('PASS v5: tags, notes, links, sort, fridge, weekly plan, shopping generation, HTML+URL importer, real Cyrillic PDF, Drive/Dropbox transport mocks, offline PDF');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
