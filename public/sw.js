/* 스테이프라이스 서비스 워커 — 앱 셸 캐시 (해시된 에셋은 캐시 우선, 페이지는 네트워크 우선) */
const CACHE = 'stayprice-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  if (url.pathname.startsWith('/assets/')) {
    // 파일명에 해시가 있어 불변 — 캐시 우선
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(e.request)
        if (hit) return hit
        const res = await fetch(e.request)
        if (res.ok) c.put(e.request, res.clone())
        return res
      }),
    )
  } else if (e.request.mode === 'navigate') {
    // 페이지는 항상 최신 우선, 오프라인일 때만 캐시 폴백
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/')),
    )
  }
})
