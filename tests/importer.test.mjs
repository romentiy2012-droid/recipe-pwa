import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { allowedURL, limitedBody } from '../importer/worker.mjs';
const env = { ALLOWED_ORIGIN: 'https://romentiy2012-droid.github.io' };
const request = target => new Request('https://import.example/page?url=' + encodeURIComponent(target), { headers: { Origin: env.ALLOWED_ORIGIN } });
test('importer only permits HTTPS on explicitly allowed hosts', () => {
  for (const raw of ['http://food.ru/recipe', 'https://127.0.0.1/', 'https://food.ru.evil.tld/', 'https://user:pass@food.ru/', 'https://food.ru:8443/']) assert.throws(() => allowedURL(raw, ['food.ru']));
  assert.equal(allowedURL('https://www.food.ru/recipe', ['food.ru']).hostname, 'www.food.ru');
});
test('origin is checked before fetching a target', async () => {
  const r = await worker.fetch(new Request('https://import.example/page?url=https://food.ru'), env); assert.equal(r.status, 403);
});
test('body limit is enforced even without content-length', async () => {
  await assert.rejects(limitedBody(new Response('abcdefghij'), 5), /слишком большой/);
});
test('worker returns HTML and blocks redirect to a private address', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>recipe</html>', { headers: { 'content-type': 'text/html' } });
    const result = await worker.fetch(request('https://food.ru/recipe'), env); assert.equal(result.status, 200); assert.match((await result.json()).html, /recipe/);
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } });
    assert.equal((await worker.fetch(request('https://food.ru/recipe'), env)).status, 422);
  } finally { globalThis.fetch = original; }
});

test('Vercel adapter preserves origin validation and forwards a recipe page', async () => {
  const { default: handler } = await import('../importer/api/import.mjs');
  const original = globalThis.fetch;
  const headers = new Map(); let body;
  const res = { statusCode: 0, setHeader: (k, v) => headers.set(k, v), end: value => { body = value; } };
  try {
    globalThis.fetch = async () => new Response('<html>Recipe from Vercel</html>', { headers: { 'content-type': 'text/html' } });
    await handler({ url: '/api/import?kind=page&url=https%3A%2F%2Ffood.ru%2Frecipe', method: 'GET', headers: { origin: env.ALLOWED_ORIGIN } }, res);
    assert.equal(res.statusCode, 200); assert.match(JSON.parse(body.toString()).html, /Recipe from Vercel/);
    assert.equal(headers.get('access-control-allow-origin'), env.ALLOWED_ORIGIN);
  } finally { globalThis.fetch = original; }
});
