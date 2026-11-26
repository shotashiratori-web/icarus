// 棚卸しモード（icarus_work_log_inventory_mode_design.md）。1 品の作業ログの「内容」を作る。
// 空の項目の行は出さない。作業ログの検索（タイトル・内容）で「冷蔵庫A」「未開封」などで探せる
export type StorageClass = '冷蔵' | '冷凍' | '常温';
export type OpenState = '' | '未開封' | '開封済み';

export interface InventoryCommon {
  type: string;
  storageClass: StorageClass | '';
  location: string;
  datetime: string;
}

export interface InventoryItemFields {
  name: string;
  quantity: string;
  producedOn: string;
  openState: OpenState;
  memo: string;
}

export function buildInventoryContent(common: InventoryCommon, item: InventoryItemFields): string {
  const lines: [string, string][] = [
    ['保存', common.storageClass],
    ['場所', common.location],
    ['量', item.quantity],
    ['製造日', item.producedOn],
    ['開封', item.openState],
    ['メモ', item.memo],
  ];
  return lines
    .map(([label, value]) => [label, value.trim()] as const)
    .filter(([, value]) => value !== '')
    .map(([label, value]) => `${label}：${value}`)
    .join('\n');
}
