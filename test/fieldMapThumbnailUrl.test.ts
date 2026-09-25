import { describe, expect, it, vi, beforeEach } from 'vitest';

// Field Map Image Delivery Fix Phase A-1。/field/map-geojsonのthumbnailUrl（幅500px）を
// FieldLogEntryへ受け渡すこと、APIが古くthumbnailUrlを返さない場合も壊れないことを検証する。
// fetchはglobalでmockし、実ネットワークへは飛ばさない。

function mockGeoJson(properties: Record<string, unknown>) {
  global.fetch = vi.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => ({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [140.8, 43.1] },
        properties: {
          foodName: 'ナラタケ', place: 'なな山', date: '2026-09-25', memo: '',
          notionUrl: '', elevation: null, kigo: '未分類',
          recordedAt: '2026-09-25T10:00:00+09:00', eventId: 'ev-1', takenAt: '',
          ...properties,
        },
      }],
    }),
  }) as Response) as unknown as typeof fetch;
}

describe('fetchFieldLogEntries: thumbnailUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. thumbnailUrlがあればそのまま受け渡し、photoUrlは変えない', async () => {
    const { fetchFieldLogEntries } = await import('../src/api/zukanApi');
    mockGeoJson({
      photoUrl: 'https://api.example/assets/a/image?variant=detail',
      thumbnailUrl: 'https://api.example/assets/a/image?variant=thumbnail',
    });

    const [entry] = await fetchFieldLogEntries('token');
    expect(entry.photoUrl).toBe('https://api.example/assets/a/image?variant=detail');
    expect(entry.thumbnailUrl).toBe('https://api.example/assets/a/image?variant=thumbnail');
  });

  it('2. APIがthumbnailUrlを返さない（古いAPI）場合は空文字になり、表示側はphotoUrlへフォールバックできる', async () => {
    const { fetchFieldLogEntries } = await import('../src/api/zukanApi');
    mockGeoJson({ photoUrl: 'https://api.example/assets/a/image?variant=detail' });

    const [entry] = await fetchFieldLogEntries('token');
    expect(entry.thumbnailUrl).toBe('');
    expect(entry.thumbnailUrl || entry.photoUrl).toBe('https://api.example/assets/a/image?variant=detail');
  });
});
