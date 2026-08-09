// 逆ジオコーディング（OpenStreetMap Nominatim）。写真の撮影場所を思い出すための
// 簡易地名表示専用の機能であり、正確な住所管理には使わない。
// 同一座標への再問い合わせを避けるため、モジュール内メモリキャッシュを持つ
// （ページ再読み込みでリセットされる。永続化はしない）
const cache = new Map<string, string | null>();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

// 住所コンポーネントから「市区町村 + 地区/町名」程度の短い地名だけを組み立てる。
// 完全な住所（番地等）は意図的に作らない（情報量を絞るのがこの機能の目的）
function buildShortPlaceLabel(address: Record<string, string | undefined>): string | null {
  const municipality = address.town || address.city || address.county || '';
  const district = address.suburb || address.neighbourhood || address.hamlet || address.city_district || '';
  const parts = [municipality, district].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(' ');
}

// 失敗時（通信エラー・地名なし等）はnullを返す。呼び出し側は地図だけ表示すればよい
export async function reverseGeocodeShortLabel(lat: number, lng: number): Promise<string | null> {
  const key = cacheKey(lat, lng);
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&accept-language=ja`;
    const res = await fetch(url);
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const json = (await res.json()) as { address?: Record<string, string> };
    const label = json.address ? buildShortPlaceLabel(json.address) : null;
    cache.set(key, label);
    return label;
  } catch {
    cache.set(key, null);
    return null;
  }
}
