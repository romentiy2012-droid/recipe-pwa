// Deploy with: npx wrangler deploy --config importer/wrangler.toml
const DEFAULT_HOSTS = ['1000.menu', 'povarenok.ru', 'russianfood.com', 'food.ru', 'eda.ru', 'edimdoma.ru', 'allrecipes.com', 'bbcgoodfood.com', 'recipetineats.com', 'seriouseats.com', 'simplyrecipes.com'];
export function allowedURL(raw, allowedHosts) {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !allowedHosts.some(h => host === h || host.endsWith('.' + h))) throw new Error('Этот сайт не разрешён для импорта. Добавь его домен в ALLOWED_HOSTS обработчика.');
  return u;
}
export async function limitedBody(response, max) {
  if (Number(response.headers.get('content-length')) > max) throw new Error('Файл слишком большой');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) throw new Error('Файл слишком большой'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin'), allowedOrigin = env.ALLOWED_ORIGIN;
    if (!allowedOrigin || origin !== allowedOrigin) return new Response('Origin not allowed', { status: 403 });
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Vary': 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers });
    const route = new URL(request.url);
    if (!['/page', '/image'].includes(route.pathname)) return new Response('Not found', { status: 404, headers });
    try {
      const hosts = (env.ALLOWED_HOSTS ? env.ALLOWED_HOSTS.split(',').map(h => h.trim().toLowerCase()).filter(Boolean) : DEFAULT_HOSTS);
      let target = allowedURL(route.searchParams.get('url'), hosts), response;
      const signal = AbortSignal.timeout(12000);
      for (let redirects = 0; redirects <= 3; redirects++) {
        response = await fetch(target.href, { redirect: 'manual', headers: { Accept: route.pathname === '/image' ? 'image/*' : 'text/html,application/xhtml+xml' }, signal });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        if (redirects === 3) throw new Error('Слишком много перенаправлений');
        const location = response.headers.get('location'); if (!location) throw new Error('Неизвестный адрес перенаправления');
        await response.body?.cancel(); target = allowedURL(new URL(location, target).href, hosts);
      }
      if (!response.ok) throw new Error('Сайт ответил: ' + response.status);
      const type = response.headers.get('content-type') || '';
      if (route.pathname === '/image') {
        // No SVG or executable documents are proxied as images.
        if (!/^image\/(jpeg|png|webp|gif)(?:;|$)/i.test(type)) throw new Error('Неподдерживаемое изображение');
        const body = await limitedBody(response, 5 * 1024 * 1024);
        return new Response(body, { headers: { ...headers, 'Content-Type': type } });
      }
      if (!/(?:text\/html|application\/xhtml\+xml)/i.test(type)) throw new Error('Адрес не содержит HTML-страницу');
      const bytes = await limitedBody(response, 3 * 1024 * 1024);
      let charset = type.match(/charset=([^;\s]+)/i)?.[1]?.replace(/["']/g, '');
      if (!charset) charset = new TextDecoder('latin1').decode(bytes.slice(0, 4096)).match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1] || 'utf-8';
      let html; try { html = new TextDecoder(charset).decode(bytes); } catch { html = new TextDecoder().decode(bytes); }
      return Response.json({ html, url: target.href }, { headers });
    } catch (err) { return Response.json({ error: err.message || 'Ошибка импорта' }, { status: 422, headers }); }
  }
};
