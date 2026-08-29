import { describe, expect, it } from 'vitest';
import { normalizeWineMatchText, rankWineCandidates } from '../src/utils/wineLinkMatch';
import type { WineEntity } from '../src/types/wineEntity';

// Tasting Note Persistence v1（Stage 1C-A）。production wines 297件の実データ監査で見つかった
// producer表記ゆれ（中黒・半角/全角スペースの混在）に対して、候補提示が正しく機能することを検証する。
// 常に「候補一覧」を返すだけで、自動選択・自動確定は行わないことも合わせて確認する。

function wine(overrides: Partial<WineEntity>): WineEntity {
  return {
    id: overrides.id ?? 'wine-1',
    title: overrides.title ?? 'テストワイン',
    description: '',
    photos: [],
    tags: [],
    status: 'active',
    producer: overrides.producer ?? '',
    vintage: overrides.vintage ?? null,
    variety: '',
    origin: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'staff@example.com',
    ...overrides,
  };
}

describe('normalizeWineMatchText', () => {
  it('9. 中黒（全角・半角）を除去する', () => {
    expect(normalizeWineMatchText('ドメーヌ・タカヒコ')).toBe(normalizeWineMatchText('ドメーヌタカヒコ'));
    expect(normalizeWineMatchText('グート･オッガウ')).toBe(normalizeWineMatchText('グートオッガウ'));
  });

  it('10. 半角スペースを除去する', () => {
    expect(normalizeWineMatchText('ノース クリーク ファーム')).toBe(normalizeWineMatchText('ノースクリークファーム'));
  });

  it('11. 全角スペースを除去する', () => {
    expect(normalizeWineMatchText('ドメーヌ　モン')).toBe(normalizeWineMatchText('ドメーヌモン'));
  });

  it('trim・小文字化も行う（元データは書き換えない前提の比較専用関数）', () => {
    expect(normalizeWineMatchText('  Naritaya  ')).toBe('naritaya');
  });
});

describe('rankWineCandidates', () => {
  it('12. producer表記ゆれがあっても候補として一致する', () => {
    const wines = [wine({ id: 'w1', title: 'ナナツモリ', producer: 'ドメーヌタカヒコ' })];
    const result = rankWineCandidates(wines, 'ナナツモリ', { wineName: 'ナナツモリ', producer: 'ドメーヌ・タカヒコ', vintage: '' });
    expect(result.map((w) => w.id)).toEqual(['w1']);
  });

  it('13. 同title・複数producerの候補をすべて返す（1件に絞り込まない）', () => {
    const wines = [
      wine({ id: 'w1', title: 'ピノ・ノワール', producer: '山田堂', vintage: 2022 }),
      wine({ id: 'w2', title: 'ピノ・ノワール', producer: 'ノースクリーク ファーム', vintage: 2024 }),
      wine({ id: 'w3', title: 'ピノ・ノワール', producer: 'ドメーヌ・アツシスズキ', vintage: 2022 }),
    ];
    const result = rankWineCandidates(wines, 'ピノ・ノワール', { wineName: 'ピノ・ノワール', producer: '', vintage: '' });
    expect(result.map((w) => w.id).sort()).toEqual(['w1', 'w2', 'w3']);
  });

  it('14. vintage違いの候補も両方返す。かつsnapshotと一致するvintageが上位に来る', () => {
    const wines = [
      wine({ id: 'w-2022', title: 'ヨイチ・ノボリ', producer: 'ドメーヌ・タカヒコ', vintage: 2022 }),
      wine({ id: 'w-2023', title: 'ヨイチ・ノボリ', producer: 'ドメーヌ・タカヒコ', vintage: 2023 }),
    ];
    const result = rankWineCandidates(wines, 'ヨイチ・ノボリ', { wineName: 'ヨイチ・ノボリ', producer: 'ドメーヌ・タカヒコ', vintage: '2023' });
    expect(result.map((w) => w.id)).toEqual(['w-2023', 'w-2022']); // vintage一致が上位
    expect(result).toHaveLength(2); // 両方とも候補として残る（片方に絞り込まない）
  });

  it('15. 候補が1件でも、関数は配列を返すのみで自動選択・自動確定はしない', () => {
    const wines = [wine({ id: 'only-one', title: 'ユニークワイン', producer: '生産者A' })];
    const result = rankWineCandidates(wines, 'ユニークワイン', { wineName: 'ユニークワイン', producer: '生産者A', vintage: '' });
    // 戻り値は候補配列であり、呼び出し元が選択したかどうかを示すフラグや自動選択された値は一切含まない
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('only-one');
  });

  it('16. 検索queryを変更すると絞り込み結果が変わる', () => {
    const wines = [
      wine({ id: 'w1', title: 'モンロゼ AK', producer: 'ドメーヌ・モン' }),
      wine({ id: 'w2', title: 'アメイセンソウ', producer: 'ランセッカ' }),
    ];
    const hints = { wineName: '', producer: '', vintage: '' };
    expect(rankWineCandidates(wines, 'モンロゼ', hints).map((w) => w.id)).toEqual(['w1']);
    expect(rankWineCandidates(wines, 'ランセッカ', hints).map((w) => w.id)).toEqual(['w2']);
  });

  it('queryが空なら全件を返す（初期queryにwine_nameを入れる想定の補助）', () => {
    const wines = [wine({ id: 'w1' }), wine({ id: 'w2' })];
    const result = rankWineCandidates(wines, '', { wineName: '', producer: '', vintage: '' });
    expect(result).toHaveLength(2);
  });

  it('数字のみのqueryはvintage一致も候補に含める', () => {
    const wines = [wine({ id: 'w1', title: '無関係ワイン', producer: '無関係', vintage: 2021 })];
    const result = rankWineCandidates(wines, '2021', { wineName: '', producer: '', vintage: '' });
    expect(result.map((w) => w.id)).toEqual(['w1']);
  });

  it('producer/vintage欠損のWineでも例外を投げない', () => {
    const wines = [wine({ id: 'w1', title: '欠損ワイン', producer: '', vintage: null })];
    expect(() => rankWineCandidates(wines, '欠損', { wineName: '欠損ワイン', producer: '', vintage: '' })).not.toThrow();
  });
});
