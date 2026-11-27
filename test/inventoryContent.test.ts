import { describe, expect, it } from 'vitest';
import { buildInventoryContent } from '../src/utils/inventoryContent';

// 棚卸しモード（icarus_work_log_inventory_mode_design.md）: 1 品の作業ログの「内容」
const COMMON = { type: '加工研究', storageClass: '冷蔵' as const, location: '冷蔵庫A・上段', datetime: '2026-11-27T10:00' };
const EMPTY = { name: 'ナラタケ塩漬け', quantity: '', producedOn: '', openState: '' as const, memo: '' };

describe('buildInventoryContent', () => {
  it('全部ある時: 保存・場所・量・製造日・開封・メモの順に 1 行ずつ', () => {
    expect(buildInventoryContent(COMMON, { ...EMPTY, quantity: '2瓶・約800g', producedOn: '2025/10', openState: '未開封', memo: '塩12%' }))
      .toBe('保存：冷蔵\n場所：冷蔵庫A・上段\n量：2瓶・約800g\n製造日：2025/10\n開封：未開封\nメモ：塩12%');
  });
  it('空の項目の行は出さない（製造日・開封は推測で埋めない）', () => {
    expect(buildInventoryContent(COMMON, EMPTY)).toBe('保存：冷蔵\n場所：冷蔵庫A・上段');
  });
  it('前後の空白は落とし、空白だけの値は空として扱う', () => {
    expect(buildInventoryContent({ ...COMMON, location: '  乾物棚 ' }, { ...EMPTY, memo: '   ' })).toBe('保存：冷蔵\n場所：乾物棚');
  });
  it('どれも空の時（品名だけで登録）は決まった文を入れる（内容は作業ログで必須）', () => {
    expect(buildInventoryContent({ ...COMMON, storageClass: '', location: ' ' }, EMPTY)).toBe('棚卸しで登録');
  });
});
