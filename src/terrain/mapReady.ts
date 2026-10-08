// 3D の地図の切り替え（背景・高さの強調・水の層）を、スタイルを読み終えた後ならすぐ反映する。
// isStyleLoaded() はタイルの読み込み中にも false になり、'load' は一度しか来ないので、それを待つと切り替えが効かなくなる
interface LoadEvents { once(type: 'load', fn: () => void): unknown }

const ready = new WeakSet<object>();

export function markReadyOnLoad(map: LoadEvents): void {
  map.once('load', () => ready.add(map));
}

export function whenReady(map: LoadEvents, fn: () => void): void {
  if (ready.has(map)) fn(); else map.once('load', fn);
}
