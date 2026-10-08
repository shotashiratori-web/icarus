// 国土地理院 標高タイル dem_png → Terrarium 形式（MapLibre の raster-dem が読める形）。3D（PC）で使う。
// 地理院: x = R*65536 + G*256 + B。x < 2^23 なら h = x*0.01、x = 2^23 は無効値（海・欠損）、それ以外は (x - 2^24)*0.01
// 無効値は 0m にする（そのまま使うと針のように立つ）。Terrarium: h = R*256 + G + B/256 - 32768
export function gsiToTerrarium(d: Uint8ClampedArray): void {
  for (let i = 0; i < d.length; i += 4) {
    const x = d[i] * 65536 + d[i + 1] * 256 + d[i + 2];
    const h = x === 8388608 ? 0 : (x < 8388608 ? x : x - 16777216) * 0.01;
    const v = h + 32768;
    d[i] = Math.floor(v / 256);
    d[i + 1] = Math.floor(v) % 256;
    d[i + 2] = Math.floor((v % 1) * 256);
    d[i + 3] = 255;
  }
}

export function terrariumHeight(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

// 3D を出してよい端末: マウス等の細かいポインタ・幅 900px 以上（PC）・WebGL2 がある
export function canShow3D(env: { matchMedia?: (q: string) => { matches: boolean }; webgl2?: boolean }): boolean {
  const pc = !!env.matchMedia?.('(pointer: fine) and (min-width: 900px)').matches;
  return pc && !!env.webgl2;
}
