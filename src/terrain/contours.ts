// 等高線（2026-09-29 の版から）。build_area.py が Stage 1 と同じ DEM・同じ格子から作る。外部の地図は使わない。
// contours.json: { format: 'delta-e5', intervalM: 10, indexM: 50, lines: [[標高, lat0×1e5, lng0×1e5, Δlat1, Δlng1, …], …] }

export interface ContourLine {
  elev: number;
  index: boolean; // 計曲線（50m ごと）
  p: [number, number][];
}

export interface Contours {
  intervalM: number;
  indexM: number;
  minor: [number, number][][]; // 主曲線（Leaflet には 1 本の MultiPolyline として渡す）
  major: [number, number][][]; // 計曲線
  majorLines: ContourLine[]; // ラベル用
}

// 表示する縮尺（等高線の間隔が画面で 2〜3px 以上になるところから。急斜面で線がつぶれないように）
export const MINOR_MIN_ZOOM = 14; // 主曲線 10m
export const MAJOR_MIN_ZOOM = 12; // 計曲線 50m
export const LABEL_MIN_ZOOM = 15; // 標高ラベルは拡大時のみ

export const CONTOUR_STYLE = {
  color: '#6f5a48',
  minor: { weight: 0.7, opacity: 0.6 },
  major: { weight: 1.6, opacity: 0.9 },
} as const;

// ズーム 14 では 10m 線が急斜面で密になり、道・候補が読みにくくなるので薄くする
export function minorOpacity(zoom: number): number {
  return zoom >= LABEL_MIN_ZOOM ? CONTOUR_STYLE.minor.opacity : 0.4;
}

interface ContoursJson {
  format: string;
  intervalM: number;
  indexM: number;
  lines: number[][];
}

export function decodeContoursJson(json: ContoursJson): Contours {
  if (json.format !== 'delta-e5') throw new Error(`等高線データの形式に対応していません（${json.format}）`);
  const minor: [number, number][][] = [];
  const major: [number, number][][] = [];
  const majorLines: ContourLine[] = [];
  for (const row of json.lines) {
    const elev = row[0];
    let lat = row[1];
    let lng = row[2];
    const p: [number, number][] = [[lat / 1e5, lng / 1e5]];
    for (let i = 3; i + 1 < row.length; i += 2) {
      lat += row[i];
      lng += row[i + 1];
      p.push([lat / 1e5, lng / 1e5]);
    }
    if (elev % json.indexM === 0) {
      major.push(p);
      majorLines.push({ elev, index: true, p });
    } else minor.push(p);
  }
  return { intervalM: json.intervalM, indexM: json.indexM, minor, major, majorLines };
}

export async function decodeContours(blob: Blob): Promise<Contours> {
  return decodeContoursJson(JSON.parse(await blob.text()) as ContoursJson);
}

export interface ContourLabel {
  lat: number;
  lng: number;
  elev: number;
  angle: number; // 度。文字が逆さにならないよう -90〜90
}

// 画面上の点（Leaflet の latLngToContainerPoint）
type Project = (lat: number, lng: number) => { x: number; y: number };

// 計曲線に沿って、画面上で spacingPx ごとに候補を置き、ほかのラベルと minGapPx 以上離れたものだけ残す。
// 急斜面で計曲線が密なところでは、近いラベルが落ちて自然に間引かれる
export function pickContourLabels(
  lines: ContourLine[],
  project: Project,
  view: { width: number; height: number },
  opts: { spacingPx?: number; minGapPx?: number; margin?: number; max?: number } = {},
): ContourLabel[] {
  const spacing = opts.spacingPx ?? 320;
  const gap = opts.minGapPx ?? 90;
  const margin = opts.margin ?? 24;
  const max = opts.max ?? 80;
  const cell = gap;
  const taken = new Map<string, { x: number; y: number }[]>();
  const near = (x: number, y: number) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const q of taken.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.hypot(q.x - x, q.y - y) < gap) return true;
      }
    }
    return false;
  };
  const out: ContourLabel[] = [];
  const inView = (q: { x: number; y: number }) => q.x >= margin && q.y >= margin && q.x <= view.width - margin && q.y <= view.height - margin;
  for (const l of lines) {
    let run = spacing / 2; // 線の端（画面の端）にラベルが寄らないように半分から
    let prev: { x: number; y: number } | null = null;
    let prevLL: [number, number] = l.p[0];
    for (const [la, ln] of l.p) {
      const q = project(la, ln);
      if (prev && inView(q) && inView(prev)) {
        const seg = Math.hypot(q.x - prev.x, q.y - prev.y);
        run += seg;
        if (run >= spacing && seg > 0) {
          run = 0;
          const x = (q.x + prev.x) / 2;
          const y = (q.y + prev.y) / 2;
          if (!near(x, y)) {
            let angle = (Math.atan2(q.y - prev.y, q.x - prev.x) * 180) / Math.PI;
            if (angle > 90) angle -= 180;
            if (angle < -90) angle += 180;
            const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
            taken.set(k, [...(taken.get(k) ?? []), { x, y }]);
            out.push({ lat: (la + prevLL[0]) / 2, lng: (ln + prevLL[1]) / 2, elev: l.elev, angle: Math.round(angle) });
            if (out.length >= max) return out;
          }
        }
      }
      prev = q;
      prevLL = [la, ln];
    }
  }
  return out;
}
