export interface FieldLogEntry {
  id: string; // 仮ID（date+lat+lngから生成）。将来、正式なIDに置き換える前提の暫定キー
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
  };
}

export interface FieldLogGeoJson {
  type: 'FeatureCollection';
  features: FieldLogGeoJsonFeature[];
}

export function buildFieldLogId(date: string, lat: number, lng: number): string {
  return `${date}_${lat.toFixed(6)}_${lng.toFixed(6)}`;
}
