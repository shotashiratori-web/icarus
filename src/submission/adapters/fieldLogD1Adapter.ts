import { uploadFieldLogPhoto, submitFieldLogD1 } from '../../api/fieldLogD1Api';
import { createUploadAndFinalizeAsset } from '../../api/photoAssetApi';
import { registerAdapter } from '../registry';
import { mapFieldLogD1Error } from '../errorMapping';

export interface FieldLogD1SubmissionPayload {
  eventId: string;
  requestId: string;
  date: string;
  food: string;
  place: string;
  memo: string;
  largeCategory: string;
  latitude?: number;
  longitude?: number;
  takenAt?: string;
  hasPhoto: boolean;
  photoFileName?: string;
  // 既存Cloudinary経路。アップロードが済むまでの間だけ保持し、成功したらクリアする
  photoBase64?: string;
  // 一度取得したら値を保持し続ける。D1保存が失敗して再送される場合も、ここに値がある限り再アップロードしない
  photoUrl?: string;

  // Photo Asset Architecture v1（Stage 1: Admin Field Log R2 MVP）。trueならCloudinaryではなく
  // R2 Assetとして扱う。PHOTO_ASSET_R2_ENABLEDをfalseにすれば呼び出し元がこのフラグ自体を立てなくなり、
  // 既存Cloudinary経路（下のphotoBase64/photoUrl分岐）だけが動く状態へ即座に戻せる
  useR2Asset?: boolean;
  assetFileHash?: string;
  assetMimeType?: string;
  assetSizeBytes?: number;
  assetWidth?: number;
  assetHeight?: number;
  // resize前の元Fileそのもの。Asset finalizeが完了する（assetIdが確定する）までの間だけ保持し、
  // 成功したらクリアする（既存photoBase64→photoUrlと同じ冪等パターン）
  assetOriginalBase64?: string;
  // 一度確定したら、同じrequestId/fileHashでR2 originalを再uploadし続けない
  assetId?: string;
}

registerAdapter<FieldLogD1SubmissionPayload>({
  entity: 'fieldLogD1',
  submit: async (payload, idToken) => {
    // payload自身をmutateする。submitWithFallback側は同じオブジェクト参照を保留queueへ書き戻すため、
    // ここでphotoUrl/assetIdを埋めておけば、この後D1保存が失敗しても次回の再送で写真を再アップロードしない
    if (payload.hasPhoto && payload.useR2Asset && !payload.assetId) {
      if (!payload.assetOriginalBase64 || !payload.assetFileHash || !payload.assetMimeType) {
        throw new Error('写真データが失われています。もう一度撮影・選択し直してください');
      }
      const assetId = await createUploadAndFinalizeAsset(
        {
          requestId: payload.requestId,
          fileHash: payload.assetFileHash,
          originalFilename: payload.photoFileName || '',
          mimeType: payload.assetMimeType,
          sizeBytes: payload.assetSizeBytes ?? null,
          width: payload.assetWidth ?? null,
          height: payload.assetHeight ?? null,
          takenAt: payload.takenAt ?? null,
          exifGpsLat: payload.latitude ?? null,
          exifGpsLng: payload.longitude ?? null,
        },
        payload.assetOriginalBase64,
        idToken,
      );
      payload.assetId = assetId;
      payload.assetOriginalBase64 = undefined;
    } else if (payload.hasPhoto && !payload.useR2Asset && !payload.photoUrl) {
      if (!payload.photoBase64) {
        throw new Error('写真データが失われています。もう一度撮影・選択し直してください');
      }
      const secureUrl = await uploadFieldLogPhoto(payload.photoBase64, payload.photoFileName || 'photo.jpg', idToken);
      payload.photoUrl = secureUrl;
      payload.photoBase64 = undefined;
    }

    return submitFieldLogD1({
      eventId: payload.eventId,
      requestId: payload.requestId,
      date: payload.date,
      food: payload.food,
      place: payload.place,
      memo: payload.memo,
      // assetId経由の写真はphotoUrlを''のまま送る（Workerが両方同時指定を拒否するため）
      photoUrl: payload.useR2Asset ? '' : (payload.photoUrl ?? ''),
      assetId: payload.useR2Asset ? payload.assetId : undefined,
      latitude: payload.latitude,
      longitude: payload.longitude,
      takenAt: payload.takenAt,
      largeCategory: payload.largeCategory,
    }, idToken);
  },
  mapError: mapFieldLogD1Error,
});
