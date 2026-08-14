import { useEffect, useMemo, useState } from 'react';
import { fetchFieldFoods } from '../api/fieldFoodApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { FieldFoodListItem } from '../types/fieldFood';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import styles from './FoodEncyclopediaListScreen.module.css';

type Props = { go: (s: Screen) => void };
type LoadState = 'loading' | 'ready' | 'error';

// 分類は「植物/山菜」のように大分類・小分類を合わせて表示する。
// 競合（同一foodで実分類が複数）がある場合は多数決で確定せず、確認を促す表示にする
function classificationLabel(item: FieldFoodListItem): string {
  if (item.classificationConflict) return '分類確認が必要';
  if (!item.largeCategory) return '未分類';
  return item.subCategory ? `${item.largeCategory} / ${item.subCategory}` : item.largeCategory;
}

export default function FoodEncyclopediaListScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [items, setItems] = useState<FieldFoodListItem[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [largeCategoryFilter, setLargeCategoryFilter] = useState('');

  const load = async (token: string) => {
    setState('loading');
    try {
      const result = await fetchFieldFoods({}, token);
      setItems(result.items);
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

  const largeCategoryOptions = useMemo(() => {
    const set = new Set(items.map((i) => i.largeCategory).filter((v): v is string => Boolean(v)));
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((i) => {
      if (largeCategoryFilter && i.largeCategory !== largeCategoryFilter) return false;
      if (!q) return true;
      return i.foodName.toLowerCase().includes(q);
    });
    // APIの既定sort（lastObservedDate DESC）を維持する
  }, [items, searchQuery, largeCategoryFilter]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'zukan' })}>← 図鑑</button>
        <span className={styles.title}>🍅 食材</span>
        <HomeButton go={go} />
      </header>

      <main className={styles.main}>
        {(authState === 'checking' || (authState === 'ready' && state === 'loading')) && (
          <div className={styles.skeletonGrid}>
            {[0, 1, 2, 3].map((i) => (<div key={i} className={styles.skeletonCard} />))}
          </div>
        )}

        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインすると食材図鑑を確認できます</p>
            <div ref={signInContainerRef} />
          </div>
        )}

        {authState === 'ready' && state === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={() => idToken && load(idToken)}>再読み込み</button>
          </div>
        )}

        {state === 'ready' && (
          <>
            <div className={styles.filters}>
              <input
                className={styles.searchInput}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="食材名で検索"
              />
            </div>

            {largeCategoryOptions.length > 0 && (
              <div className={styles.kigoBar}>
                <button className={`${styles.kBtn} ${!largeCategoryFilter ? styles.kBtnActive : ''}`} onClick={() => setLargeCategoryFilter('')}>
                  すべて
                </button>
                {largeCategoryOptions.map((c) => (
                  <button key={c} className={`${styles.kBtn} ${largeCategoryFilter === c ? styles.kBtnActive : ''}`} onClick={() => setLargeCategoryFilter(c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}

            <p className={styles.count}>{filtered.length}件</p>

            {filtered.length === 0 && <p className={styles.empty}>該当する食材がありません</p>}

            <div className={styles.grid}>
              {filtered.map((food) => (
                <button
                  key={food.foodName}
                  className={styles.card}
                  onClick={() => go({ name: 'foodEncyclopediaDetail', foodName: food.foodName })}
                >
                  <div className={styles.photoWrap}>
                    {food.representativePhotoUrl
                      ? <img className={styles.photo} src={food.representativePhotoUrl} alt={food.foodName} loading="lazy" />
                      : <div className={styles.photoPlaceholder}>🍅</div>}
                  </div>
                  <div className={styles.cardBody}>
                    <span className={styles.foodName}>{food.foodName}</span>
                    <span className={styles.tag}>{classificationLabel(food)}</span>
                    <span className={styles.metaRow}>
                      <span>観察{food.observationCount}件</span>
                      <span>最終観察 {food.lastObservedDate}</span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
