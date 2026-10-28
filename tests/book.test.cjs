const { test } = require('node:test');
const assert = require('node:assert/strict');
global.Kitchen = require('../kitchen.js');
const Book = require('../book-core.js');
test('tags normalize whitespace and duplicate spelling; URLs reject executable schemes', () => {
  assert.deepEqual(Book.tags('Быстро, быстро; Семейное'), ['быстро', 'Семейное']);
  assert.equal(Book.url('javascript:alert(1)'), ''); assert.equal(Book.url('https://user:pass@example.com'), '');
  assert.equal(Book.url('https://example.com/recipe'), 'https://example.com/recipe');
});
test('week arithmetic uses calendar dates across years', () => {
  assert.equal(Book.monday('2026-01-01'), '2025-12-29'); assert.equal(Book.shift('2026-12-31', 1), '2027-01-01');
});
test('fridge ranks matches and reports missing products without changing recipe', () => {
  const rows = [{ title: 'Суп', ingredients: 'Курица — 500 г\nЛук — 1 шт' }, { title: 'Лук', ingredients: 'Лук — 1 шт' }];
  const result = Book.fridge(rows, 'лук'); assert.equal(result[0].recipe.title, 'Лук'); assert.deepEqual(result[1].missing, ['Курица']);
});
const snapshot = recipes => ({ app: 'recipes98', version: 3, recipes, categories: [], planner: [], shopping: [] });
test('sync takes a descendant instead of creating a conflict', () => {
  const a = { uuid: 'r', revisionId: 'a', title: 'Суп', updatedAt: 1, ancestors: [] };
  const b = { ...a, revisionId: 'b', title: 'Новый суп', updatedAt: 2, ancestors: ['a'] };
  const merged = Book.merge([snapshot([a]), snapshot([b])]); assert.equal(merged.recipes.length, 1); assert.equal(merged.recipes[0].title, 'Новый суп');
});
test('concurrent changes are preserved, deterministic and stable after another sync', () => {
  const a = { uuid: 'r', revisionId: 'a', title: 'Первый', updatedAt: 2, ancestors: ['parent'] };
  const b = { ...a, revisionId: 'b', title: 'Второй', updatedAt: 3 };
  const merged = Book.merge([snapshot([a]), snapshot([b])]);
  assert.equal(merged.recipes.length, 2); assert.ok(merged.recipes.some(r => r.title === 'Первый (конфликт)'));
  const next = Book.merge([snapshot([b]), merged, snapshot([a])]); assert.deepEqual(next.recipes.map(r => r.uuid).sort(), merged.recipes.map(r => r.uuid).sort());
});
test('hard-delete tombstone prevents resurrection; planned removals survive sync', () => {
  const recipe = { uuid: 'r', revisionId: 'a', title: 'Суп' };
  const first = { ...snapshot([recipe]), planner: [{ id: 'p', date: '2026-10-28', meal: 'dinner', recipeUuid: 'r', updatedAt: 1 }] };
  const second = { ...snapshot([]), tombstones: [{ uuid: 'r', deletedAt: 2 }], planner: [{ ...first.planner[0], deletedAt: 2, updatedAt: 2 }] };
  const merged = Book.merge([first, second]); assert.equal(merged.recipes.length, 0); assert.equal(merged.planner[0].deletedAt, 2);
});
