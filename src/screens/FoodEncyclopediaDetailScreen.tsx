import { lazy, Suspense, useEffect, useState } from 'react';
import { fetchFieldFoodDetail, FieldFoodNotFoundError } from '../api/fieldFoodApi';
import { resolveFoodByName, fetchRelatedProcesses, type RelatedProcessGroup } from '../api/knowledgeApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { FieldFoodDetailSuccess, FieldFoodListItem } from '../types/fieldFood';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import styles from './FoodEncyclopediaDetailScreen.module.css';

// Leafletをこの画面の主バンドルへ含めないよう遅延読み込みする（ZukanFieldDetailScreenと同じ方針）
const FieldGpsMiniMap = lazy(() => import('../components/FieldGpsMiniMap'));

type Props = { go: (s: Screen) => void; foodName: string };
type LoadState = 'loading' | 'ready' | 'error' | 'notFound';

// 一覧画面と同じ分類表示ロジック（多数決で確定しない。競合時は確認を促す表示）
function classificationLabel(food: FieldFoodListItem): string {
  if (food.classificationConflict) return '分類確認が必要';
  if (!food.largeCategory) return '未分類';
  return food.subCategory ? `${food.largeCategory} / ${food.subCategory}` : food.largeCategory;
}

function splitObservedParts(raw: string): string[] {
  return Array.from(new Set(raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)));
}

// observedDatesを年別にまとめる（複数年のデータを1本の疑似季節線へ混ぜない）
function buildYearGroups(dates: { date: string; count: number }[]): { year: string; items: { date: string; count: number }[] }[] {
  const byYear = new Map<string, { date: string; count: number }[]>();
  for (const d of dates) {
    const year = d.date.slice(0, 4);
    const list = byYear.get(year);
    if (list) list.push(d); else byYear.set(year, [d]);
  }
  return Array.from(byYear.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, items]) => ({ year, items }));
}

function formatMonthDay(dateStr: string): string {
  const m = dateStr.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  return `${Number(m[1])}/${Number(m[2])}`;
}

