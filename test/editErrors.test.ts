import { describe, expect, it } from 'vitest';
import { throwIfEditError, EditConflictError, EditForbiddenError, EditNotFoundError, EDIT_ERROR_MESSAGES, editErrorMessage } from '../src/api/editErrors';
import { TokenExpiredError } from '../src/api/icarusApi';

// 401 / 403 / 404 / 409 の共通エラー表現

describe('throwIfEditError', () => {
  it('成功なら何もしない', () => {
    expect(() => throwIfEditError(200, { status: 'success' })).not.toThrow();
  });
  it('401 は TokenExpiredError（入力が残る旨の文言）', () => {
    expect(() => throwIfEditError(401, { status: 'error' })).toThrow(TokenExpiredError);
    expect(() => throwIfEditError(401, {})).toThrow(EDIT_ERROR_MESSAGES.unauthorized);
  });
  it('403・404 はサーバーの文言を優先し、無ければ既定の文言', () => {
    expect(() => throwIfEditError(403, { message: '管理者のみ利用できます' })).toThrow(new EditForbiddenError('管理者のみ利用できます'));
    expect(() => throwIfEditError(403, {})).toThrow(EDIT_ERROR_MESSAGES.forbidden);
    expect(() => throwIfEditError(404, {})).toThrow(EditNotFoundError);
  });
  it('409 は EditConflictError。code と最新値（current）を持つ', () => {
    try {
      throwIfEditError<{ content: string }>(409, { status: 'error', code: 'CORRECTION_CONFLICT', message: '競合しました', currentContent: '最新' },
        (j) => ({ content: String(j.currentContent) }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EditConflictError);
      const c = e as EditConflictError<{ content: string }>;
      expect(c.code).toBe('CORRECTION_CONFLICT');
      expect(c.current).toEqual({ content: '最新' });
      expect(c.message).toBe('競合しました');
    }
  });
  it('その他の 4xx/5xx や status=error はサーバーの文言か既定の文言', () => {
    expect(() => throwIfEditError(400, { message: '入力が正しくありません' })).toThrow('入力が正しくありません');
    expect(() => throwIfEditError(200, { status: 'error' })).toThrow(EDIT_ERROR_MESSAGES.unknown);
    expect(editErrorMessage('x')).toBe(EDIT_ERROR_MESSAGES.unknown);
  });
});
