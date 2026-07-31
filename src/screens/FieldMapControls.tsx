import type { TimeFilterKey } from '../utils/fieldTimeFilter';
import type { FieldSortMode } from '../store/zukanFieldStore';
import styles from './FieldMapControls.module.css';

type Props = {
  searchQuery: string;
  onSearchChange: (v: string) => void;

  kigoOptions: string[];
  kigoFilter: string;
  onKigoChange: (v: string) => void;

  timeFilter: TimeFilterKey;
  onTimeFilterChange: (k: TimeFilterKey) => void;
  yearOptions: string[];

  customDateStart: string;
  customDateEnd: string;
  onCustomDateChange: (start: string, end: string) => void;

  dimMode: boolean;
  onDimModeChange: (dim: boolean) => void;

  sortMode: FieldSortMode;
  onSortModeChange: (mode: FieldSortMode) => void;

  statusText: string;

  // 重複候補の表示・管理（管理者のみ）。duplicateCountが0またはundefinedなら何も表示しない
  duplicateCount?: number;
  showDupOnly?: boolean;
  onToggleShowDupOnly?: () => void;
  manageMode?: boolean;
  onToggleManageMode?: () => void;
};

const SORT_OPTIONS: { key: FieldSortMode; label: string }[] = [
  { key: 'addedDesc', label: '追加が新しい順' },
  { key: 'addedAsc', label: '追加が古い順' },
  { key: 'takenDesc', label: '撮影日時順' },
];

const TIME_PRESETS: { key: TimeFilterKey; label: string; star?: boolean }[] = [
  { key: 'last-year-same', label: '去年の同じ時期', star: true },
  { key: 'this-month', label: '今月' },
  { key: '7days', label: '過去7日' },
  { key: 'today', label: '今日' },
  { key: 'this-year', label: '今年' },
];

export default function FieldMapControls({
  searchQuery, onSearchChange,
  kigoOptions, kigoFilter, onKigoChange,
  timeFilter, onTimeFilterChange, yearOptions,
  customDateStart, customDateEnd, onCustomDateChange,
  dimMode, onDimModeChange,
  sortMode, onSortModeChange,
  statusText,
  duplicateCount, showDupOnly, onToggleShowDupOnly, manageMode, onToggleManageMode,
}: Props) {
  return (
    <div className={styles.root}>
      <div className={styles.searchBar}>
        <input
          className={styles.searchInput}
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="食材名・場所・メモ・季語で検索"
        />
      </div>

      <div className={styles.filterBar}>
        {TIME_PRESETS.map(({ key, label, star }) => (
          <button
            key={key}
            className={`${styles.fBtn} ${star ? styles.fBtnStar : ''} ${timeFilter === key ? styles.fBtnActive : ''}`}
            onClick={() => onTimeFilterChange(key)}
          >
            {label}
          </button>
        ))}
        {yearOptions.map((y) => (
          <button
            key={y}
            className={`${styles.fBtn} ${timeFilter === `year-${y}` ? styles.fBtnActive : ''}`}
            onClick={() => onTimeFilterChange(`year-${y}`)}
          >
            {y}
          </button>
        ))}
        <button
          className={`${styles.fBtn} ${timeFilter === 'custom' ? styles.fBtnActive : ''}`}
          onClick={() => onTimeFilterChange('custom')}
        >
          期間指定
        </button>
        <button
          className={`${styles.fBtn} ${timeFilter === 'all' ? styles.fBtnActive : ''}`}
          onClick={() => onTimeFilterChange('all')}
        >
          すべて
        </button>
      </div>

      {timeFilter === 'custom' && (
        <div className={styles.customDateBar}>
          <input
            className={styles.dateInput}
            type="date"
            value={customDateStart}
            onChange={(e) => onCustomDateChange(e.target.value, customDateEnd)}
          />
          <span className={styles.dateSep}>〜</span>
          <input
            className={styles.dateInput}
            type="date"
            value={customDateEnd}
            onChange={(e) => onCustomDateChange(customDateStart, e.target.value)}
          />
        </div>
      )}

      {kigoOptions.length > 0 && (
        <div className={styles.kigoBar}>
          <button className={`${styles.kBtn} ${!kigoFilter ? styles.kBtnActive : ''}`} onClick={() => onKigoChange('')}>
            すべて
          </button>
          {kigoOptions.map((k) => (
            <button key={k} className={`${styles.kBtn} ${kigoFilter === k ? styles.kBtnActive : ''}`} onClick={() => onKigoChange(k)}>
              {k}
            </button>
          ))}
        </div>
      )}

      <div className={styles.dimToggle}>
        <button className={`${styles.dBtn} ${dimMode ? styles.dBtnActive : ''}`} onClick={() => onDimModeChange(true)}>
          対象外も薄く表示
        </button>
        <button className={`${styles.dBtn} ${!dimMode ? styles.dBtnActive : ''}`} onClick={() => onDimModeChange(false)}>
          対象外を非表示
        </button>
      </div>

      <div className={styles.sortBar}>
        {SORT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            className={`${styles.fBtn} ${sortMode === key ? styles.fBtnActive : ''}`}
            onClick={() => onSortModeChange(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {!!duplicateCount && duplicateCount > 0 && (
        <div className={styles.dupBar}>
          <span className={styles.dupBarText}>重複候補 {duplicateCount}件</span>
          <button className={styles.dupBarBtn} onClick={onToggleShowDupOnly}>
            {showDupOnly ? 'すべて表示' : '重複候補のみ表示'}
          </button>
          <button className={styles.dupBarBtn} onClick={onToggleManageMode}>
            {manageMode ? '選択をやめる' : '選択して削除'}
          </button>
        </div>
      )}

      <div className={styles.status}>{statusText}</div>
    </div>
  );
}
