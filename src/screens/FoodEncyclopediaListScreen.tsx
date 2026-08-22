import { useEffect, useMemo, useRef } from 'react';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import { useFoodEncyclopediaListStore } from '../store/foodEncyclopediaListStore';
import type { FieldFoodListItem } from '../types/fieldFood';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import styles from './FoodEncyclopediaListScreen.module.css';

type Props = { go: (s: Screen) => void };

// 分類は「植物/山菜」のように大分類・小分類を合わせて表示する。
// 競合（同一foodで実分類が複数）がある場合は多数決で確定せず、確認を促す表示にする
function classificationLabel(item: FieldFoodListItem): string {
  if (item.classificationConflict) return '分類確認が必要';
  if (!item.largeCategory) return '未分類';
  return item.subCategory ? `${item.largeCategory} / ${item.subCategory}` : item.largeCategory;
}

export default function FoodEncyclopediaListScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const {
    items, loadState: state, errorMessage, searchQuery, largeCategoryFilter, scrollPosition,
    setSearchQuery, setLargeCategoryFilter, setScrollPosition, ensureLoaded, retry,
  } = useFoodEncyclopediaListStore();

  // Detail往復（Food Input Cross Navigationでの複数Detail経由を含む）では再fetchせず、
  // 保持済みのitems・検索/絞り込み状態をそのまま表示する（UX-006対応）
  useEffect(() => {
    if (authState === 'ready' && idToken) {
      ensureLoaded(idToken).catch((e) => {
        if (e instanceof TokenExpiredError) handleTokenExpired();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, idToken]);

  // Detail往復後、一覧がready（=filtered結果も同じ描画で確定済み）になった直後に
  // 保存済みscroll位置を1回だけ復元する。ZukanFieldMapScreenのlistScrollTop復元と同じ方針
  const hasRestoredScrollRef = useRef(false);
  useEffect(() => {
    if (state !== 'ready') return;
    if (hasRestoredScrollRef.current) return;
    hasRestoredScrollRef.current = true;
    if (scrollPosition > 0) window.scrollTo(0, scrollPosition);
  }, [state, scrollPosition]);

  const openDetail = (foodName: string) => {
    // Food Detailへ移動する直前のscroll位置だけを保存する（scrollイベントごとの高頻度更新はしない）
    setScrollPosition(window.scrollY);
    go({ name: 'foodEncyclopediaDetail', foodName });
  };

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
        {authState === 'checking' && (
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

        {authState === 'ready' && (
          <>
            {/* 検索inputはデータのロード状態に関わらず常にマウントする。
                state==='ready'内にのみ置くと、ロード中の入力が空振りになる(UX-001) */}
            <div className={styles.filters}>
              <input
                className={styles.searchInput}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="食材名で検索"
              />
            </div>

            {(state === 'loading' || state === 'idle') && (
              <div className={styles.skeletonGrid}>
                {[0, 1, 2, 3].map((i) => (<div key={i} className={styles.skeletonCard} />))}
              </div>
            )}

            {state === 'error' && (
              <div className={styles.errorBox}>
                <p className={styles.errorText}>{errorMessage}</p>
                <button
                  className={styles.retryBtn}
                  onClick={() => idToken && retry(idToken).catch((e) => { if (e instanceof TokenExpiredError) handleTokenExpired(); })}
                >
                  再読み込み
                </button>
              </div>
            )}

            {state === 'ready' && largeCategoryOptions.length > 0 && (
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

            {state === 'ready' && (
              <>
                <p className={styles.count}>{filtered.length}件</p>

                {filtered.length === 0 && <p className={styles.empty}>該当する食材がありません</p>}

                <div className={styles.grid}>
                  {filtered.map((food) => (
                    <button
                      key={food.foodName}
                      className={styles.card}
                      onClick={() => openDetail(food.foodName)}
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
          </>
        )}
      </main>
    </div>
  );
}
