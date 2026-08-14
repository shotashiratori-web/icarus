// 食材図鑑（Phase3）。field_log_entriesをfoodでGROUP BYしたD1読み取りAPIの型。
// 図鑑固有のデータ（canonical_name・classification_status等）はまだ存在しない。

export interface FieldFoodListItem {
  foodName: string;
  representativePhotoUrl: string | null;
  largeCategory: string | null;
  subCategory: string | null;
  classificationConflict: boolean;
  observationCount: number;
  firstObservedDate: string;
  lastObservedDate: string;
  placeCount: number;
  partCount: number;
}

export interface FieldFoodListSuccess {
  status: 'success';
  items: FieldFoodListItem[];
  totalCount: number;
  sort: 'lastObservedDate' | 'name';
}

export interface FieldFoodObservation {
  eventId: string;
  date: string;
  photoUrl: string;
  place: string;
  memo: string;
  latitude: number | null;
  longitude: number | null;
  elevation: number | null;
  takenAt: string | null;
  largeCategory: string;
  subCategory: string;
  observedParts: string;
  identificationStatus: string;
  createdBy: string;
}

export interface FieldFoodDateCount {
  date: string;
  count: number;
}

export interface FieldFoodPlaceCount {
  place: string | null; // null = 場所未記入
  observationCount: number;
}

export interface FieldFoodPartCount {
  part: string;
  observationCount: number;
}

export interface FieldFoodDetailSuccess {
  status: 'success';
  food: FieldFoodListItem;
  observations: FieldFoodObservation[];
  observedDates: FieldFoodDateCount[];
  places: FieldFoodPlaceCount[];
  parts: FieldFoodPartCount[];
  pagination: { limit: number; offset: number; total: number };
}

export interface FieldFoodError {
  status: 'error';
  message: string;
  code?: 'AUTH_INVALID' | 'STAFF_NOT_FOUND' | 'STAFF_PENDING' | 'STAFF_SUSPENDED'
    | 'FOOD_NAME_REQUIRED' | 'FOOD_NOT_FOUND';
}
