import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import styles from './ExplorationMap.module.css';

// 現在地に重ねる「向いている方向」の扇形（視野 約 60°、北が上の地図のまま）。Field Navigation v1 PR2。
// 向きはセンサーの値が来るたびに onReady で渡した要素の CSS（rotate）だけを変える（React で描き直さない）
export interface ConeElements {
  root: HTMLElement;
  wedge: HTMLElement;
  label: HTMLElement;
}

// 扇形: 頂点が中心、上（北）向き、半角 30°、半径 58（SVG の座標）
const WEDGE = 'M0 0 L-29 -50 A58 58 0 0 1 29 -50 Z';

export default function FacingCone({ pos, onReady }: { pos: [number, number]; onReady: (el: ConeElements | null) => void }) {
  const map = useMap();
  const marker = useRef<L.Marker | null>(null);
  useEffect(() => {
    const html = `<div class="${styles.cone}"><div class="${styles.coneWedge}"><svg viewBox="-60 -60 120 120" width="120" height="120" aria-hidden="true"><path d="${WEDGE}"/></svg></div><span class="${styles.coneLabel}">向きを取得中…</span></div>`;
    const m = L.marker(pos, {
      icon: L.divIcon({ className: '', html, iconSize: [120, 120], iconAnchor: [60, 60] }),
      interactive: false, keyboard: false, zIndexOffset: -1000,
    }).addTo(map);
    marker.current = m;
    const el = m.getElement();
    const root = el?.querySelector<HTMLElement>(`.${styles.cone}`);
    const wedge = el?.querySelector<HTMLElement>(`.${styles.coneWedge}`);
    const label = el?.querySelector<HTMLElement>(`.${styles.coneLabel}`);
    onReady(root && wedge && label ? { root, wedge, label } : null);
    return () => {
      onReady(null);
      m.remove();
      marker.current = null;
    };
    // 位置は下の effect で動かす（ここで作り直さない）
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    marker.current?.setLatLng(pos);
  }, [pos[0], pos[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
