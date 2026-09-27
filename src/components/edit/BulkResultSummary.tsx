import type { ReactNode } from 'react';
import type { BulkOutcomeSummary } from '../../utils/editCore';
import styles from './edit.module.css';

// まとめて編集の結果（共通化 Audit §1）。成功○件／競合○件／失敗○件と、競合・失敗した記録の一覧。
// 記録を人が見分ける表示（写真・時刻・名前など）はドメインから renderIdentity で受け取る（ID は人向けに出さない）。
// 部分成功は正常な結果。競合した記録だけやり直せる

type Props = {
  summary: BulkOutcomeSummary;
  renderIdentity: (id: string) => ReactNode;
  onRetryConflicted?: () => void;
  onClose: () => void;
  title?: string;
};

export default function BulkResultSummary({ summary, renderIdentity, onRetryConflicted, onClose, title = 'まとめて編集の結果' }: Props) {
  return (
    <section className={styles.panel} aria-label={title}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.counts}>
        <span className={styles.countOk}>成功 {summary.succeeded.length}件</span>
        <span className={summary.conflicted.length > 0 ? styles.countWarn : styles.countZero}>競合 {summary.conflicted.length}件</span>
        <span className={summary.failed.length > 0 ? styles.countWarn : styles.countZero}>失敗 {summary.failed.length}件</span>
      </p>
      {summary.noChange.length > 0 && (
        <p className={styles.muted}>成功のうち{summary.noChange.length}件は、すでに同じ値だったため変更はありません。</p>
      )}
      {summary.conflicted.length > 0 && (
        <div className={styles.problemBox}>
          <p className={styles.problemTitle}>他の人が先に更新していた記録（この記録には何も書いていません）</p>
          <ul className={styles.problemList}>
            {summary.conflicted.map((c) => <li key={c.id}>{renderIdentity(c.id)}</li>)}
          </ul>
          {onRetryConflicted && (
            <button type="button" className={styles.primaryBtn} onClick={onRetryConflicted}>
              競合した{summary.conflicted.length}件だけ、最新の内容でやり直す
            </button>
          )}
        </div>
      )}
      {summary.failed.length > 0 && (
        <div className={styles.problemBox}>
          <p className={styles.problemTitle}>保存できなかった記録</p>
          <ul className={styles.problemList}>
            {summary.failed.map((f) => (
              <li key={f.id}>
                {renderIdentity(f.id)}
                {f.message && <span className={styles.problemReason}>{f.message}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" className={styles.secondaryBtn} onClick={onClose}>閉じる</button>
    </section>
  );
}
