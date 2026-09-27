import styles from './edit.module.css';

// 409（他の人が先に保存した）の後に出すバナー（共通化 Audit §1「競合」）。
// 画面側は rebaseByKeys で最新を取り込み、自分が変えた項目（mine）と両方が変えた項目（overlap）を渡す。
// 自動では再保存しない前提の文言

type Props = {
  mineLabels: string[];
  overlapLabels: string[];
};

export default function ConflictBanner({ mineLabels, overlapLabels }: Props) {
  return (
    <div className={styles.conflictBanner} role="alert">
      <p className={styles.conflictTitle}>他の人が先にこの記録を更新しました</p>
      <p className={styles.bodyText}>
        最新の内容を読み込みました。
        {mineLabels.length > 0 && `あなたが変更した項目（${mineLabels.join('・')}）はそのまま残しています。`}
        確認して、もう一度保存してください。
      </p>
      {overlapLabels.length > 0 && (
        <p className={styles.bodyText}>
          {overlapLabels.join('・')}は他の人も変更しています。保存するとあなたの値で置き換わります。
        </p>
      )}
    </div>
  );
}
