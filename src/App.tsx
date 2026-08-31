import { lazy, Suspense, useEffect, useState } from 'react';
import HomeScreen from './screens/HomeScreen';
import RecordScreen from './screens/RecordScreen';
import ReviewDetailScreen from './screens/ReviewDetailScreen';
import NoteListScreen from './screens/NoteListScreen';
import FoodLogScreen from './screens/FoodLogScreen';
import PendingListScreen from './screens/PendingListScreen';
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
import WineListScreen from './screens/WineListScreen';
import WineDetailScreen from './screens/WineDetailScreen';
import WineFormScreen from './screens/WineFormScreen';
import SpotListScreen from './screens/SpotListScreen';
import SpotDetailScreen from './screens/SpotDetailScreen';
import SpotFormScreen from './screens/SpotFormScreen';
import MetaDebugScreen from './screens/MetaDebugScreen';
import PhotoBulkUploadScreen from './screens/PhotoBulkUploadScreen';
import PhotoHashRepairScreen from './screens/PhotoHashRepairScreen';
import FieldIncompleteListScreen from './screens/FieldIncompleteListScreen';
import FieldBulkOrganizeScreen from './screens/FieldBulkOrganizeScreen';
import FoodEncyclopediaListScreen from './screens/FoodEncyclopediaListScreen';
import FoodEncyclopediaDetailScreen from './screens/FoodEncyclopediaDetailScreen';
import ProcessEditorScreen from './screens/ProcessEditorScreen';
import FoodEditorListScreen from './screens/FoodEditorListScreen';
import FoodEditorFormScreen from './screens/FoodEditorFormScreen';
import { AuthProvider, useAuth } from './context/AuthContext';
import { saveCurrentScreen, loadStoredScreen } from './utils/screenPersistence';
import { retryPendingWineTastingNotes } from './submission/wineTastingNoteSync';
import { retryPendingWineTastingNotePhotos } from './submission/wineTastingNotePhotoSync';
import './submission/adapters';
import type { FieldLogEntry } from './types/zukan';
import type { WineEntity } from './types/wineEntity';
import type { SpotEntity } from './types/spotEntity';
import type { FoodEntity } from './types/knowledge';

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
  | { name: 'foodLog'; editItemId?: string }
  // Submission Framework v1: 保留（送信できず再送待ち）の記録一覧。入口はHomeScreenの保留サマリー
  | { name: 'pendingList' }
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
  | { name: 'zukanFieldDetail'; entry: FieldLogEntry; from: Screen }
  // Phase8: Wine Entity（Icarus最初の正式Entity。Food/Process/Dish/Producer等の将来Entityも同じ形の画面になる想定）
  | { name: 'wineList' }
  | { name: 'wineForm'; mode: 'create' }
  | { name: 'wineForm'; mode: 'edit'; wine: WineEntity }
  // Phase9: ワイン図鑑（閲覧専用）。今回は入口が一覧のみのため、フィールド詳細のような再帰from構造は持たない
  | { name: 'wineDetail'; entry: WineEntity }
  // Spot Entity（管理画面のみ。Spot図鑑〈閲覧UI〉は次Phase。入口はHomeScreenのadmin向けnavRow）
  | { name: 'spotList' }
  // initial: フィールドログ整理画面等から、GPS・写真をあらかじめ入れた状態でスポット登録を始めるための任意項目
  // from: 保存・戻る操作時にスポット一覧ではなくここへ戻す（未指定時は従来どおりスポット一覧）
  | { name: 'spotForm'; mode: 'create'; initial?: { lat?: number; lng?: number; photoUrl?: string }; from?: Screen }
  | { name: 'spotForm'; mode: 'edit'; spot: SpotEntity }
  | { name: 'spotDetail'; entry: SpotEntity }
  // 画像メタデータ調査用デバッグ画面。認証不要・データ送信なし（?debug=metaで直接開ける）
  | { name: 'metaDebug' }
  // PC一括写真送信。食材名等は入力せず写真だけを既存Food Log経路へ送る（未整理として後から編集）
  | { name: 'photoBulkUpload' }
  | { name: 'photoHashRepair' }
  // Phase2 Unit F｜未整理フィールドログ整理。グループB（食材名あり・場所orメモ未入力）の一覧
  | { name: 'fieldIncompleteList'; from: Screen }
  // グループA（食材名未入力＝一括写真整理待ち）の連続整理
  | { name: 'fieldBulkOrganize'; from: Screen }
  // Phase3: 食材図鑑（field_log_entriesをfoodでGROUP BYした読み取り専用一覧。Unit W1）
  | { name: 'foodEncyclopediaList' }
  // Phase3: 食材図鑑詳細（Unit W3）。foodNameは日本語・括弧・記号を含みうるためURL pathへは埋め込まない
  | { name: 'foodEncyclopediaDetail'; foodName: string }
  // Stage 3: Composite API（POST /knowledge/processes）用のAdmin専用Editor。入口はHomeScreenのadmin向けnavRow
  | { name: 'processEditor' }
  // Food Editor MVP: Food Identity（canonical_name/aliases/usableParts/description）をAdminが登録・編集する
  | { name: 'foodEditorList' }
  | { name: 'foodEditorForm'; mode: 'create' }
  | { name: 'foodEditorForm'; mode: 'edit'; food: FoodEntity };

