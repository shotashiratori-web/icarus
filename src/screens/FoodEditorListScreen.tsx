import { useEffect, useMemo, useState } from 'react';
import { fetchAllFoods } from '../api/knowledgeApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { FoodEntity } from '../types/knowledge';
import type { Screen } from '../App';
import styles from './FoodEditorListScreen.module.css';

type Props = { go: (s: Screen) => void };
type LoadState = 'loading' | 'ready' | 'error';

export default function FoodEditorListScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [foods, setFoods] = useState<FoodEntity[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const load = async (token: string) => {
    setState('loading');
    try {
      const items = await fetchAllFoods(token);
      setFoods(items);
      setState('ready');
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
      setErrorMessage(e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました');
      setState('error');
    }
  };

  useEffect(() => {
    if (authState === 'ready' && idToken) void load(idToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, idToken]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return foods;
    return foods.filter((f) =>
      f.canonicalName.toLowerCase().includes(q) || f.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [foods, searchQuery]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
        <span className={styles.title}>Food Knowledge</span>
      </header>

      <main className={styles.main}>
        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインするとFood Knowledgeを編集できます</p>
            <div ref={signInContainerRef} />
          </div>
        )}

        {authState === 'ready' && (
          <button className={styles.addBtn} onClick={() => go({ name: 'foodEditorForm', mode: 'create' })}>
            + 新しいFoodを登録
          </button>
        )}

        {authState === 'ready' && state === 'loading' && (
          <p className={styles.hintText}>読み込み中…</p>
        )}

        {authState === 'ready' && state === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={() => idToken && load(idToken)}>再読み込み</button>
          </div>
        )}

        {state === 'ready' && (
          <>
            <input
              className={styles.searchInput}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="正式名称・別名で検索"
            />
            <p className={styles.count}>{filtered.length}件</p>

            {filtered.length === 0 && <p className={styles.empty}>該当するFoodがありません</p>}

            <div className={styles.list}>
              {filtered.map((food) => (
                <button
                  key={food.id}
                  className={styles.card}
                  onClick={() => go({ name: 'foodEditorForm', mode: 'edit', food })}
                >
                  <span className={styles.cardName}>{food.canonicalName}</span>
                  {food.aliases.length > 0 && (
                    <span className={styles.cardMeta}>別名: {food.aliases.join('、')}</span>
                  )}
                  {food.usableParts.length > 0 && (
                    <span className={styles.cardMeta}>利用部位: {food.usableParts.join('、')}</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
