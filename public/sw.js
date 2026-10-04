/* 서비스 워커: 한 번 연 뒤에는 오프라인에서도 열리게 한다.
   - 페이지(index.html): 네트워크 우선, 실패하면 캐시
   - 해시가 붙은 빌드 자산(assets/*): 캐시 우선(내용이 바뀌면 이름도 바뀜)
   - 그 외 같은 출처 GET: 캐시를 먼저 주고 뒤에서 갱신
   - 외부(폰트 등): 캐시를 먼저 주고 뒤에서 갱신(실패해도 무시) */
const CACHE = 'gtab-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (req.mode === 'navigate' || (same && url.pathname.endsWith('/index.html'))) {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; })
      .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))));
    return;
  }
  if (same && url.pathname.indexOf('/assets/') >= 0) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