export default function FoodEncyclopediaDetailScreen({ go, foodName }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [detail, setDetail] = useState<FieldFoodDetailSuccess | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  // Food Entity（migration 0011）が存在する食材だけ「関連加工」を表示する。
  // 存在しない食材（現状ナマコ以外の173件）はnullのままで、既存表示に一切影響しない
  const [relatedProcesses, setRelatedProcesses] = useState<RelatedProcessGroup[] | null>(null);

  const load = async (token: string) => {
    setState('loading');
    try {
      const result = await fetchFieldFoodDetail(foodName, token);
      setDetail(result);
      setState('ready');
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
      if (e instanceof FieldFoodNotFoundError) { setState('notFound'); return; }
      setErrorMessage(e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました');
      setState('error');
    }
  };

  // 関連加工の取得は主表示とは独立させ、失敗しても食材図鑑本体の表示に影響を与えない（サイレントに諦める）。
  // alias衝突（FoodAliasConflictError）も含め、Food解決に失敗した場合は誤ったKnowledgeへ接続するより
  // 関連加工を非表示のままにする（食材図鑑本体は壊さない）
  const loadRelatedProcesses = async (token: string) => {
    try {
      const food = await resolveFoodByName(foodName, token);
      if (!food) { setRelatedProcesses(null); return; }
      const groups = await fetchRelatedProcesses(food.id, token);
      setRelatedProcesses(groups);
    } catch {
      setRelatedProcesses(null);
    }
  };

  useEffect(() => {
    if (authState === 'ready' && idToken) {
      void load(idToken);
      void loadRelatedProcesses(idToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, idToken, foodName]);

  const backToList = () => go({ name: 'foodEncyclopediaList' });

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={backToList}>← 食材図鑑</button>
        <span className={styles.title}>{foodName}</span>
        <HomeButton go={go} />
      </header>

      <main className={styles.main}>
        {(authState === 'checking' || (authState === 'ready' && state === 'loading')) && (
          <div className={styles.skeleton}>
            <div className={styles.skeletonHero} />
            <div className={styles.skeletonLine} />
            <div className={styles.skeletonLine} />
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

        {authState === 'ready' && state === 'notFound' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>この食材は見つかりません</p>
            <button className={styles.retryBtn} onClick={backToList}>食材図鑑へ戻る</button>
          </div>
        )}

        {state === 'ready' && detail && (
          <>
            {/* Hero */}
            <section className={styles.hero}>
              <div className={styles.heroPhotoWrap}>
                {detail.food.representativePhotoUrl
                  ? <img className={styles.heroPhoto} src={detail.food.representativePhotoUrl} alt={detail.food.foodName} />
                  : <div className={styles.heroPhotoPlaceholder}>写真なし</div>}
              </div>
              <h1 className={styles.foodName}>{detail.food.foodName}</h1>
              <p className={styles.classification}>{classificationLabel(detail.food)}</p>
            </section>

            {/* Summary */}
            <section className={styles.summaryCard}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>観察記録</span>
                <span className={styles.summaryValue}>{detail.food.observationCount}件</span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>観察期間</span>
                <span className={styles.summaryValue}>
                  {detail.food.firstObservedDate === detail.food.lastObservedDate
                    ? detail.food.firstObservedDate
                    : `${detail.food.firstObservedDate} → ${detail.food.lastObservedDate}`}
                </span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>場所</span>
                <span className={styles.summaryValue}>{detail.food.placeCount}ヶ所</span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>観察部位</span>
                <span className={styles.summaryValue}>{detail.food.partCount}</span>
              </div>
            </section>

            {/* 観察日の分布 */}
            {detail.observedDates.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>観察日の分布</h2>
                <div className={styles.yearGroups}>
                  {buildYearGroups(detail.observedDates).map((g) => (
                    <div key={g.year} className={styles.yearGroup}>
                      <span className={styles.yearLabel}>{g.year}</span>
                      <div className={styles.dateChips}>
                        {g.items.map((d) => (
                          <span key={d.date} className={styles.dateChip}>
                            {formatMonthDay(d.date)}{d.count > 1 ? ` ×${d.count}` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 観察記録 */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>観察記録</h2>
              <div className={styles.observationList}>
                {detail.observations.map((obs) => {
                  const hasGps = obs.latitude !== null && obs.longitude !== null;
                  const parts = splitObservedParts(obs.observedParts);
                  return (
                    <div key={obs.eventId} className={styles.observationCard}>
                      {obs.photoUrl && (
                        <div className={styles.obsPhotoWrap}>
                          <img className={styles.obsPhoto} src={obs.photoUrl} alt={detail.food.foodName} loading="lazy" />
                        </div>
                      )}
                      <div className={styles.obsBody}>
                        <div className={styles.obsMetaRow}>
                          <span className={styles.obsDate}>{obs.date}</span>
                          <span className={styles.obsPlace}>📍 {obs.place || '場所未記入'}</span>
                        </div>
                        {obs.memo && <p className={styles.obsMemo}>{obs.memo}</p>}
                        {parts.length > 0 && (
                          <div className={styles.obsPartsRow}>
                            {parts.map((p) => (<span key={p} className={styles.obsPartChip}>{p}</span>))}
                          </div>
                        )}
                        {hasGps && (
                          <div className={styles.obsMapWrap}>
                            <Suspense fallback={null}>
                              <FieldGpsMiniMap lat={obs.latitude as number} lng={obs.longitude as number} />
                            </Suspense>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 場所 */}
            {detail.places.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>場所</h2>
                <div className={styles.placeList}>
                  {detail.places.map((p) => (
                    <div key={p.place ?? '__none__'} className={styles.placeRow}>
                      <span className={styles.placeName}>{p.place ?? '場所未記入'}</span>
                      <span className={styles.placeCount}>{p.observationCount}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 観察部位 */}
            {detail.parts.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>観察部位</h2>
                <div className={styles.partsRow}>
                  {detail.parts.map((p) => (
                    <span key={p.part} className={styles.partChip}>
                      {p.part} {p.observationCount}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* 関連加工（Food Entityが存在する食材のみ表示。migration 0011のKnowledge Entity MVP） */}
            {relatedProcesses && relatedProcesses.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>関連加工</h2>
                <div className={styles.processList}>
                  {relatedProcesses.map((g) => (
                    <div key={g.process.id} className={styles.processCard}>
                      <p className={styles.processName}>{g.process.name}</p>
                      {g.process.description && <p className={styles.processDescription}>{g.process.description}</p>}
                      {g.uses.length > 0 && (
                        <div className={styles.processProducts}>
                          <span className={styles.processProductsLabel}>入力:</span>
                          {g.uses.map((u) => (
                            <span key={u.id} className={styles.productChip}>{u.name}</span>
                          ))}
                        </div>
                      )}
                      {g.produces.length > 0 && (
                        <div className={styles.processProducts}>
                          <span className={styles.processProductsLabel}>加工品:</span>
                          {g.produces.map((p) => (
                            <span key={p.id} className={styles.productChip}>{p.name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
