import { useMemo, useState } from 'react';
import { Marker, Pane, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import {
  CONTOUR_STYLE, LABEL_MIN_ZOOM, MAJOR_MIN_ZOOM, MINOR_MIN_ZOOM, minorOpacity, pickContourLabels, type Contours,
} from '../../terrain/contours';
import styles from './ExplorationMap.module.css';

// 等高線（主曲線 10m・計曲線 50m）。道・探索履歴より下に描く（canvas の描画順で一番後ろへ）。
// 標高ラベルは拡大時だけ、計曲線にだけ、画面上で重ならないよう間引いて出す

const toBack = { add: (e: L.LeafletEvent) => (e.target as L.Path).bringToBack() };

export default function ContourLayer({ contours }: { contours: Contours }) {
  const map = useMap();
  const [view, setView] = useState(() => ({ zoom: map.getZoom(), tick: 0 }));
  useMapEvents({
    zoomend: () => setView((v) => ({ zoom: map.getZoom(), tick: v.tick + 1 })),
    moveend: () => setView((v) => ({ zoom: map.getZoom(), tick: v.tick + 1 })),
  });

  const labels = useMemo(() => {
    if (view.zoom < LABEL_MIN_ZOOM) return [];
    const size = map.getSize();
    const b = map.getBounds().pad(0.05);
    const visible = contours.majorLines.filter((l) => l.p.some(([la, ln]) => b.contains([la, ln])));
    return pickContourLabels(visible, (la, ln) => map.latLngToContainerPoint([la, ln]), { width: size.x, height: size.y });
    // view.tick: 動かしたら取り直す
  }, [contours, map, view.zoom, view.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {view.zoom >= MINOR_MIN_ZOOM && (
        <Polyline
          positions={contours.minor}
          pathOptions={{ color: CONTOUR_STYLE.color, weight: CONTOUR_STYLE.minor.weight, opacity: minorOpacity(view.zoom), interactive: false }}
          eventHandlers={toBack}
        />
      )}
      {view.zoom >= MAJOR_MIN_ZOOM && (
        <Polyline
          positions={contours.major}
          pathOptions={{ color: CONTOUR_STYLE.color, ...CONTOUR_STYLE.major, interactive: false }}
          eventHandlers={toBack}
        />
      )}
      {labels.length > 0 && (
        <Pane name="contourLabels" style={{ zIndex: 450, pointerEvents: 'none' }}>
          {labels.map((l, i) => (
            <Marker
              key={`${l.elev}-${l.lat.toFixed(5)}-${l.lng.toFixed(5)}-${i}`}
              position={[l.lat, l.lng]}
              interactive={false}
              keyboard={false}
              icon={L.divIcon({
                className: styles.contourLabel,
                html: `<span style="transform:translate(-50%,-50%) rotate(${l.angle}deg)">${l.elev}</span>`,
                iconSize: [0, 0],
              })}
            />
          ))}
        </Pane>
      )}
    </>
  );
}
