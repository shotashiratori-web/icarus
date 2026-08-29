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
  };
};