function initialScreen(): Screen {
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'meta') {
    return { name: 'metaDebug' };
  }
  return loadStoredScreen() ?? { name: 'home' };
}

function AppRoutes() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const { authState, idToken, staffMe } = useAuth();

  // リロードで現在の画面へ戻れるよう、遷移のたびにsessionStorageへ保存する
  const go = (s: Screen) => {
    setScreen(s);
    saveCurrentScreen(s);
  };

  // Tasting Note Persistence v1（Stage 1B）完成条件12 + stale syncing recovery:
  // アプリ起動時（ログイン確立時）はlocal/failedに加えsyncingも再送対象に含める——新しいApp
  // instanceが起動した時点で、前回instanceのnetwork requestは進行中として信用できないため。
  // online復帰時は同一instance内の進行中requestとの二重送信を避けるためsyncingは含めない。
  // 専用エンジンは作らず既存Submission Frameworkを再利用する
  useEffect(() => {
    if (authState !== 'ready' || !idToken) return;
    void (async () => {
      // Stage 1D-B: 写真retryは本文retryの後（本文が先、Stage 25）。d1_note_id未確定のNoteは
      // 写真retry-scan側で自然にskipされるため、ここでは単に順序だけを守ればよい
      await retryPendingWineTastingNotes(idToken, { includeSyncing: true });
      await retryPendingWineTastingNotePhotos(idToken, { includeUploading: true });
    })();
  }, [authState, idToken]);

  useEffect(() => {
    if (authState !== 'ready' || !idToken) return;
    const onOnline = () => {
      void (async () => {
        await retryPendingWineTastingNotes(idToken);
        await retryPendingWineTastingNotePhotos(idToken);
      })();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [authState, idToken]);

  // メタデータ調査画面は認証不要・データ送信なしのため、承認ゲートより先に描画する
  if (screen.name === 'metaDebug') return <MetaDebugScreen go={go} />;

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
  if (screen.name === 'foodLog')    return <FoodLogScreen go={go} editItemId={screen.editItemId} />;
  if (screen.name === 'pendingList') return <PendingListScreen go={go} />;
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
  if (screen.name === 'wineList') return <WineListScreen go={go} />;
  if (screen.name === 'wineDetail') return <WineDetailScreen go={go} entry={screen.entry} />;
  if (screen.name === 'wineForm') return screen.mode === 'edit'
    ? <WineFormScreen go={go} mode="edit" wine={screen.wine} />
    : <WineFormScreen go={go} mode="create" />;
  if (screen.name === 'spotList') return <SpotListScreen go={go} />;
  if (screen.name === 'spotDetail') return <SpotDetailScreen go={go} entry={screen.entry} />;
  if (screen.name === 'spotForm') return screen.mode === 'edit'
    ? <SpotFormScreen go={go} mode="edit" spot={screen.spot} />
    : <SpotFormScreen go={go} mode="create" initial={screen.initial} from={screen.from} />;
  if (screen.name === 'photoBulkUpload') return <PhotoBulkUploadScreen go={go} />;
  if (screen.name === 'photoHashRepair') return <PhotoHashRepairScreen go={go} />;
  if (screen.name === 'fieldIncompleteList') return <FieldIncompleteListScreen go={go} from={screen.from} />;
  if (screen.name === 'fieldBulkOrganize') return <FieldBulkOrganizeScreen go={go} from={screen.from} />;
  if (screen.name === 'foodEncyclopediaList') return <FoodEncyclopediaListScreen go={go} />;
  if (screen.name === 'foodEncyclopediaDetail') return <FoodEncyclopediaDetailScreen go={go} foodName={screen.foodName} />;
  if (screen.name === 'processEditor') return <ProcessEditorScreen go={go} />;
  if (screen.name === 'foodEditorList') return <FoodEditorListScreen go={go} />;
  if (screen.name === 'foodEditorForm') return screen.mode === 'edit'
    ? <FoodEditorFormScreen go={go} mode="edit" food={screen.food} />
    : <FoodEditorFormScreen go={go} mode="create" />;

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
