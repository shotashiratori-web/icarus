// 地形探索でタップした地点を Google マップで開く（行きたい所を地形で選び、道案内は Google マップに任せる）。
// Google マップの公式 URL（Maps URLs, api=1）。座標は押した時だけ Google に渡る。Icarus には何も保存しない

const fix = (v: number) => v.toFixed(6);

export function coordText(lat: number, lng: number): string {
  return `${fix(lat)},${fix(lng)}`;
}

// その地点にピンを立てて開く
export function googleMapsPinUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordText(lat, lng))}`;
}

// その地点までの経路（出発地は Google マップ側の現在地）
export function googleMapsDirectionsUrl(lat: number, lng: number, mode: 'driving' | 'walking' = 'driving'): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordText(lat, lng))}&travelmode=${mode}`;
}
