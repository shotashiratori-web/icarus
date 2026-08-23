import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PhotoUploadFailedError } from '../src/api/fieldLogD1Api';

// Photo Asset Architecture v1（Stage 1）。fieldLogD1Adapterのsubmit()が、
// useR2Asset有無でR2 Asset経路/既存Cloudinary経路を正しく呼び分けることを検証する。
// 実際のfetchは行わず、api/photoAssetApi・api/fieldLogD1Apiをmockする。

const { createUploadAndFinalizeAsset, uploadFieldLogPhoto, submitFieldLogD1 } = vi.hoisted(() => ({
  createUploadAndFinalizeAsset: vi.fn(),
  uploadFieldLogPhoto: vi.fn(),
  submitFieldLogD1: vi.fn(),
}));

vi.mock('../src/api/photoAssetApi', () => ({ createUploadAndFinalizeAsset }));
vi.mock('../src/api/fieldLogD1Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/fieldLogD1Api')>();
  return { ...actual, uploadFieldLogPhoto, submitFieldLogD1 };
});

async function getAdapter() {
  await import('../src/submission/adapters/fieldLogD1Adapter');
  const { getAdapter } = await import('../src/submission/registry');
  return getAdapter('fieldLogD1');
}

const BASE_PAYLOAD = {
  eventId: 'event-1',
  requestId: 'req-1',
  date: '2026-08-01',
  food: 'テスト食材',
  place: '畑',
  memo: '',
  largeCategory: '植物',
  latitude: 43.1,
  longitude: 140.8,
  takenAt: '2026-08-01T00:00:00.000Z',
};

