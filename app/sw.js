/* 木案工作台 Service Worker：HTML 用网络优先（保证更新能到达），静态资源缓存优先；
   Supabase 的 /rest /auth 请求一律不拦截。改动本文件请同时更新 SW_VER。 */
const SW_VER = 'muan-v26';
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SW_VER).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== SW_VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;
  if (u.pathname.startsWith('/rest/') || u.pathname.startsWith('/auth/')) return;

  // 页面导航：网络优先，断网回落缓存
  if (req.mode === 'navigate' || u.pathname === '/' || u.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const cp = r.clone();
          caches.open(SW_VER).then((c) => c.put(req, cp));
          return r;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((h) => h || caches.match('/index.html'))
        )
    );
    return;
  }

  // 其它静态资源：缓存优先
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((r) => {
          const cp = r.clone();
          caches.open(SW_VER).then((c) => c.put(req, cp));
          return r;
        })
    )
  );
});
