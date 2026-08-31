import { describe, expect, it } from 'vitest';
import { newWineNote } from '../src/types/wine';
import { normalizeNote } from '../src/db/localDB';
import type { WineNote } from '../src/types/wine';

// Tasting Note Persistence v1（Stage 1D-B）。写真metadataのdefault値・legacy Note互換・
// 本文sync_statusとの独立性を検証する。

describe('newWineNote — photo metadata defaults', () => {
  it('1. 写真関連fieldの初期値が仕様通り', () => {
    const note = newWineNote();
    expect(note.photo_sync_status).toBe('none');
    expect(note.photo_sync_error_code).toBeNull();
    expect(note.photo_operation).toBe('none');
    expect(note.photo_asset_id).toBeNull();
    expect(note.photo_original_base64).toBeNull();
    expect(note.photo_original_filename).toBe('');
    expect(note.photo_original_mime_type).toBe('');
    expect(note.photo_file_hash).toBeNull();
    expect(note.photo_request_id).toBeNull();
  });
});

describe('normalizeNote — legacy Note互換', () => {
  it('2. Stage 1D-B以前のNote（写真fieldが存在しない）は安全なdefaultへ補完される', () => {
    const legacy = { ...newWineNote() } as Partial<WineNote>;
    delete legacy.photo_sync_status;
    delete legacy.photo_sync_error_code;
    delete legacy.photo_operation;
    delete legacy.photo_asset_id;
    delete legacy.photo_original_base64;
    delete legacy.photo_original_filename;
    delete legacy.photo_original_mime_type;
    delete legacy.photo_file_hash;
    delete legacy.photo_request_id;

    const normalized = normalizeNote(legacy as WineNote);
    expect(normalized.photo_sync_status).toBe('none');
    expect(normalized.photo_sync_error_code).toBeNull();
    expect(normalized.photo_operation).toBe('none');
    expect(normalized.photo_asset_id).toBeNull();
    expect(normalized.photo_original_base64).toBeNull();
    expect(normalized.photo_original_filename).toBe('');
    expect(normalized.photo_original_mime_type).toBe('');
    expect(normalized.photo_file_hash).toBeNull();
    expect(normalized.photo_request_id).toBeNull();
  });

  it('既に写真fieldを持つNoteはそのまま保持する', () => {
    const note: WineNote = {
      ...newWineNote(),
      photo_sync_status: 'synced',
      photo_asset_id: 'asset-123',
    };
    const normalized = normalizeNote(note);
    expect(normalized.photo_sync_status).toBe('synced');
    expect(normalized.photo_asset_id).toBe('asset-123');
  });
});

// Tasting Note Persistence v1（Stage 1D-C Pre-PR監査）。photo_server_linkedはphoto_asset_idとは
// 独立に「serverに現在label linkが存在するか」を表すstate。新写真選択のたびリセットされる
// photo_asset_idだけでは、差し替え中に削除した場合の旧server linkの存在を判定できないため追加した
// （offline/reloadを跨いでもunlink intentを保持できることをここで検証する）。
describe('normalizeNote — photo_server_linked（Pre-PR監査で追加）', () => {
  it('8a. フィールド自体が無い旧レコードはfalseへ補完する（未sync相当）', () => {
    const legacy = { ...newWineNote() } as Partial<WineNote>;
    delete legacy.photo_server_linked;

    const normalized = normalizeNote(legacy as WineNote);
    expect(normalized.photo_server_linked).toBe(false);
  });

  it('8b. フィールドが無く、かつphoto_sync_status=synced+photo_asset_id有りの旧レコードはtrueへ補完する（安全側の移行default）', () => {
    const legacy = {
      ...newWineNote(),
      photo_sync_status: 'synced' as const,
      photo_asset_id: 'asset-legacy-1',
    } as Partial<WineNote>;
    delete legacy.photo_server_linked;

    const normalized = normalizeNote(legacy as WineNote);
    expect(normalized.photo_server_linked).toBe(true);
  });

  it('8c. 明示的にtrueが保存されていれば、sync_statusに関わらずそのまま保持する（offline/reload耐性）', () => {
    // 差し替え中（新写真選択→未upload）にreloadした状態を再現：
    // photo_sync_status='local'（新candidateの状態）だが、旧写真はserver-linkedのまま
    const note: WineNote = {
      ...newWineNote(),
      photo_sync_status: 'local',
      photo_asset_id: null,
      photo_server_linked: true,
    };
    const normalized = normalizeNote(note);
    expect(normalized.photo_server_linked).toBe(true);
  });

  it('8d. 明示的にfalseが保存されていれば、他条件に関わらずfalseのまま保持する', () => {
    const note: WineNote = {
      ...newWineNote(),
      photo_sync_status: 'synced',
      photo_asset_id: 'asset-1',
      photo_server_linked: false,
    };
    const normalized = normalizeNote(note);
    expect(normalized.photo_server_linked).toBe(false);
  });
});

describe('sync_status と photo_sync_status の独立性', () => {
  it('3. 本文synced + 写真failedが同時に成立する（写真失敗で本文を巻き戻さない）', () => {
    const note: WineNote = {
      ...newWineNote(),
      sync_status: 'synced',
      photo_sync_status: 'failed',
      photo_sync_error_code: 'UPLOAD_FAILED',
    };
    expect(note.sync_status).toBe('synced');
    expect(note.photo_sync_status).toBe('failed');
    expect(note.photo_sync_error_code).toBe('UPLOAD_FAILED');
  });
});
