/*
 * Icarus Service Worker（Exploration Mode Stage 1、2026-09-28）
 * 設計: icarus_mushroom_sansai_exploration_mode_final_design.md §5-1・§11-1
 *
 * 責務は「アプリ本体（shell）を圏外でも起動できるようにする」ことだけ:
 * - 画面（index.html）はネットワーク優先。電波があれば常に最新。取れない時だけ保存済みの版
 * - その版の JS/CSS は asset-manifest.json（ビルド時に出力）の一覧どおりに全部保存する
 *   （遅延読み込みの画面も圏外で開ける）。一覧に無い前の版のファイルは消す（deploy のたびに増えない）
 * - API（icarus-api）・地図タイル・写真など他のオリジンには一切触らない（認証データを SW にためない）
 * - 地形データは SW ではなく、画面の「オフライン保存」で IndexedDB に保存する
 * - 新しい版への切り替えは画面側の「更新があります」から（SW は勝手にページを再読み込みしない）
 */
const SHELL_CACHE = 'icarus-shell-v1';
const INDEX_KEY = './index.html';
const LIST_KEY = './asset-manifest.json';
const NETWORK_TIMEOUT_MS = 4000;

const abs = (path) => new URL(path, self.registration.scope).href;

// 一覧を取り直し、違っていれば全部保存してから前の版を消す（保存に失敗したら消さない）
async function syncAssets() {
  const cache = await caches.open(SHELL_CACHE);
  const res = await fetch(LIST_KEY, { cache: 'no-store' });
  if (!res.ok) return;
  const list = await res.clone().json();
  if (!Array.isArray(list.files)) return;
  const old = await cache.match(LIST_KEY);
  if (old && JSON.stringify((await old.json()).files) === JSON.stringify(list.files)) return;
  const wanted = new Set(list.files.map((f) => abs(f)));
  for (const url of wanted) {
    if (!(await cache.match(url))) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`asset ${url} ${r.status}`);
      await cache.put(url, r);
    }
  }
  await cache.put(LIST_KEY, res);
  for (const req of await cache.keys()) {
    if (req.url.includes('/assets/') && !wanted.has(req.url)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      const res = await fetch('./', { cache: 'no-store' });
      if (res.ok) await cache.put(INDEX_KEY, res);
      await syncAssets();
    } catch {
      /* 圏外でのインストールなど。次に電波がある時に保存する */
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('icarus-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

  // 画面: ネットワーク優先（圏外・遅すぎる時だけ保存済みの index）。取れたら版の一覧も確かめる
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const res = await withTimeout(fetch(req, { cache: 'no-store' }), NETWORK_TIMEOUT_MS);
        if (res.ok) {
          await cache.put(INDEX_KEY, res.clone());
          event.waitUntil(syncAssets().catch(() => undefined));
        }
        return res;
      } catch {
        const cached = await cache.match(INDEX_KEY);
        return cached || new Response('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;padding:24px">圏外のため Icarus を開けません。一度電波のある所で開くと、次からは圏外でも開けます。</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // 問い合わせ付き（更新確認の index.html?check= など）は保存しない
  if (url.search) return;

  // 版の JS/CSS: 保存済みを優先（無ければ取得して保存）
  if (url.pathname.includes('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // manifest・アイコン: ネットワーク優先、圏外なら保存済み
  if (/\/(manifest\.webmanifest|apple-touch-icon\.png|icon-\d+\.png|favicon\.svg)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await cache.match(req);
        if (hit) return hit;
        throw new Error('offline');
      }
    })());
  }
});
