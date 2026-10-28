const { test } = require('node:test');
const assert = require('node:assert/strict');
const K = require('../kitchen.js');
test('fractions, commas and invalid quantities', () => {
  assert.equal(K.quantity('1 1/2'), 1.5); assert.equal(K.quantity('1/2'), .5); assert.equal(K.quantity('1,25'), 1.25);
  for (const n of ['', null, '-2', '1/0', 'NaN', '0', '1e100']) assert.equal(K.quantity(n), null);
});
test('legacy ingredients preserve ambiguous text', () => {
  const items = K.items({ ingredients: 'Мясо — 500 г\nСоль по вкусу\nЯйцо - 2 шт\nМука — 1/2 кг' });
  assert.deepEqual(items[0], { name: 'Мясо', amount: 500, unit: 'г' });
  assert.equal(K.line(items[1]), 'Соль по вкусу');
  assert.equal(items[3].amount, .5);
});
test('portions scale only when the base is known and do not mutate recipe', () => {
  const recipe = { servings: 4, ingredientItems: [{ name: 'Мясо', amount: 500, unit: 'г' }, { name: 'Соль', amount: null, unit: 'по вкусу' }] };
  assert.equal(K.scaled(recipe, 6)[0].amount, 750);
  assert.equal(K.scaled(recipe, 6)[1].amount, null);
  assert.equal(recipe.ingredientItems[0].amount, 500);
  assert.equal(K.scaled({ ingredients: 'Мясо — 500 г' }, 6)[0].amount, 500);
});
test('shopping combines compatible units, keeps spoons separate and no-quantity items', () => {
  const recipe = { ingredientItems: [{ name: 'Мука', amount: 1, unit: 'кг' }, { name: ' мука ', amount: 500, unit: 'г' }, { name: 'Мука', amount: 2, unit: 'ст. л.' }, { name: 'Соль', amount: null, unit: '' }] };
  const list = K.shopping([{ recipe }]);
  assert.equal(list.length, 3); assert.equal(list[0].amount, 1500); assert.equal(list[0].unit, 'г');
  assert.equal(list[1].amount, 2); assert.equal(list[2].amount, null);
});
test('share includes scaled ingredients and full steps', () => {
  const result = K.shareText({ title: 'Суп', servings: 2, ingredients: 'Мясо — 100 г', steps: 'Нарезать\nВарить' }, 4);
  assert.match(result, /Порций: 4/); assert.match(result, /200 г/); assert.match(result, /Нарезать\nВарить/);
});
