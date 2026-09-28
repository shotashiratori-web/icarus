import { describe, expect, it } from 'vitest';
import { CONTOUR_STYLE, decodeContoursJson, minorOpacity, pickContourLabels, type ContourLine } from '../src/terrain/contours';

// 等高線（2026-09-29）: contours.json の復号と、標高ラベルの間引き

describe('decodeContoursJson', () => {
  it('1. 1e-5 度の差分を戻し、50m ごとは計曲線に分ける', () => {
    const c = decodeContoursJson({
      format: 'delta-e5', intervalM: 10, indexM: 50,
      lines: [
        [10, 4310000, 14080000, 10, -20, 5, 5],
        [50, 4311000, 14081000, 0, 100],
        [250, 4312000, 14082000, -1, 1],
      ],
    });
    expect(c.minor).toEqual([[[43.1, 140.8], [43.1001, 140.7998], [43.10015, 140.79985]]]);
    expect(c.major).toHaveLength(2);
    expect(c.majorLines.map((l) => l.elev)).toEqual([50, 250]);
    expect(c.major[0]).toEqual([[43.11, 140.81], [43.11, 140.811]]);
  });

  it('2. 知らない形式は読まない', () => {
    expect(() => decodeContoursJson({ format: 'x', intervalM: 10, indexM: 50, lines: [] })).toThrow('形式');
  });
});

describe('style', () => {
  it('6. 計曲線は主曲線よりはっきり太い。ズーム 14 の主曲線は薄く', () => {
    expect(CONTOUR_STYLE.major.weight).toBeGreaterThanOrEqual(CONTOUR_STYLE.minor.weight * 2);
    expect(minorOpacity(14)).toBeLessThan(minorOpacity(15));
  });
});

describe('pickContourLabels', () => {
  // 画面座標 = (lng, lat) をそのまま px とみなす
  const project = (la: number, ln: number) => ({ x: ln, y: la });
  const view = { width: 1000, height: 1000 };
  const horizontal = (elev: number, y: number): ContourLine => ({ elev, index: true, p: Array.from({ length: 101 }, (_, i) => [y, i * 10] as [number, number]) });

  it('3. 線に沿って spacing ごとに置き、文字は逆さにしない', () => {
    const labels = pickContourLabels([horizontal(300, 500)], project, view, { spacingPx: 300, margin: 0 });
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(labels.every((l) => l.elev === 300 && l.angle === 0)).toBe(true);
    const rev: ContourLine = { elev: 300, index: true, p: [...horizontal(300, 500).p].reverse() };
    expect(pickContourLabels([rev], project, view, { margin: 0 }).every((l) => Math.abs(l.angle) <= 90)).toBe(true);
  });

  it('4. 急斜面で計曲線が密なところは間引く（近いラベルを落とす）', () => {
    const dense = Array.from({ length: 20 }, (_, i) => horizontal(100 + i * 50, 300 + i * 8)); // 8px ごと
    const sparse = Array.from({ length: 5 }, (_, i) => horizontal(100 + i * 50, 100 + i * 200)); // 200px ごと
    const d = pickContourLabels(dense, project, view, { minGapPx: 90, margin: 0 });
    const s = pickContourLabels(sparse, project, view, { minGapPx: 90, margin: 0 });
    expect(d.length).toBeLessThan(dense.length); // 20 本すべてには付かない
    for (let i = 0; i < d.length; i++) {
      for (let j = i + 1; j < d.length; j++) expect(Math.hypot(d[i].lat - d[j].lat, d[i].lng - d[j].lng)).toBeGreaterThanOrEqual(90);
    }
    expect(new Set(s.map((l) => l.elev)).size).toBe(5); // まばらなら全部の線に付く
  });

  it('5. 画面の外・上限を超える分は出さない', () => {
    expect(pickContourLabels([horizontal(300, 2000)], project, view)).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => horizontal(i * 50, 50 + i * 100));
    expect(pickContourLabels(many, project, view, { max: 4, margin: 0 })).toHaveLength(4);
  });
});
