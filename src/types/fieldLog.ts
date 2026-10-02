export interface FieldObservation {
  eventId: string;
  date: string;
  food: string;
  place: string;
  phase: string;
  photoUrl: string;
  notionUrl: string;
  memo: string;
  largeCategory: string;
  subjectType?: string | null; // 記録の種類。'環境' は 🌲 で区別して出す（古い応答には無い）
}

export interface WorkLogItem {
  workId: string;
  datetime: string;
  processingName: string;
  status: string;
  photoUrl: string;
  memo: string;
  ingredientText: string;
}

export interface RecentApiSuccess<T> {
  status: 'success';
  items: T[];
}

export interface RecentApiError {
  status: 'error';
  message: string;
}
