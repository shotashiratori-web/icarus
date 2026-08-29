import type { WineEntity } from '../types/wineEntity';

// Tasting Note Persistence v1（Stage 1C-A）。Wine Entity検索候補の絞り込み・並び替え専用の純粋関数群。
// production wines 297件の実データにはproducer表記ゆれ（中黒「・」・半角/全角スペースの混在。
// 例: 'ドメーヌタカヒコ' / 'ドメーヌ・タカヒコ'）が多数存在し、server側のSQL LIKEだけでは
// 同一生産者を同一と判定できず候補漏れが起きる（Stage 1C監査で確認済み）。ここでは元データ自体は
// 書き換えず、比較専用の正規化文字列を都度計算する（表示は常にoriginal値のまま）。
export function normalizeWineMatchText(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '') // 半角・全角スペース除去
    .replace(/[・･]/g, ''); // 中黒（全角/半角）除去
}

export interface WineLinkQueryHints {
  wineName: string;
  producer: string;
  vintage: string; // WineNoteのvintage snapshotはtext（MixedFieldData）のためstringで受け取る
}

// 検索ボックスに入力された自由テキストで絞り込む（Stage 9）。normalized title/producerへの部分一致に加え、
// queryが数字のみならvintage一致も候補に含める。297件をクライアント側でfilterする前提（server fetchは1回のみ）
function matchesQuery(wine: WineEntity, normalizedQuery: string, rawQuery: string): boolean {
  if (!normalizedQuery) return true;
  const title = normalizeWineMatchText(wine.title);
  const producer = normalizeWineMatchText(wine.producer);
  if (title.includes(normalizedQuery) || producer.includes(normalizedQuery)) return true;
  const trimmedRaw = rawQuery.trim();
  if (/^\d+$/.test(trimmedRaw) && wine.vintage !== null && String(wine.vintage) === trimmedRaw) return true;
  return false;
}

// ranking（Stage 6）: 一致条件が多い/強いWineほど上位。あくまで「並び順」であり、
// 自動選択・自動確定には使わない（呼び出し元は常に一覧から手動選択させる）
function scoreWine(wine: WineEntity, hints: WineLinkQueryHints): number {
  const title = normalizeWineMatchText(wine.title);
  const producer = normalizeWineMatchText(wine.producer);
  const hintTitle = normalizeWineMatchText(hints.wineName);
  const hintProducer = normalizeWineMatchText(hints.producer);
  const hintVintage = hints.vintage.trim();

  let score = 0;
  if (hintTitle && title === hintTitle) score += 4;
  else if (hintTitle && title.includes(hintTitle)) score += 2;
  if (hintProducer && producer === hintProducer) score += 2;
  else if (hintProducer && producer.includes(hintProducer)) score += 1;
  if (hintVintage && wine.vintage !== null && String(wine.vintage) === hintVintage) score += 1;
  return score;
}

// query（検索ボックスの現在値）で絞り込み、hints（Note作成時点のsnapshot、検索ボックスの値とは独立に
// 常に一定）で並び替える。queryが空でも297件全件を返す（呼び出し元は初期queryにwine_nameを入れる想定）
export function rankWineCandidates(
  wines: WineEntity[],
  query: string,
  hints: WineLinkQueryHints,
): WineEntity[] {
  const normalizedQuery = normalizeWineMatchText(query);
  return wines
    .filter((w) => matchesQuery(w, normalizedQuery, query))
    .map((w) => ({ wine: w, score: scoreWine(w, hints) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.wine.title.localeCompare(b.wine.title, 'ja');
    })
    .map((c) => c.wine);
}
