import type { ReactNode } from 'react';
import styles from './edit.module.css';

// 編集中のフッター（共通化 Audit §1「保存フッター」）。Field の詳細編集と同じ体験:
// 「変更する項目: …」を出し、変更が無ければ「変更なし（閉じる）」、未保存で戻ろうとしたら確認を出す。
// 保存・確認の処理そのものは画面側が持つ（この部品は表示だけ）

type Props = {
  changedLabels: string[];
  isSaving: boolean;
  canSave?: boolean; // 入力エラーがある時は false
  errorMessage?: string;
  onSave: () => void;
  onClose?: () => void; // 変更が無い時の「変更なし（閉じる）」。未指定なら onSave を呼ぶ
  showUnsavedConfirm?: boolean;
  onContinueEditing?: () => void;
  onDiscard?: () => void;
  children?: ReactNode; // 下書き保存できない警告など、ドメイン固有の注意書き
};

export default function EditFooter({
  changedLabels, isSaving, canSave = true, errorMessage, onSave, onClose,
  showUnsavedConfirm = false, onContinueEditing, onDiscard, children,
}: Props) {
  const hasChanges = changedLabels.length > 0;
  if (showUnsavedConfirm) {
    return (
      <div className={styles.footer}>
        <p className={styles.confirmText}>保存されていない変更があります</p>
        <div className={styles.btnRow}>
          <button type="button" className={styles.secondaryBtn} onClick={onContinueEditing}>編集を続ける</button>
          <button type="button" className={styles.dangerBtn} onClick={onDiscard}>変更を破棄する</button>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.footer}>
      {children}
      {hasChanges && <p className={styles.hint}>変更する項目: {changedLabels.join('・')}</p>}
      {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
      <button
        type="button"
        className={styles.primaryBtn}
        disabled={isSaving || !canSave}
        onClick={hasChanges ? onSave : (onClose ?? onSave)}
      >
        {isSaving ? '保存中…' : hasChanges ? '保存' : '変更なし（閉じる）'}
      </button>
    </div>
  );
}