describe('fieldLogD1Adapter.submit', () => {
  beforeEach(() => {
    createUploadAndFinalizeAsset.mockReset();
    uploadFieldLogPhoto.mockReset();
    submitFieldLogD1.mockReset();
    submitFieldLogD1.mockResolvedValue({ eventId: 'event-1', requestId: 'req-1', photoUrl: '', duplicate: false });
  });

  it('17/18. useR2Asset=true: fileHash等がcreateUploadAndFinalizeAssetへそのまま渡る', async () => {
    createUploadAndFinalizeAsset.mockResolvedValue('asset-123');
    const adapter = await getAdapter();

    const payload = {
      ...BASE_PAYLOAD,
      hasPhoto: true,
      useR2Asset: true,
      assetOriginalBase64: 'BASE64ORIGINAL',
      assetFileHash: 'b'.repeat(64),
      assetMimeType: 'image/heic',
      assetSizeBytes: 4200000,
      assetWidth: 3024,
      assetHeight: 4032,
      photoFileName: 'IMG_0002.HEIC',
    };

    await adapter.submit(payload, 'token');

    expect(createUploadAndFinalizeAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        fileHash: 'b'.repeat(64),
        mimeType: 'image/heic',
        sizeBytes: 4200000,
        width: 3024,
        height: 4032,
        originalFilename: 'IMG_0002.HEIC',
      }),
      'BASE64ORIGINAL',
      'token',
    );
  });

  it('21. useR2Asset=true: submitFieldLogD1がassetId付き・photoUrl=空で呼ばれ、assetOriginalBase64はクリアされる', async () => {
    createUploadAndFinalizeAsset.mockResolvedValue('asset-123');
    const adapter = await getAdapter();

    const payload: Record<string, unknown> = {
      ...BASE_PAYLOAD,
      hasPhoto: true,
      useR2Asset: true,
      assetOriginalBase64: 'BASE64ORIGINAL',
      assetFileHash: 'c'.repeat(64),
      assetMimeType: 'image/jpeg',
    };

    await adapter.submit(payload, 'token');

    expect(submitFieldLogD1).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'asset-123', photoUrl: '' }),
      'token',
    );
    expect(payload.assetId).toBe('asset-123');
    expect(payload.assetOriginalBase64).toBeUndefined(); // 再送時に再アップロードしないための冪等クリア
    expect(uploadFieldLogPhoto).not.toHaveBeenCalled();
  });

  it('同じpayloadでsubmitを2回呼んでも、assetIdが既にあれば再アップロードしない（冪等性）', async () => {
    createUploadAndFinalizeAsset.mockResolvedValue('asset-123');
    const adapter = await getAdapter();

    const payload: Record<string, unknown> = {
      ...BASE_PAYLOAD,
      hasPhoto: true,
      useR2Asset: true,
      assetOriginalBase64: 'BASE64ORIGINAL',
      assetFileHash: 'd'.repeat(64),
      assetMimeType: 'image/jpeg',
    };

    await adapter.submit(payload, 'token'); // 1回目: assetId確定
    submitFieldLogD1.mockRejectedValueOnce(new Error('network error')); // D1側は失敗（再送想定）
    await adapter.submit(payload, 'token').catch(() => {}); // 2回目: assetIdがあるので再アップロードしない

    expect(createUploadAndFinalizeAsset).toHaveBeenCalledTimes(1);
  });

  it('22. 旧Cloudinary分岐回帰: useR2Asset=falseなら既存のuploadFieldLogPhoto経路がそのまま動く', async () => {
    uploadFieldLogPhoto.mockResolvedValue('https://res.cloudinary.com/dpawe0o5p/image/upload/v1/icarus-field-log/x.jpg');
    const adapter = await getAdapter();

    const payload: Record<string, unknown> = {
      ...BASE_PAYLOAD,
      hasPhoto: true,
      useR2Asset: false,
      photoBase64: 'RESIZEDJPEGBASE64',
      photoFileName: 'photo.jpg',
    };

    await adapter.submit(payload, 'token');

    expect(uploadFieldLogPhoto).toHaveBeenCalledWith('RESIZEDJPEGBASE64', 'photo.jpg', 'token');
    expect(createUploadAndFinalizeAsset).not.toHaveBeenCalled();
    expect(submitFieldLogD1).toHaveBeenCalledWith(
      expect.objectContaining({ photoUrl: 'https://res.cloudinary.com/dpawe0o5p/image/upload/v1/icarus-field-log/x.jpg', assetId: undefined }),
      'token',
    );
  });

  // Stage 1A: unsupported MIME（ASSET_UNSUPPORTED_MIME_TYPE）のretry分類修正に伴う回帰確認。
  // 「HEICを勝手にJPEG変換しない」「HEICをCloudinaryへ自動fallbackしない」という
  // Photo Asset Architecture本体の原則（監査済み）を、エラー分類の変更後も壊していないことを確認する
  it('6/7. useR2Asset=trueでcreateUploadAndFinalizeAssetがASSET_UNSUPPORTED_MIME_TYPEで失敗しても、HEIC→JPEG変換もCloudinary自動fallbackも行わずそのままthrowする', async () => {
    const apiError = new PhotoUploadFailedError(
      'mimeType must be one of: image/jpeg',
      'ASSET_UNSUPPORTED_MIME_TYPE',
    );
    createUploadAndFinalizeAsset.mockRejectedValue(apiError);
    const adapter = await getAdapter();

    const payload: Record<string, unknown> = {
      ...BASE_PAYLOAD,
      hasPhoto: true,
      useR2Asset: true,
      assetOriginalBase64: 'BASE64ORIGINAL_HEIC_BYTES',
      assetFileHash: 'e'.repeat(64),
      assetMimeType: 'image/heic',
      photoFileName: 'IMG_9999.HEIC',
    };

    await expect(adapter.submit(payload, 'token')).rejects.toBe(apiError);

    // createUploadAndFinalizeAssetへ渡した元mimeType/originalBase64がそのまま（HEICのまま）であること
    expect(createUploadAndFinalizeAsset).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/heic', originalFilename: 'IMG_9999.HEIC' }),
      'BASE64ORIGINAL_HEIC_BYTES',
      'token',
    );
    // 失敗後にCloudinary経路（uploadFieldLogPhoto）へ自動fallbackしていないこと
    expect(uploadFieldLogPhoto).not.toHaveBeenCalled();
    // D1保存（submitFieldLogD1）まで到達していないこと（assetが失敗した時点で止まる）
    expect(submitFieldLogD1).not.toHaveBeenCalled();
    // 呼び出し元がpayload.assetOriginalBase64を失敗後に別のJPEGへ差し替えていないこと（変換していないことの確認）
    expect(payload.assetOriginalBase64).toBe('BASE64ORIGINAL_HEIC_BYTES');
    expect(payload.assetMimeType).toBe('image/heic');
  });
});
