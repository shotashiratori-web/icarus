import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CandidateGpxError, closeCandidateStoreForTest, deleteCandidateSet, importCandidateGpx, listCandidateSets, parseCandidateGpx, setCandidateSetVisible,
} from '../src/exploration/candidatePins';

// 予測地点（検証候補）ピン v1（icarus_field_candidate_pins_v1_design.md）: GPX の目印だけを読み、この端末だけに保存する

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Icarus Old-Growth Audit" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>登りやすい予測樹冠（未確認）2026-10-13</name></metadata>
  <wpt lat="43.150132" lon="140.894545"><name>E01-3003 34m</name><desc>予測・未確認。樹冠高 34m</desc><sym>Flag</sym></wpt>
  <wpt lat="43.160338" lon="140.893772"><name>E04-3002 28m</name><desc>予測・未確認</desc></wpt>
  <wpt lat="999" lon="140.9"><name>壊れた座標</name></wpt>
  <trk><name>歩いた線</name><trkseg><trkpt lat="43.1" lon="140.8"><time>2026-10-10T00:00:00Z</time></trkpt></trkseg></trk>
</gpx>`;

afterEach(async () => { await closeCandidateStoreForTest(); indexedDB.deleteDatabase('icarus-candidate-pins'); });

describe('予測地点の GPX を読む', () => {
  it('目印（wpt）だけを読む。歩いた線（trk）・壊れた座標は読まない。名前・説明・題名', () => {
    const r = parseCandidateGpx(GPX);
    expect(r.title).toBe('登りやすい予測樹冠（未確認）2026-10-13');
    expect(r.pins).toEqual([
      { name: 'E01-3003 34m', desc: '予測・未確認。樹冠高 34m', lat: 43.150132, lng: 140.894545 },
      { name: 'E04-3002 28m', desc: '予測・未確認', lat: 43.160338, lng: 140.893772 },
    ]);
  });
  it('目印の無い GPX（歩いた記録だけ）・GPX でないものは読み込まない', () => {
    const trkOnly = '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="43" lon="140"/></trkseg></trk></gpx>';
    expect(() => parseCandidateGpx(trkOnly)).toThrow(CandidateGpxError);
    expect(() => parseCandidateGpx(trkOnly)).toThrow('GPX を記録');
    expect(() => parseCandidateGpx('<html></html>')).toThrow('GPX ではありません');
  });
});

describe('端末だけに保存', () => {
  it('同じファイルは二重に作らない。表示の ON/OFF。消すのは明示した時だけ', async () => {
    const a = await importCandidateGpx('easy.gpx', GPX);
    expect(a.existing).toBe(false);
    expect(a.set).toMatchObject({ fileName: 'easy.gpx', visible: true });
    expect((await importCandidateGpx('easy-copy.gpx', GPX)).existing).toBe(true);
    expect(await listCandidateSets()).toHaveLength(1);
    await setCandidateSetVisible(a.set.id, false);
    expect((await listCandidateSets())[0].visible).toBe(false);
    await deleteCandidateSet(a.set.id);
    expect(await listCandidateSets()).toEqual([]);
  });
});

describe('一覧の 2 行目', () => {
  it('「予測・未確認」の次の文（樹冠高など）を出す', async () => {
    const { pinSummary } = await import('../src/exploration/candidatePins');
    expect(pinSummary('予測・未確認（登りやすい候補）。樹冠高 34m（周り半径100mの中央値より +11m）。傾斜 9°')).toBe('樹冠高 34m（周り半径100mの中央値より +11m）');
    expect(pinSummary('林道の入口')).toBe('林道の入口');
    expect(pinSummary('')).toBe('');
  });
});

describe('樹冠高の高い順に並べる', () => {
  it('説明の「樹冠高 ○m」→ 無ければ名前の「○m」。高い順、同じ高さは GPX の順、高さ不明は最後', async () => {
    const { pinHeightM, sortPins } = await import('../src/exploration/candidatePins');
    const pin = (name: string, desc = '') => ({ name, desc, lat: 43, lng: 140 });
    expect(pinHeightM(pin('E01-3003 34m', '予測・未確認。樹冠高 34m（周り…より +11m）'))).toBe(34);
    expect(pinHeightM(pin('Q01 22m +11 道0m 14°'))).toBe(22);
    expect(pinHeightM(pin('P01-3018 28m'))).toBe(28);
    expect(pinHeightM(pin('林道の入口', '道から 50m'))).toBeNull();
    const pins = [pin('A 22m'), pin('入口'), pin('B 30m'), pin('C 22m'), pin('D', '樹冠高 26m')];
    expect(sortPins(pins, 'height').map((p) => p.name)).toEqual(['B 30m', 'D', 'A 22m', 'C 22m', '入口']);
    expect(sortPins(pins, 'file')).toBe(pins);
  });
});

describe('スタッフ共有（v2）: 共有版を端末に保存し直す', () => {
  it('表示する／しないは端末の値を残す・同じ id は 1 組・アーカイブされた共有版は外す・この端末だけの組は触らない', async () => {
    const { mergeSharedCandidateSets } = await import('../src/exploration/candidatePins');
    const local = (await importCandidateGpx('local.gpx', GPX)).set; // この端末だけ
    const other = GPX.replace('登りやすい予測樹冠', '別の組');
    const mine = (await importCandidateGpx('mine.gpx', other)).set;
    await setCandidateSetVisible(mine.id, false);
    const item = (id: string, title: string) => ({ id, title, fileName: 'x.gpx', pins: mine.pins, createdByName: '翔大', createdAt: '2026-10-13T00:00:00Z', canArchive: true });
    // mine を共有した後の一覧（同じ id）＋ 他の人の組
    await mergeSharedCandidateSets([item(mine.id, '別の組'), item('f'.repeat(64), '他の人の組')]);
    let sets = await listCandidateSets();
    expect(sets).toHaveLength(3);
    const m = sets.find((s) => s.id === mine.id)!;
    expect(m.visible).toBe(false);
    expect(m.shared).toMatchObject({ createdByName: '翔大', canArchive: true });
    expect(sets.find((s) => s.id === local.id)!.shared ?? null).toBeNull();
    // 他の人の組がアーカイブされた → 端末からも外れる。この端末だけの組は残る
    await mergeSharedCandidateSets([item(mine.id, '別の組')]);
    sets = await listCandidateSets();
    expect(sets.map((s) => s.id).sort()).toEqual([local.id, mine.id].sort());
  });
});

describe('地図のラベル用の短い名前', () => {
  it('候補 ID ＋樹冠高まで。道からの距離・傾斜は出さない。高さが無い名前は ID だけ（長ければ省略）', async () => {
    const { shortPinLabel } = await import('../src/exploration/candidatePins');
    expect(shortPinLabel('V02 37m 道125m 24°')).toBe('V02 37m');
    expect(shortPinLabel('Q05 24m +11 道42m 20°')).toBe('Q05 24m');
    expect(shortPinLabel('P01-3018 28m')).toBe('P01-3018 28m');
    expect(shortPinLabel('林道の入口')).toBe('林道の入口');
    expect(shortPinLabel('とても長い名前の目印のテスト用')).toBe('とても長い名前の目印のテス…');
  });
});

describe('予測地点を探す', () => {
  it('名前・説明から、全部の組（表示していない組も）で探す。全角・大小は区別しない。空白は AND', async () => {
    const { searchPins } = await import('../src/exploration/candidatePins');
    const pin = (name: string, desc = '') => ({ name, desc, lat: 43, lng: 140 });
    const sets = [
      { id: 'a', fileName: 'a', title: 'A', importedAt: '', visible: true, pins: [pin('Q05 24m +11 道42m 20°', '林分 石狩署 3047_林班_い'), pin('Q01 22m')] },
      { id: 'b', fileName: 'b', title: 'B', importedAt: '', visible: false, pins: [pin('L04 36m', '林分 石狩署 3284_林班_い_2')] },
    ];
    expect(searchPins(sets, 'q05').map((h) => h.pin.name)).toEqual(['Q05 24m +11 道42m 20°']);
    expect(searchPins(sets, 'Ｌ０４').map((h) => h.set.id)).toEqual(['b']);
    expect(searchPins(sets, '3284').length).toBe(1);
    expect(searchPins(sets, 'q 24m').map((h) => h.pin.name)).toEqual(['Q05 24m +11 道42m 20°']);
    expect(searchPins(sets, '  ')).toEqual([]);
    expect(searchPins(sets, 'zzz')).toEqual([]);
  });
});
