// 離線支援：同網域的頁面與程式檔「網路優先、失敗時用快取」，連過一次網路後就能離線開啟
const CACHE = 'n2-shell-v1';
const SHELL = ['./', 'index.html', 'app.js', 'backend.js', 'style.css', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-512.png'];
const NETWORK_TIMEOUT = 4000; // 飛機上等半連線狀態時不要一直卡住

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT)),
    ]);
    if (res.ok) {
      cache.put(req, res.clone());
      // 建置版的檔名帶 ?v=，另存一份不帶參數的，離線時任何版本號都對得上
      const url = new URL(req.url);
      if (url.search) cache.put(url.origin + url.pathname, res.clone());
    }
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' && ((await cache.match('./')) || (await cache.match('index.html'))));
    if (hit) return hit;
    throw err;
  }
}
