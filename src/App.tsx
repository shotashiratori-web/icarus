import { lazy, Suspense, useState } from 'react';
import HomeScreen from './screens/HomeScreen';
import RecordScreen from './screens/RecordScreen';
import ReviewDetailScreen from './screens/ReviewDetailScreen';
import NoteListScreen from './screens/NoteListScreen';
import FoodLogScreen from './screens/FoodLogScreen';
import FieldScreen from './screens/FieldScreen';
import ProcessingScreen from './screens/ProcessingScreen';
import WorkDetailScreen from './screens/WorkDetailScreen';
import WorkFormScreen from './screens/WorkFormScreen';
import PendingApprovalScreen from './screens/PendingApprovalScreen';
import StaffApprovalScreen from './screens/StaffApprovalScreen';
import DailySubmitScreen from './screens/DailySubmitScreen';
import DailyAdminListScreen from './screens/DailyAdminListScreen';
import ZukanTopScreen from './screens/ZukanTopScreen';
import ZukanFieldDetailScreen from './screens/ZukanFieldDetailScreen';
import { AuthProvider, useAuth } from './context/AuthContext';
import type { FieldLogEntry } from './types/zukan';

// leafletはフィールドマップを開くまで読み込まない（バンドルサイズ抑制のため動的import）
const ZukanFieldMapScreen = lazy(() => import('./screens/ZukanFieldMapScreen'));

const mapLoadingFallback = (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>読み込み中…</div>
);

export type Screen =
  | { name: 'home' }
  | { name: 'record'; noteId: string | null }
  | { name: 'review'; noteId: string }
  | { name: 'list' }
  | { name: 'foodLog' }
  | { name: 'field' }
  | { name: 'processing' }
  | { name: 'workDetail'; workId: string }
  | { name: 'workForm'; mode: 'create' }
  | { name: 'workForm'; mode: 'append'; workId: string; workTitle?: string }
  | { name: 'staffApproval' }
  | { name: 'daily' }
  | { name: 'dailyAdmin' }
  | { name: 'zukan' }
  // マップは唯一の入口（フィールドマップ統一方針）。詳細画面同様「どこから来たか」を持つハブ構造で、
  // 将来AI検索・関連料理等の入口が増えても、戻る操作は常にfromへ辿るだけで済む（Phase7A-2/7C要件）。
  | { name: 'zukanFieldMap'; focusEntry?: FieldLogEntry; from: Screen }
  | { name: 'zukanFieldDetail'; entry: FieldLogEntry; from: Screen };

function AppRoutes() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const { authState, staffMe } = useAuth();

  const go = (s: Screen) => setScreen(s);

  // 優先順位: Loading（checking） → SignedOut → PendingApproval → 既存画面
  // checking/signedOut は各画面が個別に処理する既存の慣例をそのまま活かし、
  // ready かつ staffMe を取得済みで active でない場合のみ、どの画面よりも優先して割り込む。
  if (authState === 'ready' && staffMe && staffMe.staffStatus !== 'active') {
    return <PendingApprovalScreen status={staffMe.staffStatus} />;
  }

  if (screen.name === 'home')       return <HomeScreen go={go} />;
  if (screen.name === 'record')     return <RecordScreen noteId={screen.noteId} go={go} />;
  if (screen.name === 'review')     return <ReviewDetailScreen noteId={screen.noteId} go={go} />;
  if (screen.name === 'list')       return <NoteListScreen go={go} />;
  if (screen.name === 'foodLog')    return <FoodLogScreen go={go} />;
  if (screen.name === 'field')      return <FieldScreen go={go} />;
  if (screen.name === 'processing') return <ProcessingScreen go={go} />;
  if (screen.name === 'workDetail') return <WorkDetailScreen go={go} workId={screen.workId} />;
  if (screen.name === 'workForm')   return (
    <WorkFormScreen
      go={go}
      mode={screen.mode}
      workId={screen.mode === 'append' ? screen.workId : undefined}
      workTitle={screen.mode === 'append' ? screen.workTitle : undefined}
    />
  );
  if (screen.name === 'staffApproval') return <StaffApprovalScreen go={go} />;
  if (screen.name === 'daily') return <DailySubmitScreen go={go} />;
  if (screen.name === 'dailyAdmin') return <DailyAdminListScreen go={go} />;
  if (screen.name === 'zukan') return <ZukanTopScreen go={go} />;
  if (screen.name === 'zukanFieldMap') return (
    <Suspense fallback={mapLoadingFallback}>
      <ZukanFieldMapScreen go={go} focusEntry={screen.focusEntry} from={screen.from} />
    </Suspense>
  );
  if (screen.name === 'zukanFieldDetail') return <ZukanFieldDetailScreen go={go} entry={screen.entry} from={screen.from} />;

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
