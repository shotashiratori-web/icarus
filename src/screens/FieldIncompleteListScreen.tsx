import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import { isRecordIncomplete, missingFieldsOf, type MissingField } from '../utils/fieldIncomplete';
import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import FieldBulkEditPanel from '../components/FieldBulkEditPanel';
import { BULK_EDIT_MAX_ENTRIES } from '../types/fieldEntryEdit';
import styles from './FieldIncompleteListScreen.module.css';

type Props = { go: (s: Screen) => void; from: Screen };
type FilterKey = 'all' | MissingField;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'place', label: '場所未入力' },
  { key: 'memo', label: 'メモ未入力' },
];

export default function FieldIncompleteListScreen({ go, from }: Props) {
  const { entries, loadState, errorMessage, ensureLoaded, reload } = useZukanFieldStore();
  const { idToken, staffMe } = useAuth();
  const [filter, setFilter] = useState<FilterKey>('all');
  // まとめて編集（Editing & Classification）。active staff以上。通常のタップ→詳細の使い方はそのまま残す
  const canBulkEdit = staffMe?.staffStatus === 'active';
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // まとめて編集を開いた時点の対象。保存後に選択が外れたり一覧から消えたりしても、結果画面を出し続けるため固定する
  const [bulkTargets, setBulkTargets] = useState<FieldLogEntry[] | null>(null);
  const bulkOpen = bulkTargets !== null;

  useEffect(() => {
    if (!idToken) return;
    void ensureLoaded(idToken);
  }, [ensureLoaded, idToken]);

  const incompleteEntries = useMemo(
    () => entries.filter(isRecordIncomplete).sort((a, b) => a.date.localeCompare(b.date)),
    [entries],
  );

  const filteredEntries = useMemo(() => {
    if (filter === 'all') return incompleteEntries;
    return incompleteEntries.filter((e) => missingFieldsOf(e).includes(filter));
  }, [incompleteEntries, filter]);

  const openDetail = (entry: FieldLogEntry) => {
    go({ name: 'zukanFieldDetail', entry, from: { name: 'fieldIncompleteList', from } });
  };

  const toggleSelected = (eventId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId); else next.add(eventId);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkTargets(null);
  };

  // 選択は表示中の絞り込みに関係なく保持する。まとめて編集の対象は選択した記録（EventIDのある記録のみ選べる）
  const selectedEntries = useMemo(
    () => incompleteEntries.filter((e) => selectedIds.has(e.eventId)),
    [incompleteEntries, selectedIds],
  );
  const selectableShown = filteredEntries.filter((e) => !!e.eventId);
  const allShownSelected = selectableShown.length > 0 && selectableShown.every((e) => selectedIds.has(e.eventId));

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go(from)}>← 戻る</button>
        <span className={styles.title}>📝 記録の補完</span>
        <HomeButton go={go} />
      </header>

      <div className={styles.filterRow}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={filter === f.key ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className={styles.countText}>
        {filter === 'all' ? 'すべて' : FILTERS.find((f) => f.key === filter)?.label} {filteredEntries.length}件 · 古い順
      </p>

      {canBulkEdit && loadState === 'ready' && incompleteEntries.length > 0 && (
        <div className={styles.selectBar}>
          {selectMode ? (
            <>
              <span className={styles.selectCount}>{selectedIds.size}件選択中</span>
              <button
                className={styles.selectBtn}
                onClick={() => setSelectedIds((prev) => {
                  const next = new Set(prev);
                  for (const e of selectableShown) {
                    if (allShownSelected) next.delete(e.eventId); else next.add(e.eventId);
                  }
                  return next;
                })}
                disabled={bulkOpen}
              >
                {allShownSelected ? '表示中の選択を外す' : '表示中をすべて選ぶ'}
              </button>
              <button
                className={styles.bulkBtn}
                onClick={() => setBulkTargets(selectedEntries)}
                disabled={bulkOpen || selectedIds.size === 0 || selectedIds.size > BULK_EDIT_MAX_ENTRIES}
              >
                まとめて編集
              </button>
              <button className={styles.selectBtn} onClick={exitSelectMode}>終了</button>
            </>
          ) : (
            <button className={styles.selectBtn} onClick={() => setSelectMode(true)}>複数選択</button>
          )}
          {selectedIds.size > BULK_EDIT_MAX_ENTRIES && (
            <span className={styles.selectLimit}>一度にまとめて編集できるのは{BULK_EDIT_MAX_ENTRIES}件までです</span>
          )}
        </div>
      )}

      <main className={styles.main}>
        {loadState === 'loading' && <div className={styles.loading}>読み込み中…</div>}

        {loadState === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={() => idToken && reload(idToken)}>再読み込み</button>
          </div>
        )}

        {loadState === 'ready' && filteredEntries.length === 0 && (
          <p className={styles.empty}>該当する記録はありません。整理済みです。</p>
        )}

        {bulkTargets && (
          <FieldBulkEditPanel
            entries={bulkTargets}
            onClose={() => setBulkTargets(null)}
            onSucceeded={(ids) => setSelectedIds((prev) => {
              const next = new Set(prev);
              for (const id of ids) next.delete(id);
              return next;
            })}
          />
        )}

        {loadState === 'ready' && filteredEntries.length > 0 && !bulkOpen && (
          <div className={styles.list}>
            {filteredEntries.map((entry) => {
              const missing = missingFieldsOf(entry);
              return (
                <button
                  key={entry.id}
                  className={selectMode && selectedIds.has(entry.eventId) ? styles.cardSelected : styles.card}
                  onClick={() => (selectMode ? entry.eventId && toggleSelected(entry.eventId) : openDetail(entry))}
                  aria-pressed={selectMode ? selectedIds.has(entry.eventId) : undefined}
                  disabled={selectMode && !entry.eventId}
                >
                  {selectMode && (
                    <input
                      type="checkbox"
                      className={styles.cardCheck}
                      checked={selectedIds.has(entry.eventId)}
                      readOnly
                      tabIndex={-1}
                      aria-label={`${entry.foodName}を選ぶ`}
                    />
                  )}
                  <div className={styles.photoWrap}>
                    {entry.photoUrl
                      ? <img className={styles.photo} src={entry.thumbnailUrl || entry.photoUrl} alt={entry.foodName} loading="lazy" />
                      : <div className={styles.photoPlaceholder}>写真なし</div>}
                  </div>
                  <div className={styles.cardBody}>
                    <span className={styles.foodName}>{entry.foodName}</span>
                    <span className={styles.metaRow}>
                      <span className={styles.place}>📍 {entry.place || '場所不明'}</span>
                      <span className={styles.date}>{entry.date}</span>
                    </span>
                    {entry.memo && <span className={styles.memoPreview}>{entry.memo.slice(0, 40)}</span>}
                    <span className={styles.badgeRow}>
                      {missing.includes('place') && <span className={styles.badge}>場所</span>}
                      {missing.includes('memo') && <span className={styles.badge}>メモ</span>}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
