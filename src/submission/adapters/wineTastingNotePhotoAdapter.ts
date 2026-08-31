import { createUploadAndFinalizeAsset } from '../../api/photoAssetApi';
import { PhotoUploadFailedError } from '../../api/fieldLogD1Api';
import { linkWineTastingNotePhoto, unlinkWineTastingNotePhoto } from '../../api/wineTastingNoteApi';
import { getNote, saveNote } from '../../db/localDB';
import { registerAdapter } from '../registry';
import { mapFieldLogD1Error } from '../errorMapping';
import type { PhotoSyncErrorCode } from '../../types/wine';

// Tasting Note Persistence v1（Stage 1D-B）。本文（wineTastingNote）とは別のSubmissionEntity。
// payloadはnoteIdのみ（軽量、Original Base64を二重保存しない——Stage 1D-B Stage 7/44の検証結果どおり、
// adapter実行時にnotes storeから直接読む。既存wineTastingNoteAdapter.ts（Stage 1B production実績）と
// 同じパターン）。
//
// フレームワーク側の SubmissionError（Pending List表示用、ErrorCode型）と、
// WineNote独自の photo_sync_error_code（PhotoSyncErrorCode型、リトライ可否判定用）は別物。
// 前者は既存 mapFieldLogD1Error をそのまま再利用する（粗い分類で十分、Pending Listは表示専用）。
// 後者はここ（adapter内、raw errorへアクセスできる唯一の場所）でしか正確に分類できないため、
// adapter自身がsaveNote()の副作用として書き込む（d1_note_id書き戻しと同じ既存パターンの延長）。
export interface WineTastingNotePhotoSubmissionPayload {
  noteId: string;
}

// createUploadAndFinalizeAssetは内部でPOST /assets → R2 PUT → POST /assets/:id/finalizeを順に呼ぶ
// 単一関数のため、外からは「どの段階で失敗したか」をerrorのcodeでしか区別できない。
// ASSET_UNSUPPORTED_MIME_TYPE（POST /assets）とASSET_FINALIZE_*（finalize）だけが判別可能な
// server codeを持つ。それ以外（POST /assets自体の他の失敗・R2 PUTの失敗）は区別できないため、
// 推測でFINALIZE_FAILEDへ振らずUPLOAD_FAILEDへ寄せる（Stage 16の方針どおり）
function mapPhotoUploadErrorCode_(err: unknown): PhotoSyncErrorCode {
  if (err instanceof PhotoUploadFailedError) {
    if (err.code === 'ASSET_UNSUPPORTED_MIME_TYPE') return 'UNSUPPORTED_MEDIA_TYPE';
    if (err.code?.startsWith('ASSET_FINALIZE_')) return 'FINALIZE_FAILED';
  }
  return 'UPLOAD_FAILED';
}

async function markFailed_(noteId: string, code: PhotoSyncErrorCode): Promise<void> {
  const latest = await getNote(noteId);
  if (!latest) return;
  await saveNote({ ...latest, photo_sync_status: 'failed', photo_sync_error_code: code });
}

registerAdapter<WineTastingNotePhotoSubmissionPayload>({
  entity: 'wineTastingNotePhoto',
  submit: async (payload, idToken) => {
    const note = await getNote(payload.noteId);
    // ローカルNoteが既に削除されている等、稀な競合。写真sync対象が無いだけなので正常終了扱いにする
    if (!note) return;

    // Stage 19: 解除意図が優先。d1_note_idが無い（本文未同期）場合はunlinkする対象自体がserver側に
    // 存在しないため、ローカルのidentityだけをそのまま「未接続」へ整理する
    if (note.photo_operation === 'remove') {
      if (!note.d1_note_id) {
        await saveNote({
          ...note,
          photo_sync_status: 'none', photo_sync_error_code: null, photo_operation: 'none',
          photo_asset_id: null, photo_original_base64: null, photo_original_filename: '',
          photo_original_mime_type: '', photo_file_hash: null, photo_request_id: null,
        });
        return;
      }
      try {
        await unlinkWineTastingNotePhoto(note.d1_note_id, idToken);
      } catch (err) {
        await markFailed_(payload.noteId, 'UNLINK_FAILED');
        throw err;
      }
      // Stage 20: server unlink成功後にのみidentityを整理する
      const afterUnlink = await getNote(payload.noteId);
      if (afterUnlink) {
        await saveNote({
          ...afterUnlink,
          photo_sync_status: 'none', photo_sync_error_code: null, photo_operation: 'none',
          photo_asset_id: null, photo_original_base64: null, photo_original_filename: '',
          photo_original_mime_type: '', photo_file_hash: null, photo_request_id: null,
        });
      }
      return;
    }

    // photo_operation === 'sync'。d1_note_idが無ければ呼び出し元（sync層）が事前に弾いている前提だが、
    // 二重の安全弁として同様にno-opで返す
    if (!note.d1_note_id) return;

    let assetId = note.photo_asset_id;
    if (!assetId) {
      if (!note.photo_original_base64 || !note.photo_file_hash) {
        throw new Error('写真データが失われています。もう一度撮影・選択し直してください');
      }
      // Photo Asset requestIdはUUID v4がserver契約（Stage 30）。file_hash等の文字列をそのまま
      // 流用せず、初回のみ生成してNoteへ保存し、以後のretryで使い回す
      let requestId = note.photo_request_id;
      if (!requestId) {
        requestId = crypto.randomUUID();
        await saveNote({ ...note, photo_request_id: requestId });
      }

      try {
        assetId = await createUploadAndFinalizeAsset(
          {
            requestId,
            fileHash: note.photo_file_hash,
            originalFilename: note.photo_original_filename,
            mimeType: note.photo_original_mime_type,
            sizeBytes: null,
            width: null,
            height: null,
            takenAt: null,
            exifGpsLat: null,
            exifGpsLng: null,
          },
          note.photo_original_base64,
          idToken,
        );
      } catch (err) {
        await markFailed_(payload.noteId, mapPhotoUploadErrorCode_(err));
        throw err;
      }

      // Stage 12: finalize成功時点（= assetId確定時点）で、link成功を待たずに即保存する。
      // これによりretry時、既にready済みのAssetをR2へ再uploadしない
      const afterFinalize = await getNote(payload.noteId);
      if (afterFinalize) await saveNote({ ...afterFinalize, photo_asset_id: assetId });
    }

    try {
      await linkWineTastingNotePhoto(note.d1_note_id, assetId, idToken);
    } catch (err) {
      await markFailed_(payload.noteId, 'LINK_FAILED');
      throw err;
    }

    const afterLink = await getNote(payload.noteId);
    if (afterLink) {
      // Stage 1D-C Stage 22: link成功（=server正本が確立した）時点でOriginal Base64をclearする。
      // label_photo_url（local preview）・photo_asset_id・photo_request_id・photo_file_hash・
      // filename/mimeTypeは引き続き保持する（Stage 23: local preview/identity/debug/再表示のため）
      await saveNote({
        ...afterLink,
        photo_sync_status: 'synced',
        photo_sync_error_code: null,
        photo_operation: 'none',
        photo_original_base64: null,
      });
    }
  },
  // フレームワーク側（Pending List表示用）は既存Field Logの分類をそのまま再利用する。
  // ここで捨てているように見えるが、photo_sync_error_codeの精密な分類はsubmit()内で既に完了している
  mapError: mapFieldLogD1Error,
});
