export type EntityStatus = 'active' | 'archived';

// Icarus最初の正式Entity（Data Model v1.0準拠）。ワインそのものだけを表現する。
// 試飲者・価格・香り・感想・手書き/OCRは別Entity「Wine Tasting Note」に整理する（既存のWineNote/RecordScreenとは別物）。
export interface WineEntity {
  id: string;
  title: string;
  description: string;
  photos: string[];
  tags: string[];
  status: EntityStatus;
  producer: string;
  vintage: number | null;
  variety: string;
  origin: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface WineListSuccess {
  status: 'success';
  items: WineEntity[];
}

export interface WineItemSuccess {
  status: 'success';
  item: WineEntity;
}

export interface WineActionSuccess {
  status: 'success';
}

export interface WineError {
  status: 'error';
  message: string;
  code?: 'AUTH_INVALID' | 'STAFF_NOT_FOUND' | 'STAFF_PENDING' | 'STAFF_SUSPENDED'
    | 'WINE_VALIDATION_ERROR' | 'WINE_NOT_FOUND';
}

export interface WineFormInput {
  title: string;
  description: string;
  photos: string[];
  tags: string[];
  producer: string;
  vintage: number | null;
  variety: string;
  origin: string;
  status?: EntityStatus;
}
