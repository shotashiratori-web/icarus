import { submitPhotoEntry } from '../../api/icarusApi';
import type { PhotoEntry, CommonFields, FoodLogSuccess } from '../../types/foodLog';
import { registerAdapter } from '../registry';
import { mapIcarusApiError } from '../errorMapping';

export interface FoodLogSubmissionPayload {
  photo: Omit<PhotoEntry, 'previewUrl'>;
  common: CommonFields;
}

registerAdapter<FoodLogSubmissionPayload, FoodLogSuccess>({
  entity: 'foodLog',
  submit: (payload, idToken) =>
    submitPhotoEntry(payload.photo as PhotoEntry, payload.common, idToken),
  mapError: mapIcarusApiError,
});
