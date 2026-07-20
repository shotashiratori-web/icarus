import { useState } from 'react';
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
import { AuthProvider, useAuth } from './context/AuthContext';

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
  | { name: 'dailyAdmin' };

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

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
