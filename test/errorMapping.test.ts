import { describe, expect, it } from 'vitest';
import { mapFieldLogD1Error } from '../src/submission/errorMapping';
import { PhotoUploadFailedError } from '../src/api/fieldLogD1Api';

// Stage 1A: unsupported MIME（ASSET_UNSUPPORTED_MIME_TYPE）は再送しても結果が変わらない
// 恒久的失敗のため、Submission Queueの「retryable」区分を正しく分けられているか検証する。
// PhotoUploadFailedError.code === 'ASSET_UNSUPPORTED_MIME_TYPE' のときだけ retryable:false になり、
// それ以外（通信断・5xx等の一時的失敗）は従来どおり retryable:true のままであることが焦点

const CTX = { entity: 'fieldLogD1' as const, payloadId: 'p-1' };

describe('mapFieldLogD1Error: retryable分類', () => {
  it('1. ASSET_UNSUPPORTED_MIME_TYPE: retryable=falseになる', () => {
    const err = new PhotoUploadFailedError('mimeType must be one of: image/jpeg', 'ASSET_UNSUPPORTED_MIME_TYPE');
    const result = mapFieldLogD1Error(err, CTX);
    expect(result.retryable).toBe(false);
    expect(result.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('利用者向けdescriptionにHEIC/MIME/ASSET_UNSUPPORTED_MIME_TYPEといった技術語を含まない', () => {
    const err = new PhotoUploadFailedError('mimeType must be one of: image/jpeg', 'ASSET_UNSUPPORTED_MIME_TYPE');
    const result = mapFieldLogD1Error(err, CTX);
    expect(result.description).not.toMatch(/HEIC|HEIF|MIME|ASSET_UNSUPPORTED_MIME_TYPE/i);
    expect(result.description).toContain('JPEG形式の写真を選択してください');
  });

  it('3. codeなしのPhotoUploadFailedError（通信断相当）: retryable=true維持', () => {
    const err = new PhotoUploadFailedError('通信に失敗しました');
    const result = mapFieldLogD1Error(err, CTX);
    expect(result.retryable).toBe(true);
    expect(result.code).toBe('UPLOAD_FAILED');
  });

  it('4. 5xx相当（codeがASSET_UNSUPPORTED_MIME_TYPE以外）のPhotoUploadFailedError: retryable=true維持', () => {
    const err = new PhotoUploadFailedError('サーバーエラー (HTTP 500)', 'SOME_OTHER_SERVER_CODE');
    const result = mapFieldLogD1Error(err, CTX);
    expect(result.retryable).toBe(true);
    expect(result.code).toBe('UPLOAD_FAILED');
  });

  it('PhotoUploadFailedError以外（通常のNetwork Error）: retryable=true維持（回帰確認）', () => {
    const err = new TypeError('Failed to fetch');
    const result = mapFieldLogD1Error(err, CTX);
    expect(result.retryable).toBe(true);
    expect(result.code).toBe('NETWORK_ERROR');
  });
});
