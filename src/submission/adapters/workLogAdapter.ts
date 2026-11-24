import { submitWork } from '../../api/workApi';
import { createUploadAndFinalizeAsset } from '../../api/photoAssetApi';
import { loadWorkLogDraft, clearWorkLogDraft, saveWorkLogDraft } from '../../db/localDB';
import { registerAdapter } from '../registry';
import { mapWorkLogError } from '../errorMapping';
import type { WorkSubmitSuccess } from '../../types/workLog';

// Work Log Submission Framework Final Design。payloadはidentityのみ——写真Base64を含む
// 実データはwork_log_draft（keyは`work:${requestId}`、Draft Identity Fix）に1箇所だけ持ち、
// submit()実行時にそこから読み直す（wineTastingNotePhotoAdapterと同じ「queueは識別子のみ」パターン）
export interface WorkLogSubmissionPayload {
  requestId: string;
}

registerAdapter<WorkLogSubmissionPayload, WorkSubmitSuccess | undefined>({
  entity: 'workLog',
  submit: async (payload, idToken) => {
    const draft = await loadWorkLogDraft(payload.requestId);
    if (!draft) {
      // invariant違反（本来はGAS成功→draft clear→queue removeが同時に起きるはずが、
      // 途中でqueue removeだけ失敗した場合にここへ到達しうる）。API送信はせず、
      // 既に解決済みとして扱いresolvedを返す。submitWithFallback側の成功パスが
      // 自動的にqueue itemを削除するので、ここでは何もしなくてよい
      console.warn(`[workLogAdapter] draft not found for requestId=${payload.requestId}, treating as already-resolved no-op`);
      return undefined;
    }

    // 作業ログの写真を R2 へ（icarus_work_log_photo_r2_design.md）。原本を先に POST /assets → R2 → finalize で上げ、
    // assetId を下書きに書き戻してから /work を送る。/work が失敗して再送されても、assetId があれば上げ直さない
    let photoAssetId = draft.photoAssetId;
    if (draft.photoOriginal && !photoAssetId) {
      const o = draft.photoOriginal;
      photoAssetId = await createUploadAndFinalizeAsset({
        requestId: o.assetRequestId,
        fileHash: o.fileHash,
        originalFilename: o.fileName,
        mimeType: o.mimeType,
        sizeBytes: o.sizeBytes,
        width: o.width ?? null,
        height: o.height ?? null,
        takenAt: o.takenAt ?? null,
        exifGpsLat: null,
        exifGpsLng: null,
      }, o.base64, idToken);
      const { key: _key, savedAt: _savedAt, ...rest } = draft;
      await saveWorkLogDraft({ ...rest, photoAssetId, photoOriginal: undefined });
    }

    const result = await submitWork({
      requestId: draft.requestId,
      action: draft.mode,
      workId: draft.mode === 'append' ? draft.workId : undefined,
      title: draft.mode === 'create' ? draft.title : undefined,
      type: draft.mode === 'create' ? draft.type : undefined,
      content: draft.content,
      datetime: new Date(draft.datetime).toISOString(),
      photoBase64: photoAssetId ? undefined : draft.photoBase64,
      photoMimeType: photoAssetId ? undefined : draft.photoMimeType,
      photoAssetId,
      caption: draft.caption,
    }, idToken);

    // GAS成功が確定した後にのみdraftを消す（成功前に消すと、通信断で応答が届かなかった場合に
    // 再送する元データを失う）
    await clearWorkLogDraft(payload.requestId);
    return result;
  },
  mapError: mapWorkLogError,
});
