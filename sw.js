const CACHE_NAME = 'recipes-v4';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './kitchen.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];
const NETWORK_TIMEOUT = 4000;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // один недоступный файл не должен ломать всю установку
      Promise.all(ASSETS.map(a => cache.add(a).catch(err => console.warn('SW cache miss:', a, err))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: свежие файлы, если сеть есть; кэш — если её нет или она тупит
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const target = req.mode === 'navigate' ? req.url : req;
    const res = await Promise.race([
      fetch(target, { cache: 'no-cache' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NETWORK_TIMEOUT))
    ]);
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(networkFirst(req));
});
