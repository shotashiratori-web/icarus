import { describe, expect, it, vi, beforeEach } from 'vitest';

// Photo Asset Architecture v1（Stage 1）。POST /assets → uploadRequired分岐 → PUT → finalize、
// という一連の流れが正しく呼び分けられることを検証する。fetchをglobalでmockし、実ネットワークへは飛ばさない。

function mockFetchSequence(responses: { status: number; body?: unknown }[]) {
  let call = 0;
  global.fetch = vi.fn(async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return () => call;
}

const BASE_INPUT = {
  requestId: 'req-1',
  fileHash: 'a'.repeat(64),
  originalFilename: 'IMG_0001.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 100,
  width: 10,
  height: 10,
  takenAt: null,
  exifGpsLat: null,
  exifGpsLng: null,
};

describe('createUploadAndFinalizeAsset', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('19. uploadRequired=true: presigned URLへPUTし、finalizeまで呼ばれる', async () => {
    const { createUploadAndFinalizeAsset } = await import('../src/api/photoAssetApi');
    const callCount = mockFetchSequence([
      { status: 200, body: { status: 'success', assetId: 'asset-1', assetStatus: 'pending', uploadRequired: true, presignedUploadUrl: 'https://r2.example.com/put', requiredHeaders: { 'Content-Type': 'image/jpeg' } } },
      { status: 200 }, // PUT to R2
      { status: 200, body: { status: 'success', assetId: 'asset-1', assetStatus: 'ready' } }, // finalize
    ]);

    const assetId = await createUploadAndFinalizeAsset(BASE_INPUT, 'AAAA', 'token');
    expect(assetId).toBe('asset-1');
    expect(callCount()).toBe(3); // create + PUT + finalize
  });

  it('20. uploadRequired=false: 既存readyなAssetをそのまま返し、PUT/finalizeは呼ばれない', async () => {
    const { createUploadAndFinalizeAsset } = await import('../src/api/photoAssetApi');
    const callCount = mockFetchSequence([
      { status: 200, body: { status: 'success', assetId: 'asset-existing', assetStatus: 'ready', uploadRequired: false } },
    ]);

    const assetId = await createUploadAndFinalizeAsset(BASE_INPUT, 'AAAA', 'token');
    expect(assetId).toBe('asset-existing');
    expect(callCount()).toBe(1); // createのみ、PUT/finalizeなし
  });

  it('18. Asset draft作成: リクエストボディにfileHash等が正しく含まれる', async () => {
    const { createOrReuseAsset } = await import('../src/api/photoAssetApi');
    let capturedBody: Record<string, unknown> | null = null;
    global.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return {
        status: 200, ok: true,
        json: async () => ({ status: 'success', assetId: 'asset-x', assetStatus: 'pending', uploadRequired: true, presignedUploadUrl: 'https://x', requiredHeaders: {} }),
      } as Response;
    }) as unknown as typeof fetch;

    await createOrReuseAsset(BASE_INPUT, 'token');
    expect(capturedBody).toMatchObject({ requestId: 'req-1', fileHash: 'a'.repeat(64), mimeType: 'image/jpeg' });
  });
});
