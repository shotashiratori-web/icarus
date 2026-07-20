export type DailyStatus = 'submitted' | 'confirmed' | 'revision_requested';
export type ConcernType = 'question' | 'consultation' | 'trouble' | 'improvement';

export interface DailyEntry {
  id: number;
  staffEmail: string;
  displayName: string;
  entryDate: string;
  movedMoment: string;
  learning: string;
  imitate: string;
  challengeMindset: string;
  challengeSkill: string;
  challengeAction: string;
  yoichiMoment: string;
  concernType: ConcernType | null;
  concernText: string;
  satisfaction: number;
  satisfactionReason: string;
  status: DailyStatus;
  mentorComment: string | null;
  submittedAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  revisionRequestedAt: string | null;
  revisionRequestedBy: string | null;
}

export interface DailyTodaySuccess {
  status: 'success';
  item: DailyEntry | null;
}

export interface DailySubmitPayload {
  movedMoment: string;
  learning: string;
  imitate: string;
  challengeMindset: string;
  challengeSkill: string;
  challengeAction: string;
  yoichiMoment: string;
  concernType?: ConcernType;
  concernText?: string;
  satisfaction: number;
  satisfactionReason: string;
}

export interface DailySubmitSuccess {
  status: 'success';
  item: DailyEntry;
}

export interface DailyListSuccess {
  status: 'success';
  items: DailyEntry[];
}

export interface DailyActionSuccess {
  status: 'success';
}

export interface DailyError {
  status: 'error';
  message: string;
  code?: 'AUTH_INVALID' | 'STAFF_NOT_FOUND' | 'STAFF_PENDING' | 'STAFF_SUSPENDED' | 'FORBIDDEN_ROLE'
    | 'DAILY_VALIDATION_ERROR' | 'DAILY_ALREADY_CONFIRMED' | 'DAILY_NOT_FOUND';
}

export const CONCERN_TYPE_LABELS: Record<ConcernType, string> = {
  question: '質問',
  consultation: '相談',
  trouble: '困っている',
  improvement: '改善提案',
};
