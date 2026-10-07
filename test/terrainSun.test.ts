import { describe, expect, it } from 'vitest';
import { CIVIL_DUSK_ALT, jstDateKey, sunAltitudeDeg, sunDownTime, sunLines, SUNSET_ALT } from '../src/terrain/sun';

// 日没・薄明（Field Navigation v1 PR4）: 端末の中の計算を国立天文台の暦と比べる。表示・壊れない条件

const hm = (ms: number) => new Date(ms + 9 * 3600000).toISOString().slice(11, 16);
const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

// 国立天文台 暦計算室「日の出入り」2026 年（各地のこよみ）。表は分単位
const NAOJ = [
  { city: '青森', lat: 40.8167, lng: 140.7333, date: '2026-10-01', sunset: '17:20' },
  { city: '青森', lat: 40.8167, lng: 140.7333, date: '2026-10-07', sunset: '17:10' },
  { city: '青森', lat: 40.8167, lng: 140.7333, date: '2026-10-31', sunset: '16:35' },
  { city: '根室', lat: 43.3333, lng: 145.5833, date: '2026-06-21', sunset: '19:02' },
  { city: '根室', lat: 43.3333, lng: 145.5833, date: '2026-10-07', sunset: '16:49' },
  { city: '根室', lat: 43.3333, lng: 145.5833, date: '2026-12-21', sunset: '15:45' },
];

describe('国立天文台の日の入りと比べる（±1 分）', () => {
  it.each(NAOJ)('$city $date の日の入り $sunset', ({ lat, lng, date, sunset }) => {
    const t = sunDownTime(date, lat, lng, SUNSET_ALT)!;
    expect(Math.abs(minutes(hm(t)) - minutes(sunset))).toBeLessThanOrEqual(1);
  });
});

describe('計算の筋', () => {
  it('1. 求めた時刻の太陽の高度が本当に −0.833°（日没）・−6°（薄明終了）', () => {
    const lat = 43.10494, lng = 140.86263; // 初舞茸の地点
    const set = sunDownTime('2026-10-06', lat, lng, SUNSET_ALT)!;
    const dusk = sunDownTime('2026-10-06', lat, lng, CIVIL_DUSK_ALT)!;
    expect(sunAltitudeDeg(set, lat, lng)).toBeCloseTo(SUNSET_ALT, 0);
    expect(sunAltitudeDeg(dusk, lat, lng)).toBeCloseTo(CIVIL_DUSK_ALT, 0);
    expect(dusk - set).toBeGreaterThan(20 * 60000); // 北海道の秋で 25〜30 分ほど
    expect(dusk - set).toBeLessThan(40 * 60000);
  });

  it('2. 日付は日本時間（UTC の日付と違う深夜でも、日本の今日）', () => {
    expect(jstDateKey(Date.parse('2026-10-06T16:30:00Z'))).toBe('2026-10-07');
    expect(jstDateKey(Date.parse('2026-10-06T14:59:00Z'))).toBe('2026-10-06');
  });

  it('3. 一日中沈まない・昇らない（極地）でも壊れず null', () => {
    expect(sunDownTime('2026-06-21', 80, 15, SUNSET_ALT)).toBeNull(); // 白夜
    expect(sunDownTime('2026-12-21', 80, 15, SUNSET_ALT)).toBeNull(); // 極夜
  });
});

describe('表示', () => {
  const lat = 43.10494, lng = 140.86263;
  const set = sunDownTime('2026-10-06', lat, lng, SUNSET_ALT)!;
  const dusk = sunDownTime('2026-10-06', lat, lng, CIVIL_DUSK_ALT)!;

  it('4. 日没前: 「日没 HH:MM　あとH:MM」と「薄明終了 HH:MM」', () => {
    const now = set - (2 * 60 + 14) * 60000 - 30000;
    expect(sunLines(now, lat, lng, 'here')).toEqual({ sunset: `日没 ${hm(set)}　あと2:14`, dusk: `薄明終了 ${hm(dusk)}` });
  });

  it('5. 山域の中心で計算した時は「約」と「（山域基準）」', () => {
    const now = set - 60 * 60000;
    expect(sunLines(now, lat, lng, 'area')).toEqual({ sunset: `日没 約${hm(set)}　あと1:00（山域基準）`, dusk: `薄明終了 約${hm(dusk)}` });
  });

  it('6. 日没後は薄明終了までの残り、薄明の後は「済」', () => {
    expect(sunLines(set + 60000, lat, lng, 'here').sunset).toBe(`日没 ${hm(set)} 済`);
    expect(sunLines(set + 60000, lat, lng, 'here').dusk).toMatch(new RegExp(`^薄明終了 ${hm(dusk)}　あと0:\\d\\d$`));
    expect(sunLines(dusk + 60000, lat, lng, 'here')).toEqual({ sunset: `日没 ${hm(set)} 済`, dusk: `薄明終了 ${hm(dusk)} 済` });
  });

  it('7. 極地の表示も壊れない', () => {
    expect(sunLines(Date.parse('2026-06-21T03:00:00Z'), 80, 15, 'here')).toEqual({ sunset: '今日は日が沈みません', dusk: null });
    expect(sunLines(Date.parse('2026-12-21T03:00:00Z'), 80, 15, 'area')).toEqual({ sunset: '今日は日が昇りません（山域基準）', dusk: null });
  });
});
