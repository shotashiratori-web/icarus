import { useState } from 'react';
import type { EnvSpeciesItem } from '../../environmentSpots/types';
import { MATCH_COLOR, type HypothesisConditions, type HypothesisSnapshot, type MizunaraRank } from '../../terrain/hypothesis';
import { STATE_COLORS, STATE_LABEL, STATE_LABEL_NO_TARGET, type ExplorationState } from '../../terrain/targetExploration';
import styles from './ExplorationMap.module.css';

// 探す対象・条件を重ねる（グループ内はどれか、グループどうしはすべて）・仮説の保存（S4a）。
// 森林計画・植生図・現地確認は別々の証拠（自動で足し合わせない）。点数・確率は出さない

type Props = {
  targets: EnvSpeciesItem[];
  targetId: string | null;
  onTarget: (id: string | null) => void;
  hyp: HypothesisConditions;
  onHyp: (h: HypothesisConditions) => void;
  terrainUse: { candidate: boolean; dem: boolean };
  onTerrainUse: (u: { candidate: boolean; dem: boolean }) => void;
  demAvailable: boolean;
  demSummary: string | null; // 下の「地形の条件」で選んでいる内容（無ければ null）
  candidateSummary: string;
  communities: string[];
  forestAvailable: boolean;
  forestYears: { forestPlan: string | null; vegetation: string | null };
  trees: EnvSpeciesItem[];
  treeCounts: Record<string, number>;
  stateAreas: Record<ExplorationState, number> | null;
  showTargetLayer: boolean;
  onShowTargetLayer: (v: boolean) => void;
  showMatch: boolean;
  onShowMatch: (v: boolean) => void;
  conditionText: string[];
  match: { matchKm2: number; unexploredKm2: number } | null;
  missing: string[];
  saved: HypothesisSnapshot[];
  suggestedName: string;
  onSave: (name: string) => Promise<void>;
  onLoad: (h: HypothesisSnapshot) => void;
  onDelete: (id: string) => Promise<void>;
  terrainVersion: string;
  pointRadiusM: number;
};

