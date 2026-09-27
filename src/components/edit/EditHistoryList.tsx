import { formatEditTime, formatEditValue } from '../../utils/editCore';
import styles from './edit.module.css';

// 編集履歴の表示（共通化 Audit §1「編集履歴」）。「いつ・誰が・どの経路で・項目：変更前 → 変更後」。
// 並び順・項目名の日本語化・経路の名前は各ドメインで決めて渡す（Field の履歴 API・Work の訂正履歴タブなど、
// 保存先が違っても同じ見た目にする）

export interface EditHistoryViewItem {
  id: string;
  editedAt: string; // ISO
  actorName: string;
  sourceLabel?: string; // 例: 詳細画面で編集／訂正／自動再計算
  reason?: string | null;
  changes: { label: string; old: string | null; new: string | null }[];
}

type Props = {
  items: EditHistoryViewItem[] | null;
  loading?: boolean;
  errorMessage?: string;
  emptyText?: string;
};

export default function EditHistoryList({ items, loading = false, errorMessage, emptyText = '編集履歴はまだありません' }: Props) {
  return (
    <div className={styles.box}>
      {loading && <p className={styles.muted}>読み込み中…</p>}
      {errorMessage && <p className={styles.error}>{errorMessage}</p>}
      {items && items.length === 0 && <p className={styles.muted}>{emptyText}</p>}
      {items && items.length > 0 && (
        <ol className={styles.historyList}>
          {items.map((it) => (
            <li key={it.id} className={styles.historyItem}>
              <p className={styles.muted}>
                {formatEditTime(it.editedAt)}・{it.actorName}{it.sourceLabel ? `・${it.sourceLabel}` : ''}
              </p>
              {it.reason && <p className={styles.bodyText}>{it.reason}</p>}
              <ul className={styles.changeList}>
                {it.changes.map((c, i) => (
                  <li key={`${c.label}-${i}`}>
                    <span className={styles.changeLabel}>{c.label}</span>
                    {formatEditValue(c.old)} → {formatEditValue(c.new)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
