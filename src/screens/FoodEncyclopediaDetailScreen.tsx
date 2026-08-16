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

/* ============================================================
 * Food-first Knowledge表示ロジック（Encyclopedia MVP設計報告 Stage14/41/71-74に基づく）。
 *
 * fetchRelatedProcesses()が返すRelatedProcessGroup[]は、Worker側BFSで既にcycle-safe・
 * ユニーク化されたフラット配列（visitedProcessIds使用）。ここでは新しいAPI呼び出しを増やさず、
 * このフラット配列だけを使って「今見ているFoodを直接usesするroot Process」と、
 * 「そのOutputを次にusesするdescendant Process」のツリーをUI側で組み立てる。
 *
 * root判定: group.uses（{id,name}[]）に現在のFood idが含まれるかどうかのみで判定する
 * （usesは食材/加工品どちらのidも同じ形で保持しているため、typeを別途持たなくても判定できる）。
 * ============================================================ */

export interface ProcessChainNode {
  group: RelatedProcessGroup;
  descendants: ProcessChainNode[];
}

// 同一Food起点で、複数のroot chainが同じdescendant Processへ合流するケース（Stage73）でも
// ページ内に同じProcessを二重表示しないよう、木を組み立てる過程でvisitedを共有する
// （= 一度いずれかのbranchのdescendantとして採用されたProcessは、他branchでは再表示しない）
export function buildProcessChains(groups: RelatedProcessGroup[], foodId: string): ProcessChainNode[] {
  const visited = new Set<string>();

  function buildNode(group: RelatedProcessGroup): ProcessChainNode {
    visited.add(group.process.id);
    const descendants: ProcessChainNode[] = [];
    for (const product of group.produces) {
      const nextGroups = groups.filter(
        (g) => !visited.has(g.process.id) && g.uses.some((u) => u.id === product.id),
      );
      for (const next of nextGroups) {
        descendants.push(buildNode(next));
      }
    }
    return { group, descendants };
  }

  const roots = groups.filter((g) => g.uses.some((u) => u.id === foodId));
  return roots.map((r) => buildNode(r));
}

// 加工件数 = 現在のFoodを起点に表示されるユニークProcess数（root + descendant合算）。
// 例: ナマコ = 「ナマコを茹でる」+「ナマコ塩を作る」で2件（設計報告Stage39/40の定義通り）
export function countProcessChain(chains: ProcessChainNode[]): number {
  const ids = new Set<string>();
  function walk(node: ProcessChainNode) {
    ids.add(node.group.process.id);
    node.descendants.forEach(walk);
  }
  chains.forEach(walk);
  return ids.size;
}

export default function FoodEncyclopediaDetailScreen({ go, foodName }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [detail, setDetail] = useState<FieldFoodDetailSuccess | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  // Food Entityが存在する食材だけ「加工」sectionを表示する。存在しない食材はnullのままで、
  // 既存の観察系表示には一切影響しない
  const [relatedProcesses, setRelatedProcesses] = useState<RelatedProcessGroup[] | null>(null);
  // buildProcessChains()でroot Process判定に使う。resolveFoodByName()解決結果のidを保持する
  const [resolvedFoodId, setResolvedFoodId] = useState<string | null>(null);

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
      if (!food) { setRelatedProcesses(null); setResolvedFoodId(null); return; }
      const groups = await fetchRelatedProcesses(food.id, token);
      setRelatedProcesses(groups);
      setResolvedFoodId(food.id);
    } catch {
      setRelatedProcesses(null);
      setResolvedFoodId(null);
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

  const processChains = relatedProcesses && resolvedFoodId
    ? buildProcessChains(relatedProcesses, resolvedFoodId)
    : [];
  const processCount = countProcessChain(processChains);

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
              {processCount > 0 && (
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>加工</span>
                  <span className={styles.summaryValue}>{processCount}件</span>
                </div>
              )}
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

            {/* 加工（Food Entityが存在し、そのFoodを起点にKnowledgeが辿れる食材のみ表示） */}
            {processChains.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>加工</h2>
                <div className={styles.processList}>
                  {processChains.map((node) => (
                    <ProcessChainCard key={node.group.process.id} node={node} depth={0} />
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

// root Process、およびそのOutputを次のInputとするdescendant Processを再帰的に描画する。
// Process description・ProcessedProduct descriptionは表示しない（Content Curation未整理のため、
// Food-first Encyclopedia MVP設計報告の判断により今回表示対象から外す。D1値は変更しない）
function ProcessChainCard({ node, depth }: { node: ProcessChainNode; depth: number }) {
  const { group, descendants } = node;
  return (
    <div className={depth === 0 ? styles.processCard : styles.processCardNested}>
      <p className={styles.processName}>{group.process.name}</p>

      {group.uses.length > 0 && (
        <div className={styles.processProducts}>
          <span className={styles.processProductsLabel}>入力:</span>
          {group.uses.map((u) => (
            <span key={u.id} className={styles.productChip}>{u.name}</span>
          ))}
        </div>
      )}

      {group.process.steps.length > 0 && (
        <div className={styles.stepsBlock}>
          <span className={styles.processProductsLabel}>工程</span>
          <ol className={styles.stepsList}>
            {group.process.steps.map((s) => (<li key={s.order}>{s.text}</li>))}
          </ol>
        </div>
      )}

      {group.produces.length > 0 && (
        <div className={styles.processProducts}>
          <span className={styles.processProductsLabel}>できたもの:</span>
          {group.produces.map((p) => (
            <span key={p.id} className={styles.productChip}>{p.name}</span>
          ))}
        </div>
      )}

      {descendants.length > 0 && (
        <div className={styles.descendantWrap}>
          <p className={styles.descendantConnector}>↓ さらに加工</p>
          {descendants.map((d) => (
            <ProcessChainCard key={d.group.process.id} node={d} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
