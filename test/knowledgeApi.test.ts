import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveFoodByName, FoodAliasConflictError } from '../src/api/knowledgeApi';

// resolveFoodByName()自体の解決ロジック（canonical優先・confirmed alias exact・conflict時は安全側でthrow）を
// 直接検証する。GET /foods?q=はLIKE検索（曖昧一致）なので、返ってきた候補に対しexact matchを
// 再検証していることが本質的な契約。本番Workerへは通信しない（globalのfetchをmock）
function mockFoodsResponse(items: unknown[]) {
  global.fetch = vi.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ status: 'success', items }),
  }) as unknown as typeof fetch;
}

const 杏 = { id: 'f1', canonicalName: '杏', aliases: ['アンズ'], usableParts: [], description: '', createdAt: '', updatedAt: '', createdBy: '' };

describe('resolveFoodByName', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('14. canonical exactでKnowledge解決できる', async () => {
    mockFoodsResponse([杏]);
    const result = await resolveFoodByName('杏', 'token');
    expect(result?.id).toBe('f1');
  });

  it('15. confirmed alias exactでKnowledge解決できる（Field Log「アンズ」→Food「杏」）', async () => {
    mockFoodsResponse([杏]);
    const result = await resolveFoodByName('アンズ', 'token');
    expect(result?.id).toBe('f1');
  });

  it('16. alias conflict時はFoodAliasConflictErrorをthrowし、誤ったFoodへ解決しない', async () => {
    mockFoodsResponse([
      { ...杏, id: 'f1', canonicalName: '食材A', aliases: ['同名'] },
      { ...杏, id: 'f2', canonicalName: '食材B', aliases: ['同名'] },
    ]);
    await expect(resolveFoodByName('同名', 'token')).rejects.toBeInstanceOf(FoodAliasConflictError);
  });
});
