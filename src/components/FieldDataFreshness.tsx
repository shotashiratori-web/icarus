import type { PointerEvent as ReactPointerEvent } from 'react';
import type { RefreshState } from '../store/zukanFieldStore';
import styles from './FieldDataFreshness.module.css';

// フィールドマップの「いつ時点のデータか」表示（Field Map Stale Cache、2026-09-27）。
// 端末キャッシュを即表示しつつ裏で取り直す。取り直せない時は黙らず、何時点の表示かと次の操作を出す。
// 最新が取れている時は何も出さない

function formatAsOf(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ボトムシートのハンドル（peek）の中に置くため、押した時にシートの開閉ドラッグが始まらないようにする
const stop = (e: ReactPointerEvent) => e.stopPropagation();

type Props = {
  refreshState: RefreshState;
  dataAsOf: number | null;
  onRetry: () => void;
  onRelogin: () => void;
};

export default function FieldDataFreshness({ refreshState, dataAsOf, onRetry, onRelogin }: Props) {
  const asOf = formatAsOf(dataAsOf);
  const asOfText = asOf ? `（${asOf} 時点の表示）` : '';
  if (refreshState === 'refreshing') {
    return <p className={styles.muted} role="status">最新を確認中…</p>;
  }
  if (refreshState === 'authExpired') {
    return (
      <p className={styles.warn} role="status">
        ログインの有効期限が切れています{asOfText}
        <button type="button" className={styles.linkBtn} onPointerDown={stop} onClick={onRelogin}>ログインし直す</button>
      </p>
    );
  }
  if (refreshState === 'failed') {
    return (
      <p className={styles.warn} role="status">
        最新を取得できませんでした{asOfText}
        <button type="button" className={styles.linkBtn} onPointerDown={stop} onClick={onRetry}>再試行</button>
      </p>
    );
  }
  return null;
}
