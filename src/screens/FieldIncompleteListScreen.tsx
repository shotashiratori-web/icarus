import { useEffect, useMemo, useState } from 'react';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import { isRecordIncomplete, missingFieldsOf, type MissingField } from '../utils/fieldIncomplete';
import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
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
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

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

      <main className={styles.main}>
        {loadState === 'loading' && <div className={styles.loading}>読み込み中…</div>}

        {loadState === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={() => reload()}>再読み込み</button>
          </div>
        )}

        {loadState === 'ready' && filteredEntries.length === 0 && (
          <p className={styles.empty}>該当する記録はありません。整理済みです。</p>
        )}

        {loadState === 'ready' && filteredEntries.length > 0 && (
          <div className={styles.list}>
            {filteredEntries.map((entry) => {
              const missing = missingFieldsOf(entry);
              return (
                <button key={entry.id} className={styles.card} onClick={() => openDetail(entry)}>
                  <div className={styles.photoWrap}>
                    {entry.photoUrl
                      ? <img className={styles.photo} src={entry.photoUrl} alt={entry.foodName} loading="lazy" />
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
