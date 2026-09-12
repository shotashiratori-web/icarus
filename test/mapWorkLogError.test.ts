import { describe, expect, it } from 'vitest';
import { mapWorkLogError } from '../src/submission/errorMapping';
import { WorkProcessingError, NetworkUnknownError } from '../src/api/workApi';
import { TokenExpiredError } from '../src/api/icarusApi';

// Work Log Submission Framework Final Design ①。GAS（handleIcarusWorkRequest_）は
// REQUEST_PROCESSING以外のエラーをすべて{status:'error', message}という同一shapeで返し、
// codeで区別できない。確実に判別できる範囲（通信断・応答不正・処理中・認証切れ）だけを
// retryable:trueとし、それ以外（GASのロジックエラー全般）はデフォルトでretryable:falseとする
// （安全側に倒す。誤判定してもPending Listからの個別「再送」までは禁止されない）

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

  it('GAS Web App自体の不安定性（res.json()失敗相当のHTTPエラー）: retryable=true', () => {
    const err = new Error('サーバーエラー (HTTP 502)');
    const result = mapWorkLogError(err, CTX);
    expect(result.retryable).toBe(true);
  });

  it('append先workId不存在（GASのロジックエラー、codeなし）: retryable=false', () => {
    const err = new Error('作業IDが見つかりません: 20260101-999');
    const result = mapWorkLogError(err, CTX);
    expect(result.retryable).toBe(false);
  });

  it('validationエラー（タイトル未入力等、codeなし）: retryable=false', () => {
    const err = new Error('タイトルは必須です');
    const result = mapWorkLogError(err, CTX);
    expect(result.retryable).toBe(false);
  });

  it('分類不能な例外（Errorインスタンスですらない）: retryable=false（安全側）', () => {
    const result = mapWorkLogError('some non-Error throw', CTX);
    expect(result.retryable).toBe(false);
  });
});
