import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSubmissionQueue } from '../submission/queueStore';
import { resendItem, resendAll } from '../submission/orchestrator';
import { ENTITY_LABELS, type SubmissionEntity, type SubmissionItem } from '../submission/types';
import type { Screen } from '../App';
import styles from './PendingListScreen.module.css';

type Props = { go: (s: Screen) => void };

// 「編集」は現状Food Logのみ対応。将来他Entityを追加する際はここへ一行足すだけでよい。
const ENTITY_EDIT_ROUTES: Partial<Record<SubmissionEntity, (item: SubmissionItem) => Screen>> = {
  foodLog: (item) => ({ name: 'foodLog', editItemId: item.id }),
};

export default function PendingListScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef } = useAuth();
  const items = useSubmissionQueue((s) => s.items);
  const remove = useSubmissionQueue((s) => s.remove);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendingAll, setResendingAll] = useState(false);

  useEffect(() => {
    void useSubmissionQueue.getState().refresh();
  }, []);

  const sorted = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const handleResendOne = async (id: string) => {
    if (!idToken) return;
    setResendingId(id);
    try {
      await resendItem(id, idToken);
    } finally {
      setResendingId(null);
    }
  };

  const handleResendAll = async () => {
    if (!idToken) return;
    setResendingAll(true);
    try {
      await resendAll(idToken);
    } finally {
      setResendingAll(false);
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm('この保留中の記録を削除します。よろしいですか？（元に戻せません）')) return;
    void remove(id);
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => go({ name: 'home' })}>← 戻る</button>
        <span className={styles.headerTitle}>📤 保留中</span>
      </header>

      <main className={styles.main}>
        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>再ログインしてください</p>
            <div ref={signInContainerRef} />
          </div>
        )}

        {sorted.length === 0 ? (
          <p className={styles.emptyText}>保留中の記録はありません</p>
        ) : (
          <>
            <button
              className={styles.resendAllBtn}
              onClick={handleResendAll}
              disabled={!idToken || resendingAll}
            >
              {resendingAll ? '再送中…' : `すべて再送（${sorted.length}件）`}
            </button>

            <ul className={styles.list}>
              {sorted.map((item) => (
                <li key={item.id} className={styles.item}>
                  {item.photoThumbnail && (
                    <img src={item.photoThumbnail} alt="" className={styles.thumb} />
                  )}
                  <div className={styles.itemBody}>
                    <div className={styles.itemMeta}>
                      <span className={styles.entityBadge}>{ENTITY_LABELS[item.entity]}</span>
                      {item.displayDate && <span className={styles.itemDate}>{item.displayDate}</span>}
                    </div>
                    <p className={styles.itemTitle}>{item.title}</p>
                    {item.lastError && (
                      <p className={styles.itemReason}>🟡 {item.lastError.description}</p>
                    )}
                    {item.lastError && (
                      <details className={styles.detail}>
                        <summary>詳細</summary>
                        <p>コード: {item.lastError.code}</p>
                        {item.lastError.technicalDetail && <p>{item.lastError.technicalDetail}</p>}
                        <p>{new Date(item.lastError.timestamp).toLocaleString('ja-JP')}</p>
                      </details>
                    )}
                    <div className={styles.itemActions}>
                      <button
                        className={styles.actionBtn}
                        onClick={() => handleResendOne(item.id)}
                        disabled={!idToken || resendingId === item.id}
                      >
                        {resendingId === item.id ? '再送中…' : '再送'}
                      </button>
                      {ENTITY_EDIT_ROUTES[item.entity] && (
                        <button
                          className={styles.actionBtn}
                          onClick={() => go(ENTITY_EDIT_ROUTES[item.entity]!(item))}
                        >
                          編集
                        </button>
                      )}
                      <button className={styles.actionBtnDanger} onClick={() => handleDelete(item.id)}>
                        削除
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
