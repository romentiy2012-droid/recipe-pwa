'use strict';
const Book = (() => {
  const clean = (x, max = 20000) => typeof x === 'string' ? x.slice(0, max).trim() : '';
  const normalize = x => clean(x).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
  const tags = x => [...new Map((Array.isArray(x) ? x : clean(x).split(/[,;\n]/)).map(t => clean(t, 40)).filter(Boolean).map(t => [normalize(t), t])).values()].slice(0, 30);
  function url(x) { try { const u = new URL(x); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } }
  function day(date = new Date()) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); }
  function shift(date, n) { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return day(d); }
  function monday(date = day()) { const d = new Date(date + 'T12:00:00'); return shift(date, -((d.getDay() + 6) % 7)); }
  function fridge(recipes, products) {
    const have = [...new Set(products.split(/[,;\n]/).map(normalize).filter(Boolean))];
    if (!have.length) return [];
    return recipes.map(recipe => {
      const items = Kitchen.items(recipe), found = [], missing = [];
      items.forEach(i => (have.some(p => normalize(i.name).includes(p)) ? found : missing).push(i.name));
      return { recipe, found, missing, score: found.length / Math.max(items.length, 1) };
    }).filter(x => x.found.length).sort((a, b) => b.score - a.score || b.found.length - a.found.length || a.missing.length - b.missing.length);
  }
  function validPlan(rows) {
    return (Array.isArray(rows) ? rows : []).slice(0, 10000).filter(p => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && clean(p.recipeUuid) && ['breakfast', 'lunch', 'dinner', 'snack'].includes(p.meal)).map(p => ({
      id: clean(p.id, 150) || crypto.randomUUID(), date: p.date, meal: p.meal, recipeUuid: clean(p.recipeUuid, 150), title: clean(p.title, 200),
      servings: Number.isInteger(p.servings) && p.servings > 0 && p.servings <= 10000 ? p.servings : null,
      updatedAt: Number.isFinite(p.updatedAt) ? p.updatedAt : 0, ...(p.deletedAt ? { deletedAt: p.deletedAt } : {})
    }));
  }
  // Per-record revisions distinguish a later edit from concurrent edits on two devices.
  function revise(record) {
    return { ...record, uuid: record.uuid || crypto.randomUUID(), revisionId: crypto.randomUUID(),
      ancestors: [...new Set([...(record.ancestors || []), record.revisionId].filter(Boolean))].slice(-100), updatedAt: Date.now() };
  }
  function merge(snapshots) {
    const groups = new Map(), tombstones = new Map(), plan = new Map(), cats = new Set();
    for (const s of snapshots) {
      if (!s || s.app !== 'recipes98' || !Array.isArray(s.recipes)) throw new Error('Облако содержит неподходящий файл');
      (s.categories || []).filter(c => typeof c === 'string').forEach(c => cats.add(c));
      (s.tombstones || []).forEach(t => { if (t && typeof t.uuid === 'string') tombstones.set(t.uuid, t); });
      validPlan(s.planner).forEach(p => { const old = plan.get(p.id); if (!old || p.updatedAt > old.updatedAt || (p.updatedAt === old.updatedAt && JSON.stringify(p) > JSON.stringify(old))) plan.set(p.id, p); });
      for (const r of s.recipes) {
        if (!r || !clean(r.uuid, 150) || !clean(r.title, 200)) continue;
        const list = groups.get(r.uuid) || [];
        const rev = r.revisionId || 'legacy-' + (r.updatedAt || r.createdAt || 0);
        if (!list.some(v => (v.revisionId || 'legacy-' + (v.updatedAt || v.createdAt || 0)) === rev)) list.push(r);
        groups.set(r.uuid, list);
      }
    }
    const result = new Map(); let conflicts = 0;
    for (const [uuid, versions] of groups) {
      if (tombstones.has(uuid)) continue;
      const tips = versions.filter(r => !versions.some(v => (v.ancestors || []).includes(r.revisionId)));
      tips.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || String(b.revisionId).localeCompare(String(a.revisionId)));
      const winner = tips[0]; if (!winner) continue;
      result.set(uuid, winner);
      for (const other of tips.slice(1)) {
        const id = uuid + '~' + (other.revisionId || other.updatedAt || 'legacy');
        if (tombstones.has(id)) continue;
        result.set(id, { ...other, uuid: id, title: other.title + (other.conflictOf ? '' : ' (конфликт)'), conflictOf: uuid }); conflicts++;
      }
    }
    // An already edited conflict copy has priority over its reconstructed original version.
    for (const [uuid, versions] of groups) if (uuid.includes('~') && !tombstones.has(uuid)) {
      const latest = versions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]; result.set(uuid, latest);
    }
    const shoppingSource = snapshots.slice().sort((a, b) => (b.shoppingUpdatedAt || 0) - (a.shoppingUpdatedAt || 0) || JSON.stringify(b.shopping || []).localeCompare(JSON.stringify(a.shopping || [])))[0];
    return { app: 'recipes98', version: 3, categories: [...cats], recipes: [...result.values()], planner: [...plan.values()], tombstones: [...tombstones.values()],
      shopping: shoppingSource?.shopping || [], shoppingUpdatedAt: shoppingSource?.shoppingUpdatedAt || 0, conflicts };
  }
  function parseHTML(html, source = '') {
    if (html.length > 3 * 1024 * 1024) throw new Error('Страница слишком большая');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const plain = x => { const d = new DOMParser().parseFromString(String(x || '').slice(0, 40000), 'text/html'); return (d.body.textContent || '').trim(); };
    const flatten = x => Array.isArray(x) ? x.flatMap(flatten) : typeof x === 'string' ? [plain(x)] : x && typeof x === 'object' ? [...(x.text ? [plain(x.text)] : x.name && !x.itemListElement ? [plain(x.name)] : []), ...flatten(x.itemListElement || x.steps || [])] : [];
    const found = []; let count = 0;
    function walk(x, depth = 0) {
      if (!x || depth > 35 || ++count > 10000) return;
      if (Array.isArray(x)) { x.forEach(v => walk(v, depth + 1)); return; }
      if (typeof x !== 'object') return;
      if ([].concat(x['@type'] || []).some(t => /(?:^|[/#])Recipe$/.test(t))) found.push(x);
      Object.values(x).forEach(v => { if (typeof v === 'object') walk(v, depth + 1); });
    }
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(el => { try { walk(JSON.parse(el.textContent)); } catch {} });
    const normalizeRecipe = r => {
      const yieldText = Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield?.value ?? r.recipeYield;
      const yieldString = String(yieldText || '');
      // Do not mistake "12 cookies" or "1 cake" for a serving count.
      const m = yieldString.match(/^\s*(\d+)\s*(?:порц\S*|чел\S*|servings?|people|persons?)?\s*$/i);
      const image = Array.isArray(r.image) ? r.image[0] : r.image;
      let imageUrl = ''; try { if (image) imageUrl = url(new URL(typeof image === 'string' ? image : image?.url || '', source).href); } catch {}
      const ingredients = [].concat(r.recipeIngredient || []).flatMap(i => typeof i === 'string' ? [plain(i)] : i?.name ? [plain(i.name) + (i.value ? ' — ' + plain(i.value) + ' ' + plain(i.unitText || '') : '')] : flatten(i?.itemListElement || [])).join('\n');
      return { title: plain(r.name).slice(0, 200), description: plain(r.description).slice(0, 1000), ingredients, steps: flatten(r.recipeInstructions).join('\n'),
        category: plain([].concat(r.recipeCategory || [])[0]), tags: tags(Array.isArray(r.keywords) ? r.keywords : plain(r.keywords)), sourceUrl: url(source), imageUrl,
        servings: m && +m[1] > 0 && +m[1] <= 10000 ? +m[1] : null };
    };
    if (found.length) return found.map(normalizeRecipe).filter(r => r.title && (r.ingredients || r.steps));
    const scope = doc.querySelector('[itemtype$="/Recipe"]');
    if (!scope) return [];
    const values = prop => [...scope.querySelectorAll('[itemprop="' + prop + '"]')].map(el => el.getAttribute('content') || el.textContent);
    return [normalizeRecipe({ name: values('name')[0], description: values('description')[0], recipeIngredient: values('recipeIngredient'), recipeInstructions: values('recipeInstructions'), recipeYield: values('recipeYield')[0] })].filter(r => r.title);
  }
  return { clean, normalize, tags, url, day, shift, monday, fridge, validPlan, revise, merge, parseHTML };
})();
if (typeof module !== 'undefined') module.exports = Book;
