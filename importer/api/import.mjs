// Vercel Node function adapter for the same validated importer.
import worker from '../worker.mjs';
export default async function handler(req, res) {
  try {
    const input = new URL(req.url, 'https://import.local');
    const kind = input.searchParams.get('kind');
    const target = new URL('https://import.local/' + (kind === 'image' ? 'image' : 'page'));
    target.searchParams.set('url', input.searchParams.get('url') || '');
    const response = await worker.fetch(new Request(target, { method: req.method, headers: req.headers }), {
      ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || 'https://romentiy2012-droid.github.io',
      ALLOWED_HOSTS: process.env.ALLOWED_HOSTS || ''
    });
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.statusCode = 500; res.end('Import service failed'); }
}
