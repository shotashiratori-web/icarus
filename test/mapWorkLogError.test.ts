import { describe, expect, it } from 'vitest';
import { mapWorkLogError } from '../src/submission/errorMapping';
import { WorkProcessingError, NetworkUnknownError, WorkServerError } from '../src/api/workApi';
import { TokenExpiredError } from '../src/api/icarusApi';

// Work Log Submission Framework Final Design ①、および2026-09-13の本番golden path実機確認で
// 発見した実バグの修正。当初はメッセージ文字列のパターンマッチでretryableを判定していたが、
// icarus-api（/work）のWorker⇔GAS間通信失敗（502、"GAS returned non-JSON"等）が実際の本番では
// 想定と異なる文言で返ってきて誤ってnon-retryableに分類された。
// 以後はWorkServerError.status（Workerが返す実際のHTTP status）で判定する：
// - 502等5xx: Worker⇔GAS間、またはCloudflareエッジ自体の一時的な不調 → retryable:true
// - 500未満（Workerのrequest validation等）: 安全側でretryable:false
// GAS自身が返す{status:'error'}（validation・workId不存在等）はWorker側で500として中継されるため、
// codeを持たないGASのロジックエラー全般もretryable:falseのまま——「retryしても直らない前提」を
// 安全側に倒す方針そのものは変えていない

const CTX = { entity: 'workLog' as const, payloadId: 'req-1' };

describe('mapWorkLogError: retryable分類', () => {
  it('NetworkUnknownError（fetch自体の失敗）: retryable=true', () => {
    const result = mapWorkLogError(new NetworkUnknownError(), CTX);
    expect(result.retryable).toBe(true);
    expect(result.code).toBe('NETWORK_ERROR');
  });

  it('WorkProcessingError（GAS側REQUEST_PROCESSING）: retryable=true', () => {
    const result = mapWorkLogError(new WorkProcessingError('処理中です。しばらくしてから再度お試しください。'), CTX);
    expect(result.retryable).toBe(true);
  });

  it('TokenExpiredError: retryable=true（再ログインで解決するため）', () => {
    const result = mapWorkLogError(new TokenExpiredError('セッション切れ'), CTX);
    expect(result.retryable).toBe(true);
    expect(result.code).toBe('AUTH_EXPIRED');
  });

  it('WorkServerError status=502（Worker⇔GAS間の通信/応答不良）: retryable=true', () => {
    const err = new WorkServerError('GAS returned non-JSON (HTTP ok): <!DOCTYPE html>...', 502);
    const result = mapWorkLogError(err, CTX);
    expect(result.retryable).toBe(true);
  });

  it('WorkServerError status=500（GAS自身のロジックエラー、append先workId不存在等）: retryable=false', () => {
    const err = new WorkServerError('作業IDが見つかりません: 20260101-999', 500);
    const result = mapWorkLogError(err, CTX);
    expect(result.retryable).toBe(false);
  });

  it('WorkServerError status=400（Workerのrequest validation）: retryable=false', () => {
    const err = new WorkServerError('title is required', 400);
    const result = mapWorkLogError(err, CTX);
    expect(result.retryable).toBe(false);
  });

  it('非JSON応答（Cloudflareエッジ自体の不調相当）でもstatusが5xxならretryable=true', () => {
    const err = new WorkServerError('非JSON応答 (HTTP 524)', 524);
    const result = mapWorkLogError(err, CTX);
    expect(result.retryable).toBe(true);
  });

  it('WorkServerError以外のError（想定外の例外）: retryable=false（安全側）', () => {
    const err = new Error('予期しないエラー');
    const result = mapWorkLogError(err, CTX);
    expect(result.retryable).toBe(false);
  });

  it('分類不能な例外（Errorインスタンスですらない）: retryable=false（安全側）', () => {
    const result = mapWorkLogError('some non-Error throw', CTX);
    expect(result.retryable).toBe(false);
  });
});
