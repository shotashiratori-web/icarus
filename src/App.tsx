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
  | { name: 'workForm'; mode: 'append'; workId: string; workTitle?: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  const go = (s: Screen) => setScreen(s);

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

  return null;
}
