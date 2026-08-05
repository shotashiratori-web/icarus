import { uploadFieldLogPhoto, submitFieldLogD1 } from '../../api/fieldLogD1Api';
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
  // アップロードが済むまでの間だけ保持し、成功したらクリアする
  photoBase64?: string;
  // 一度取得したら値を保持し続ける。D1保存が失敗して再送される場合も、ここに値がある限り再アップロードしない
  photoUrl?: string;
}

registerAdapter<FieldLogD1SubmissionPayload>({
  entity: 'fieldLogD1',
  submit: async (payload, idToken) => {
    // payload自身をmutateする。submitWithFallback側は同じオブジェクト参照を保留queueへ書き戻すため、
    // ここでphotoUrlを埋めておけば、この後D1保存が失敗しても次回の再送で写真を再アップロードしない
    if (payload.hasPhoto && !payload.photoUrl) {
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
      photoUrl: payload.photoUrl ?? '',
      latitude: payload.latitude,
      longitude: payload.longitude,
      takenAt: payload.takenAt,
      largeCategory: payload.largeCategory,
    }, idToken);
  },
  mapError: mapFieldLogD1Error,
});
