'use strict';
// Pure recipe helpers shared by the UI and regression tests.
const Kitchen = (() => {
  const text = (v, max = 500) => typeof v === 'string' ? v.slice(0, max).trim() : '';
  function quantity(v) {
    if (v === '' || v == null) return null;
    const s = String(v).trim().replace(',', '.');
    const fraction = s.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
    const n = fraction ? Number(fraction[1] || 0) + Number(fraction[2]) / Number(fraction[3]) : Number(s);
    return Number.isFinite(n) && n > 0 && n <= 1e9 ? n : null;
  }
  function items(recipe) {
    if (Array.isArray(recipe.ingredientItems)) return recipe.ingredientItems.slice(0, 500).map(i => ({
      name: text(i && i.name), amount: quantity(i && i.amount), unit: text(i && i.unit, 30)
    })).filter(i => i.name);
    return text(recipe.ingredients, 20000).split('\n').filter(s => s.trim()).map(line => {
      const m = line.match(/^(.+?)\s+[—–-]\s+(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+|\/\d+)?)\s*([^\d]*)$/);
      return m ? { name: m[1].trim(), amount: quantity(m[2]), unit: m[3].trim() } : { name: line.trim(), amount: null, unit: '' };
    });
  }
  const format = n => Number(n.toFixed(3)).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  const line = (i, factor = 1) => i.name + (i.amount == null ? '' : ' — ' + format(i.amount * factor)) + (i.unit ? ' ' + i.unit : '');
  function scaled(recipe, servings) {
    const base = quantity(recipe.servings);
    const factor = base && quantity(servings) ? quantity(servings) / base : 1;
    return items(recipe).map(i => ({ ...i, amount: i.amount == null ? null : i.amount * factor }));
  }
  function shopping(selections) {
    const result = new Map();
    const norm = s => s.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim();
    const units = { 'г': ['г', 1], 'гр': ['г', 1], 'кг': ['г', 1000], 'мл': ['мл', 1], 'л': ['мл', 1000], 'шт.': ['шт', 1], 'шт': ['шт', 1] };
    selections.forEach(({ recipe, servings }) => scaled(recipe, servings).forEach(i => {
      const u = units[norm(i.unit)] || [norm(i.unit), 1];
      const key = JSON.stringify([norm(i.name), u[0], i.amount == null]);
      const found = result.get(key);
      if (found && i.amount != null) found.amount += i.amount * u[1];
      else if (!found) result.set(key, { name: i.name, amount: i.amount == null ? null : i.amount * u[1], unit: u[0], checked: false });
    }));
    return [...result.values()];
  }
  function shareText(recipe, servings) {
    return [recipe.title, recipe.description, recipe.servings ? 'Порций: ' + (servings || recipe.servings) : '', 'Ингредиенты:',
      ...scaled(recipe, servings).map(i => '• ' + line(i)), '', 'Приготовление:', recipe.steps].filter(v => v != null && v !== '').join('\n');
  }
  return { quantity, items, line, scaled, shopping, shareText };
})();
if (typeof module !== 'undefined') module.exports = Kitchen;
