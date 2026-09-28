// アプリ本体のオフライン起動（Service Worker）と「更新があります」の判定（Exploration Mode Stage 1、§5-1・§11-1）。
// SW は index をネットワーク優先で返すので、開き直せば最新になる。開いたままの画面だけが古くなりうるため、
// 画面側で新しい版の有無を確かめて知らせる（勝手に再読み込みしない。入力中の下書きを壊さない）

export function registerAppShell(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .catch(() => { /* SW が使えなくてもアプリは通常どおり動く */ });
  });
}

// 本番の index.html を取り直し、読み込んでいる入口の JS と違えば「新しい版がある」
export function entryScriptOf(html: string): string | null {
  const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/) ?? html.match(/<script[^>]+src="([^"]+)"[^>]+type="module"/);
  return m ? m[1] : null;
}

export async function hasNewVersion(): Promise<boolean> {
  const current = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src');
  if (!current || !navigator.onLine) return false;
  try {
    const res = await fetch(`./index.html?check=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const latest = entryScriptOf(await res.text());
    return !!latest && latest !== current;
  } catch {
    return false;
  }
}
