import { previewGpx, sha256Hex, LocalGpxError } from './gpxLocal';
import type { PendingPreview } from './types';

// 過去 YAMAP GPX の一括取り込み（設計 §5・§15）の「送信前の確認一覧」を作る純粋な処理。
// 取り込み自体は 1 件ずつの登録と同じ経路（端末に保存 → 2 段送信）を通す

export interface AreaBounds {
  areaId: string;
  south: number;
  north: number;
  west: number;
  east: number;
}

export type RowState =
  | 'new' // 取り込む
  | 'server' // サーバーに登録済み（同じ SHA-256）
  | 'device' // この端末にすでにある（送信途中など）
  | 'sameFile' // 今回選んだ中に同じファイルがもう 1 つある
  | 'invalid'; // GPX として読めない

export interface ImportRow {
  fileName: string;
  bytes: ArrayBuffer;
  sha256: string;
  preview: PendingPreview | null;
  error: string | null;
  endedAt: string | null;
  areaIds: string[]; // 範囲内のエリア。空 = 範囲外
  state: RowState;
  serverSessionId: string | null;
  nearDuplicateOf: string[]; // 開始・終了が近い／同じ日で範囲がほぼ同じ 別ファイル
}

export const AREA_OUTSIDE_NOTE = '範囲外 — 探索履歴として保存されます。現在の地形探索には表示されません';

export interface ParsedFile {
  fileName: string;
  bytes: ArrayBuffer;
}

function endedAtOf(bytes: ArrayBuffer): string | null {
  const text = new TextDecoder('utf-8').decode(bytes);
  let max: number | null = null;
  for (const m of text.matchAll(/<time>([^<]*)<\/time>/g)) {
    const t = Date.parse(m[1].trim());
    if (Number.isFinite(t)) max = max === null ? t : Math.max(max, t);
  }
  return max === null ? null : new Date(max).toISOString();
}

// 範囲の判定は GPX の範囲（bbox）がエリアに重なるか（サーバーの area_ids と同じ考え方）
export function areasFor(bbox: PendingPreview['bbox'], areas: AreaBounds[]): string[] {
  return areas.filter((a) => !(bbox.north < a.south || bbox.south > a.north || bbox.east < a.west || bbox.west > a.east)).map((a) => a.areaId);
}

export function nearDuplicate(a: ImportRow, b: ImportRow): boolean {
  if (!a.preview || !b.preview) return false;
  if (a.preview.startedAt && b.preview.startedAt && a.endedAt && b.endedAt) {
    const ds = Math.abs(Date.parse(a.preview.startedAt) - Date.parse(b.preview.startedAt));
    const de = Math.abs(Date.parse(a.endedAt) - Date.parse(b.endedAt));
    if (ds <= 5 * 60 * 1000 && de <= 5 * 60 * 1000) return true;
  }
  if (a.preview.exploredOn && a.preview.exploredOn === b.preview.exploredOn) {
    const x = a.preview.bbox, y = b.preview.bbox;
    if (Math.max(Math.abs(x.south - y.south), Math.abs(x.north - y.north), Math.abs(x.west - y.west), Math.abs(x.east - y.east)) < 0.002) return true;
  }
  return false;
}

export async function planImport(
  files: ParsedFile[],
  areas: AreaBounds[],
  lookup: { server: (sha: string) => Promise<string | null>; device: (sha: string) => Promise<boolean> },
): Promise<ImportRow[]> {
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const sha256 = await sha256Hex(f.bytes);
    let preview: PendingPreview | null = null;
    let error: string | null = null;
    try {
      preview = previewGpx(f.bytes);
    } catch (e) {
      error = e instanceof LocalGpxError ? e.message : 'GPX を読めませんでした';
    }
    let state: RowState = 'new';
    let serverSessionId: string | null = null;
    if (error) state = 'invalid';
    else if (seen.has(sha256)) state = 'sameFile';
    else {
      serverSessionId = await lookup.server(sha256);
      if (serverSessionId) state = 'server';
      else if (await lookup.device(sha256)) state = 'device';
    }
    seen.add(sha256);
    rows.push({
      fileName: f.fileName, bytes: f.bytes, sha256, preview, error, endedAt: error ? null : endedAtOf(f.bytes),
      areaIds: preview ? areasFor(preview.bbox, areas) : [], state, serverSessionId, nearDuplicateOf: [],
    });
  }
  for (const a of rows) {
    a.nearDuplicateOf = rows.filter((b) => b !== a && b.sha256 !== a.sha256 && nearDuplicate(a, b)).map((b) => b.fileName);
  }
  return rows.sort((x, y) => (x.preview?.startedAt ?? '').localeCompare(y.preview?.startedAt ?? '') || x.fileName.localeCompare(y.fileName));
}

export interface ImportSummary {
  total: number;
  toImport: number;
  server: number;
  device: number;
  sameFile: number;
  invalid: number;
  nearDuplicates: number;
  inside: number;
  outside: number;
  oldest: string | null;
  newest: string | null;
  distanceKm: number;
  durationH: number;
}

export function summarize(rows: ImportRow[]): ImportSummary {
  const imp = rows.filter((r) => r.state === 'new');
  const dates = imp.map((r) => r.preview?.exploredOn).filter((d): d is string => !!d).sort();
  const dur = imp.reduce((s, r) => s + (r.preview?.startedAt && r.endedAt ? (Date.parse(r.endedAt) - Date.parse(r.preview.startedAt)) / 3600000 : 0), 0);
  return {
    total: rows.length,
    toImport: imp.length,
    server: rows.filter((r) => r.state === 'server').length,
    device: rows.filter((r) => r.state === 'device').length,
    sameFile: rows.filter((r) => r.state === 'sameFile').length,
    invalid: rows.filter((r) => r.state === 'invalid').length,
    nearDuplicates: imp.filter((r) => r.nearDuplicateOf.length > 0).length,
    inside: imp.filter((r) => r.areaIds.length > 0).length,
    outside: imp.filter((r) => r.areaIds.length === 0).length,
    oldest: dates[0] ?? null,
    newest: dates[dates.length - 1] ?? null,
    distanceKm: Math.round(imp.reduce((s, r) => s + (r.preview?.distanceM ?? 0), 0) / 100) / 10,
    durationH: Math.round(dur * 10) / 10,
  };
}