const km2 = (v: number) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} km²`;
const STATES_ORDER: ExplorationState[] = ['unexplored', 'walked', 'notFound', 'foundTrack', 'foundPoint'];

export default function HypothesisPanel(p: Props) {
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const h = p.hyp;
  const set = (patch: Partial<HypothesisConditions>) => p.onHyp({ ...h, ...patch });
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  const ranks = h.forestPlan?.mizunaraRanks ?? [];
  const comms = h.vegetation?.communities ?? [];
  const states = h.exploration?.states ?? [];
  const target = p.targets.find((t) => t.id === p.targetId) ?? null;
  const stateLabel = (s: ExplorationState) => (target ? STATE_LABEL[s] : STATE_LABEL_NO_TARGET[s] ?? STATE_LABEL[s]);
  const stateChoices = target ? STATES_ORDER : (['unexplored', 'walked'] as ExplorationState[]);
  const anyGroup = p.conditionText.length > 0;

  const save = async () => {
    setMsg(null);
    try {
      await p.onSave(name.trim() || p.suggestedName);
      setName('');
      setMsg({ ok: true, text: 'この端末に保存しました' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '保存できませんでした' });
    }
  };

  return (
    <>
      <h3 className={styles.h}>探す対象</h3>
      <select className={styles.select} value={p.targetId ?? ''} onChange={(e) => p.onTarget(e.target.value || null)} aria-label="探す対象">
        <option value="">未選択（対象を区別しない）</option>
        {p.targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {target && <p className={styles.sub}>対象を変えると、重ねた条件は白紙に戻ります（ほかの種の条件をそのまま使わないため）</p>}
      {p.stateAreas && (
        <>
          <label className={styles.check}>
            <input type="checkbox" checked={p.showTargetLayer} onChange={(e) => p.onShowTargetLayer(e.target.checked)} />
            探索実績{target ? `（${target.name}）` : ''}を地図に塗る
          </label>
          {p.showTargetLayer && (
            <div className={styles.legend}>
              {(target ? (['foundPoint', 'notFound', 'foundTrack', 'walked'] as const) : (['walked'] as const)).map((s) => (
                <span key={s} className={styles.legendItem}>
                  <span className={styles.swatch} style={{ background: `rgba(${STATE_COLORS[s].slice(0, 3).join(',')},0.8)` }} />
                  {stateLabel(s)} {km2(p.stateAreas![s])}
                </span>
              ))}
            </div>
          )}
          {target && <p className={styles.sub}>見つかった（地点）は Field Log・観察の地点から {p.pointRadiusM}m。地点の無い「見つかった」探索は軌跡として別に塗ります</p>}
        </>
      )}

      <details className={styles.details} open={anyGroup}>
        <summary className={styles.h}>条件を重ねる（すべて満たす範囲）{p.match ? `：${km2(p.match.matchKm2)}` : ''}</summary>
        <p className={styles.sub}>同じ項目の中は「どれか」、項目どうしは「すべて」。点数や確率ではありません</p>

        <p className={styles.label}>森林計画{p.forestYears.forestPlan ? `（${p.forestYears.forestPlan}）` : ''}：ミズナラが入る林分</p>
        {!p.forestAvailable && <p className={styles.sub}>この版の地形データには森林がありません</p>}
        <div className={styles.chips}>
          {([1, 2, 3] as MizunaraRank[]).map((r) => (
            <label key={r} className={styles.chip}>
              <input type="checkbox" disabled={!p.forestAvailable} checked={ranks.includes(r)} onChange={(e) => set({ forestPlan: { mizunaraRanks: toggle(ranks, r, e.target.checked) } })} />
              {r}位
            </label>
          ))}
        </div>

        <p className={styles.label}>植生図{p.forestYears.vegetation ? `（${p.forestYears.vegetation}調査）` : ''}：ミズナラ系群落（ミズナラそのものではありません）</p>
        <div className={styles.chips}>
          {p.communities.map((c) => (
            <label key={c} className={styles.chip}>
              <input type="checkbox" disabled={!p.forestAvailable} checked={comms.includes(c)} onChange={(e) => set({ vegetation: { communities: toggle(comms, c, e.target.checked) } })} />
              {c}
            </label>
          ))}
        </div>

        <p className={styles.label}>現地確認（環境スポット）</p>
        <label className={styles.check}>
          <select
            className={styles.selectSmall}
            aria-label="現地確認の樹種"
            value={h.confirmedTrees?.treeSpeciesId ?? ''}
            onChange={(e) => {
              const t = p.trees.find((x) => x.id === e.target.value);
              set({ confirmedTrees: t ? { treeSpeciesId: t.id, treeName: t.name, withinM: h.confirmedTrees?.withinM ?? 100 } : null });
            }}
          >
            <option value="">使わない</option>
            {p.trees.filter((t) => p.treeCounts[t.id]).map((t) => <option key={t.id} value={t.id}>{t.name}（{p.treeCounts[t.id]}本）</option>)}
          </select>
          から
          <select
            className={styles.selectSmall}
            aria-label="現地確認の木からの距離"
            disabled={!h.confirmedTrees}
            value={h.confirmedTrees?.withinM ?? 100}
            onChange={(e) => h.confirmedTrees && set({ confirmedTrees: { ...h.confirmedTrees, withinM: Number(e.target.value) } })}
          >
            {[50, 100, 200].map((v) => <option key={v} value={v}>{v}m 以内</option>)}
          </select>
        </label>

        <p className={styles.label}>地形</p>
        <label className={styles.check}>
          <input type="checkbox" checked={p.terrainUse.candidate} onChange={(e) => p.onTerrainUse({ ...p.terrainUse, candidate: e.target.checked })} />
          傾斜・日射・尾根（下の探索条件：{p.candidateSummary}）
        </label>
        <label className={styles.check}>
          <input type="checkbox" disabled={!p.demAvailable || !p.demSummary} checked={p.terrainUse.dem && !!p.demSummary} onChange={(e) => p.onTerrainUse({ ...p.terrainUse, dem: e.target.checked })} />
          地形の条件（下で選んだ方位など{p.demSummary ? `：${p.demSummary}` : '。まだ選んでいません'}）
        </label>

        <p className={styles.label}>探索実績{target ? `（${target.name}）` : '（対象を区別しない）'}</p>
        <div className={styles.chips}>
          {stateChoices.map((s) => (
            <label key={s} className={styles.chip}>
              <input type="checkbox" checked={states.includes(s)} onChange={(e) => set({ exploration: { states: toggle(states, s, e.target.checked), lastExploredBeforeMonths: h.exploration?.lastExploredBeforeMonths ?? null } })} />
              {stateLabel(s)}
            </label>
          ))}
        </div>
        <label className={styles.check}>
          最終探索が
          <select
            className={styles.selectSmall}
            aria-label="最終探索が○か月以上前"
            value={h.exploration?.lastExploredBeforeMonths ?? ''}
            onChange={(e) => set({ exploration: { states, lastExploredBeforeMonths: e.target.value ? Number(e.target.value) : null } })}
          >
            <option value="">指定なし</option>
            {[3, 6, 12, 24].map((v) => <option key={v} value={v}>{v} か月以上前（未探索を含む）</option>)}
          </select>
        </label>

        <p className={styles.label}>アクセス（どちらか）</p>
        <label className={styles.check}>
          車道・林道から
          <select className={styles.selectSmall} aria-label="車道・林道から○m以内" value={h.access?.roadWithinM ?? ''} onChange={(e) => set({ access: { roadWithinM: e.target.value ? Number(e.target.value) : null, trailWithinM: h.access?.trailWithinM ?? null } })}>
            <option value="">指定なし</option>
            {[100, 200, 300, 500].map((v) => <option key={v} value={v}>{v}m 以内</option>)}
          </select>
          徒歩道から
          <select className={styles.selectSmall} aria-label="徒歩道から○m以内" value={h.access?.trailWithinM ?? ''} onChange={(e) => set({ access: { roadWithinM: h.access?.roadWithinM ?? null, trailWithinM: e.target.value ? Number(e.target.value) : null } })}>
            <option value="">指定なし</option>
            {[100, 200, 300, 500].map((v) => <option key={v} value={v}>{v}m 以内</option>)}
          </select>
        </label>

        {anyGroup && (
          <>
            <label className={styles.check}>
              <input type="checkbox" checked={p.showMatch} onChange={(e) => p.onShowMatch(e.target.checked)} />
              <span className={styles.swatch} style={{ background: `rgb(${MATCH_COLOR.slice(0, 3).join(',')})` }} />条件をすべて満たす範囲を塗る
            </label>
            <p className={styles.condText} data-testid="hypothesis-text">{p.conditionText.join(' かつ ')}</p>
            {p.match && <p className={styles.sub}><b>条件をすべて満たす範囲 {km2(p.match.matchKm2)}</b>（うち未探索{target ? `（${target.name}）` : ''} {km2(p.match.unexploredKm2)}）</p>}
            {p.missing.length > 0 && <p className={styles.warn}>この版の地形データでは判定できない条件があります: {p.missing.join('・')}</p>}
            <button className={styles.btn} onClick={() => { p.onHyp({ forestPlan: null, vegetation: null, confirmedTrees: null, terrain: null, exploration: null, access: null }); p.onTerrainUse({ candidate: false, dem: false }); }}>重ねた条件をクリア</button>

            <p className={styles.label}>仮説として保存（この端末）</p>
            <input className={styles.coordInput} value={name} onChange={(e) => setName(e.target.value)} placeholder={p.suggestedName} maxLength={80} aria-label="仮説の名前" />
            <button className={`${styles.btn} ${styles.primary}`} onClick={() => void save()}>仮説として保存</button>
          </>
        )}
        {msg && <p className={msg.ok ? styles.sub : styles.warn}>{msg.text}</p>}

        {p.saved.length > 0 && (
          <>
            <p className={styles.label}>保存した仮説</p>
            {p.saved.map((s) => (
              <div key={s.id} className={styles.hypRow}>
                <div>
                  <b>{s.name}</b>
                  <div className={styles.sub}>
                    {s.savedAt.slice(0, 10)}・{s.target?.name ?? '対象なし'}・{km2(s.summary.matchKm2)}
                    {s.data.terrainVersion !== p.terrainVersion && '・地形データの版が今と違います'}
                  </div>
                </div>
                <button className={styles.btn} onClick={() => p.onLoad(s)}>呼び出す</button>
                {confirmDelete === s.id
                  ? <button className={styles.btn} onClick={() => { setConfirmDelete(null); void p.onDelete(s.id); }}>本当に削除</button>
                  : <button className={styles.btn} onClick={() => setConfirmDelete(s.id)}>削除</button>}
              </div>
            ))}
          </>
        )}
      </details>
    </>
  );
}
