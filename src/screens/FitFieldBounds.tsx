import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { FieldLogEntry } from '../types/zukan';

type Props = {
  matched: FieldLogEntry[];
  skipFirst?: boolean; // 初回マウント時にfitさせたくない場合（例: 特定地点にフォーカスして開いた直後）
};

export default function FitFieldBounds({ matched, skipFirst = false }: Props) {
  const map = useMap();
  const isFirstRun = useRef(true);

  useEffect(() => {
    // レイアウト確定前（コンテナがまだ0幅/0高さに近い状態）にfitBoundsするとズームがずれるため、
    // 直前に必ずコンテナサイズを再計算させる（Leaflet+動的レイアウトでの既知の対策）
    map.invalidateSize();

    if (isFirstRun.current) {
      isFirstRun.current = false;
      if (skipFirst) return;
    }
    if (matched.length >= 2) {
      const bounds = L.latLngBounds(matched.map((e) => [e.lat, e.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [50, 60], maxZoom: 15 });
    } else if (matched.length === 1) {
      map.setView([matched[0].lat, matched[0].lng], 14);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched]);

  return null;
}
