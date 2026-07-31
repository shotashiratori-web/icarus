export interface FieldLogEntry {
  id: string; // 仮ID（recordedAt+date+lat+lngから生成）。将来、正式なIDに置き換える前提の暫定キー
  foodName: string;
  place: string;
  date: string;
  memo: string;
  photoUrl: string;
  notionUrl: string;
  elevation: number | null;
  kigo: string;
  lat: number;
  lng: number;
  recordedAt: string; // Icarusへ登録された日時（撮影日時=dateとは別。追加順ソート用）
  eventId: string; // Sheetsの行を一意に特定するキー（重複検知・削除で使用）。古いレコードでは空の場合がある
  takenAt: string; // 撮影日時（秒単位）。dateは日付単位に丸めているため重複検知にはこちらを使う
}

interface FieldLogGeoJsonFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    foodName: string;
    place: string;
    date: string;
    memo: string;
    photoUrl: string;
    notionUrl: string;
    elevation: number | null;
    kigo: string;
    recordedAt?: string;
    eventId?: string;
    takenAt?: string;
  };
}

export interface FieldLogGeoJson {
  type: 'FeatureCollection';
  features: FieldLogGeoJsonFeature[];
}

// date+lat+lngだけでは、同じ日付・同じ地点で複数回記録した場合にIDが衝突する
// （実際に286件中20組で衝突し、並び替え時のReact keyの衝突→再描画不具合の原因になっていた）。
// recordedAtは登録ごとに一意（秒単位）なので、あれば付加して衝突を防ぐ
export function buildFieldLogId(date: string, lat: number, lng: number, recordedAt?: string): string {
  const base = `${date}_${lat.toFixed(6)}_${lng.toFixed(6)}`;
  return recordedAt ? `${base}_${recordedAt}` : base;
}
