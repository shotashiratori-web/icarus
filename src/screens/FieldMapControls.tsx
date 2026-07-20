import type { TimeFilterKey } from '../utils/fieldTimeFilter';
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

  statusText: string;
};

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
  statusText,
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

      <div className={styles.status}>{statusText}</div>
    </div>
  );
}
