export type EntityStatus = 'active' | 'archived';

// 「場所」ではなく「残したい対象」を表現するEntity（神社・看板・巨木・採集ポイント・工房・店・景観など）。
// GPS（lat/lng）は任意の属性であり本質ではない。訪問履歴は持たない（作成日・更新日のみ）。
export interface SpotEntity {
  id: string;
  title: string;
  description: string;
  photos: string[];
  tags: string[];
  status: EntityStatus;
  category: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface SpotListSuccess {
  status: 'success';
  items: SpotEntity[];
}

export interface SpotItemSuccess {
  status: 'success';
  item: SpotEntity;
}

export interface SpotActionSuccess {
  status: 'success';
}

export interface SpotError {
  status: 'error';
  message: string;
  code?: 'AUTH_INVALID' | 'STAFF_NOT_FOUND' | 'STAFF_PENDING' | 'STAFF_SUSPENDED'
    | 'SPOT_VALIDATION_ERROR' | 'SPOT_NOT_FOUND';
}

export interface SpotFormInput {
  title: string;
  description: string;
  photos: string[];
  tags: string[];
  category: string;
  lat: number | null;
  lng: number | null;
  status?: EntityStatus;
}
