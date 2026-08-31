export type SVGStroke = {
  points: [number, number, number][]; // [x, y, pressure]
  color: string;
  size: number;
};

export type MixedFieldData = {
  strokes: SVGStroke[];
  text: string;
  ocr_text: string | null;
};

export type Addendum = {
  id: string;
  text: string;
  photo_url: string | null;
  created_at: string;
};

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'failed';

// Tasting Note Persistence v1（Stage 1D-B）。本文sync_statusとは完全に別状態（Final Design Stage 4/6）。
// sync_status='synced' + photo_sync_status='failed' が同時に成立できる
export type PhotoSyncStatus = 'none' | 'local' | 'uploading' | 'synced' | 'failed';

// UNLINK_FAILEDはFinal Design時点の列挙（UNSUPPORTED_MEDIA_TYPE/UPLOAD_FAILED/FINALIZE_FAILED/
// LINK_FAILED）には無い追加値。unlink失敗をLINK_FAILEDと同一視すると「linkに失敗した」という
// 誤った意味になるため、Stage 1D-B実装時にFinal Designとの差分として追加した（STOP報告で明示）
export type PhotoSyncErrorCode =
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UPLOAD_FAILED'
  | 'FINALIZE_FAILED'
  | 'LINK_FAILED'
  | 'UNLINK_FAILED';

// 'sync' = photo_asset_id確定・link済みへ向けて進める（未接続の新規写真も既存差し替えも同じ）
// 'remove' = server unlinkへ向けて進める。「消したいという意図」自体を明示的な状態として持つ
// （Stage 1D-B Stage 19: label_photo_url=nullだけでは解除意図を表現しない）
export type PhotoOperation = 'none' | 'sync' | 'remove';

export type WineNote = {
  id: string;
  fields: {
    wine_name: MixedFieldData;
    producer: MixedFieldData;
    vintage: MixedFieldData;
    type: MixedFieldData;
    tasting_date: MixedFieldData;
    location: MixedFieldData;
    aroma: MixedFieldData;
    memo: MixedFieldData;
    glass_price: MixedFieldData;
    bottle_price: MixedFieldData;
  };
  label_photo_url: string | null;
  addenda: Addendum[];
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  notion_page_id: string | null;
  // Tasting Note Persistence v1（Stage 1B）。D1 wine_tasting_notesの行id。一度同期に成功したら保持し、
  // 以後の再送/編集はPATCH（このid宛て）を使う。nullのままなら未同期＝次回はPOST（新規作成）
  d1_note_id: string | null;
  // Tasting Note Persistence v1（Stage 1C-A）。接続先Wine EntityのUUID。ユーザーの手動選択でのみ設定される
  // （自動紐付け・自動新規作成はしない）。nullのままでもNote保存・同期は成立する
  wine_id: string | null;

  // Tasting Note Persistence v1（Stage 1D-B）。写真（label Asset）の同期状態。本文sync_statusとは
  // 独立（Stage 4）。label_photo_url（local preview/legacy互換）は引き続き残し、server正本にはしない
  photo_sync_status: PhotoSyncStatus;
  photo_sync_error_code: PhotoSyncErrorCode | null;
  photo_operation: PhotoOperation;
  // Stage 1D-A linkの対象。finalize成功時点で即保存する（link失敗してもR2再uploadしないため）
  photo_asset_id: string | null;
  // 元Fileそのもの（resize後JPEGではない）。upload成功後もStage 1D-Bではすぐ削除しない
  // （RecordScreen統合前のrollback/debug容易性を優先。IndexedDB容量とのトレードオフはSTOP報告で明示）
  photo_original_base64: string | null;
  photo_original_filename: string;
  photo_original_mime_type: string;
  photo_file_hash: string | null;
  // Photo Asset作成用の冪等キー。UUID v4必須（server契約、Stage 30）のためhash等を流用できない。
  // 初回upload試行時に1度だけ生成し、以後のretryでも同じ値を使い回す（毎回random UUIDにしない）
  photo_request_id: string | null;
};

export const emptyField = (): MixedFieldData => ({
  strokes: [],
  text: '',
  ocr_text: null,
});

export const newWineNote = (): WineNote => {
  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return {
    id: crypto.randomUUID(),
    fields: {
      wine_name:    emptyField(),
      producer:     emptyField(),
      vintage:      emptyField(),
      type:         emptyField(),
      tasting_date: { ...emptyField(), text: today },
      location:     emptyField(),
      aroma:        emptyField(),
      memo:         emptyField(),
      glass_price:  emptyField(),
      bottle_price: emptyField(),
    },
    label_photo_url: null,
    addenda: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sync_status: 'local',
    notion_page_id: null,
    d1_note_id: null,
    wine_id: null,
    photo_sync_status: 'none',
    photo_sync_error_code: null,
    photo_operation: 'none',
    photo_asset_id: null,
    photo_original_base64: null,
    photo_original_filename: '',
    photo_original_mime_type: '',
    photo_file_hash: null,
    photo_request_id: null,
  };
};
