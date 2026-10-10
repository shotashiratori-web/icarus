import { useEffect, useRef, useState } from 'react';
import { clearFailure, finalizeDraft, LocalGpxError, saveNewExploration } from '../../exploration/sync';
import { deletePending } from '../../exploration/pendingStore';
import { listHypotheses } from '../../exploration/hypothesisStore';
import { ExplorationApiError, ExplorationNetworkError, patchExplorationSession } from '../../api/explorationApi';
import type { HypothesisSnapshot } from '../../terrain/hypothesis';
import {
  displayStatus, PURPOSE_LABEL, PURPOSES, RESULT_LABEL, STATUS_LABEL,
  type PendingExploration, type Purpose, type TargetResult,
} from '../../exploration/types';
import { COVERAGE_WIDTHS_M, PERIOD_LABEL, type CoverageWidth, type PeriodFilter } from '../../terrain/coverage';
import type { useExplorationHistory } from './useExplorationHistory';
import ExplorationRangeEditor, { type RangePreview } from './ExplorationRangeEditor';
import styles from './ExplorationMap.module.css';

// 探索履歴（Stage 2 Web）: GPX の記録（端末保存 → 送信）・端末の状態・探索範囲の表示条件。
// 状態は 未送信 / 原本送信済み / 登録済み / 送信失敗 をはっきり出す。「登録済み」は R2 原本の hash 一致＋D1 登録成立の後だけ

type History = ReturnType<typeof useExplorationHistory>;

interface Props {
  history: History;
  staffName: string;
  show: boolean;
  onShowChange: (v: boolean) => void;
  width: CoverageWidth;
  onWidthChange: (v: CoverageWidth) => void;
  purposeFilter: Purpose | 'all';
  onPurposeFilterChange: (v: Purpose | 'all') => void;
  period: PeriodFilter;
  onPeriodChange: (v: PeriodFilter) => void;
  exploredKm2: number | null;
  idToken: string | null;
  openDraftId?: string; // この端末の下書き（GPX を選んだだけ）の入力を最初から開く
  isAdmin: boolean; // 探索として使う区間の確定は管理者のみ
  onRangePreview: (p: RangePreview | null) => void;
}

interface TargetRow { target: string; result: TargetResult }

// 仮説の保存日（JST）。探索日と同じ日の仮説を上に出す
const jstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);
export function orderHypotheses(list: HypothesisSnapshot[], exploredOn: string | null): HypothesisSnapshot[] {
  return [...list].sort((a, b) => {
    const sa = exploredOn && jstDate(a.savedAt) === exploredOn ? 1 : 0;
    const sb = exploredOn && jstDate(b.savedAt) === exploredOn ? 1 : 0;
    return sb - sa || b.savedAt.localeCompare(a.savedAt);
  });
}
const hypLabel = (h: HypothesisSnapshot, exploredOn: string | null) =>
  `${h.name}（${jstDate(h.savedAt)}${exploredOn && jstDate(h.savedAt) === exploredOn ? '・この日' : ''}・${h.target?.name ?? '対象なし'}）`;

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);

export default function ExplorationHistoryPanel(p: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<PendingExploration | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [names, setNames] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('maitake');
  const [memo, setMemo] = useState('');
  const [date, setDate] = useState('');
  const [targets, setTargets] = useState<TargetRow[]>([{ target: 'マイタケ', result: 'not_found' }]);
  const [busy, setBusy] = useState(false);
  const [dateFor, setDateFor] = useState<Record<string, string>>({});
  // S4b: 使った仮説（端末の仮説から選ぶ。既定は なし）
  const [hyps, setHyps] = useState<HypothesisSnapshot[]>([]);
  const [hypId, setHypId] = useState('');
  const [attachSession, setAttachSession] = useState('');
  const [attachHyp, setAttachHyp] = useState('');
  const [attachMsg, setAttachMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [attaching, setAttaching] = useState(false);
  useEffect(() => { listHypotheses().then(setHyps, () => setHyps([])); }, [draft, attachSession]);
  // 「🌲 環境を記録」から GPX を選んで来た時: その下書きの入力を開く（1 回だけ）
  const openedRef = useRef<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!p.openDraftId || openedRef.current === p.openDraftId) return;
    const r = p.history.pending.find((x) => x.id === p.openDraftId && !x.ready);
    if (!r) return;
    openedRef.current = p.openDraftId;
    setDraft(r);
    setNames(p.staffName);
    setPurpose('maitake');
    setMemo('');
    setDate('');
    setTargets([{ target: 'マイタケ', result: 'not_found' }]);
    setHypId('');
    setTimeout(() => formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 300);
  }, [p.openDraftId, p.history.pending, p.staffName]);

  // ① GPX を選んだら、入力より先に端末へ原本を保存する（下書き）
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    try {
      const bytes = await file.arrayBuffer();
      const { record, existing } = await saveNewExploration({ fileName: file.name, bytes, explorerNames: [], purpose: 'unknown', memo: '', targets: [] }, false);
      await p.history.refreshLocal();
      if (existing && record.ready) {
        setNotice(`この GPX はすでに端末にあります（${STATUS_LABEL[displayStatus(record)]}）。2 件目は作りません`);
        return;
      }
      setDraft(record);
      setNames(p.staffName);
      setPurpose('maitake');
      setMemo('');
      setDate('');
      setTargets([{ target: 'マイタケ', result: 'not_found' }]);
      setHypId('');
    } catch (e) {
      setNotice(e instanceof LocalGpxError ? `${e.message}（保存していません）` : 'GPX を読み込めませんでした（保存していません）');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ② 入力を入れて送信（オンラインでも同じ経路: 端末の記録を「送信できる」にして送る。圏外なら未送信のまま自動再送）
  const onSubmit = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const needsDate = !draft.preview.exploredOn;
      if (needsDate && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        setNotice('この GPX には時刻がありません。探索日を入力してください');
        return;
      }
      await finalizeDraft(draft.id, {
        explorerNames: names.split(/[、,]/).map((s) => s.trim()).filter(Boolean),
        purpose,
        memo: memo.trim(),
        targets: targets.filter((t) => t.target.trim()).map((t) => ({ target: t.target.trim(), result: t.result, memo: '' })),
        exploredOnManual: needsDate ? date : null,
        hypothesis: hyps.find((h) => h.id === hypId) ?? null,
      });
      setDraft(null);
      await p.history.send(draft.id);
    } finally {
      setBusy(false);
    }
  };

  const discardDraft = async () => {
    if (!draft) return;
    await deletePending(draft.id);
    setDraft(null);
    await p.history.refreshLocal();
  };

  const retry = async (rec: PendingExploration) => {
    const d = dateFor[rec.id];
    await clearFailure(rec.id, d ? { exploredOnManual: d } : {});
    await p.history.send(rec.id);
  };

  const serverEntries = p.history.entries.filter((e) => e.origin === 'server' && e.sessionId && e.updatedAt).slice(0, 20);
  const attachEntry = serverEntries.find((e) => e.sessionId === attachSession) ?? null;
  const attach = async () => {
    if (!attachEntry || !p.idToken) return;
    setAttaching(true);
    setAttachMsg(null);
    try {
      const current = attachEntry.hypothesis?.id ?? '';
      if (current === attachHyp) { setAttachMsg({ ok: true, text: '変更はありません' }); return; }
      const next = attachHyp ? hyps.find((h) => h.id === attachHyp) ?? null : null;
      await patchExplorationSession(attachEntry.sessionId!, { requestId: crypto.randomUUID(), expectedUpdatedAt: attachEntry.updatedAt!, changes: { hypothesis: next } }, p.idToken);
      setAttachMsg({ ok: true, text: next ? `仮説「${next.name}」を付けました` : '仮説を外しました' });
      await p.history.refreshRemote();
    } catch (e) {
      setAttachMsg({
        ok: false,
        text: e instanceof ExplorationNetworkError ? '通信できませんでした。電波のある所でもう一度保存してください'
          : e instanceof ExplorationApiError && e.status === 409 ? '他の人が先にこの探索を更新しました。少し待ってから選び直してください'
            : e instanceof Error ? e.message : '保存できませんでした',
      });
    } finally {
      setAttaching(false);
    }
  };

  const local = p.history.pending;
  const drafts = local.filter((r) => !r.ready);
  const counts = { unsent: 0, gpx_uploaded: 0, registered: 0, failed: 0 };
  for (const r of local) if (r.ready) counts[displayStatus(r)]++;

  return (
    <>
      <h3 className={styles.h}>探索履歴</h3>
      <div className={styles.row}>
        <label className={`${styles.btn} ${styles.primary}`}>
          GPX を記録
          {/* iPhone は accept で拡張子を絞ると .gpx を選べないため付けない */}
          <input ref={fileRef} type="file" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        <label className={styles.check}><input type="checkbox" checked={p.show} onChange={(e) => p.onShowChange(e.target.checked)} />地図に表示</label>
      </div>
      {notice && <p className={styles.warn}>{notice}</p>}

      {draft && (
        <div className={styles.form} aria-label="探索の記録を入力" ref={formRef}>
          <p className={styles.sub}>
            端末に保存しました（未送信）: {draft.fileName}・{draft.preview.exploredOn ?? '日付なし'}・{fmtDist(draft.preview.distanceM)}・{draft.preview.pointCount}点
          </p>
          {!draft.preview.exploredOn && (
            <label className={styles.field}><span>探索日（GPX に時刻がありません）</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          )}
          <label className={styles.field}><span>歩いた人（、で区切る）</span><input type="text" value={names} onChange={(e) => setNames(e.target.value)} /></label>
          <label className={styles.field}><span>目的</span>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)}>
              {PURPOSES.map((x) => <option key={x} value={x}>{PURPOSE_LABEL[x]}</option>)}
            </select>
          </label>
          <span className={styles.sub}>探した対象と結果（見つからなかったも記録）</span>
          {targets.map((t, i) => (
            <div key={i} className={styles.row}>
              <input className={styles.inputSmall} type="text" value={t.target} placeholder="例: マイタケ" aria-label="探した対象"
                onChange={(e) => setTargets((ts) => ts.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
              <select value={t.result} aria-label="結果" onChange={(e) => setTargets((ts) => ts.map((x, j) => (j === i ? { ...x, result: e.target.value as TargetResult } : x)))}>
                {(['not_found', 'found', 'unknown'] as TargetResult[]).map((r) => <option key={r} value={r}>{RESULT_LABEL[r]}</option>)}
              </select>
              <button className={styles.btn} onClick={() => setTargets((ts) => ts.filter((_, j) => j !== i))} aria-label="この対象を外す">×</button>
            </div>
          ))}
          <button className={styles.btn} onClick={() => setTargets((ts) => [...ts, { target: '', result: 'unknown' }])}>＋ 対象を追加</button>
          <label className={styles.field}><span>メモ</span><input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
          <label className={styles.field}><span>使った仮説（任意。あとで「帰ってから」の欄で付けてもよい）</span>
            <select value={hypId} onChange={(e) => setHypId(e.target.value)} aria-label="使った仮説">
              <option value="">なし</option>
              {orderHypotheses(hyps, draft.exploredOnManual ?? draft.preview.exploredOn).map((h) => <option key={h.id} value={h.id}>{hypLabel(h, draft.preview.exploredOn)}</option>)}
            </select>
          </label>
          <div className={styles.row}>
            <button className={`${styles.btn} ${styles.primary}`} onClick={() => void onSubmit()} disabled={busy}>送信する（圏外なら電波が戻った時に自動）</button>
            <button className={styles.btn} onClick={() => void discardDraft()} disabled={busy}>取り消す</button>
          </div>
        </div>
      )}

      {local.length > 0 && (
        <div className={styles.localList}>
          <p className={styles.sub}>
            この端末: 未送信 {counts.unsent}・原本送信済み {counts.gpx_uploaded}・登録済み {counts.registered}・送信失敗 {counts.failed}
            {drafts.length > 0 && `・入力待ち ${drafts.length}`}
          </p>
          {local.filter((r) => r.stage !== 'registered' || Date.now() - Date.parse(r.registeredAt ?? r.updatedAt) < 3 * 86400 * 1000).slice(0, 8).map((r) => {
            const st = displayStatus(r);
            return (
              <div key={r.id} className={styles.localItem}>
                <span className={`${styles.badge} ${styles[`badge_${st}`]}`}>{r.ready ? STATUS_LABEL[st] : '入力待ち'}</span>
                <span className={styles.localText}>
                  {r.exploredOnManual ?? r.preview.exploredOn ?? '日付なし'}・{PURPOSE_LABEL[r.purpose]}・{fmtDist(r.preview.distanceM)}
                  {r.lastError && st !== 'registered' && <><br /><span className={st === 'failed' ? styles.warn : styles.sub}>{r.lastError.message}</span></>}
                </span>
                {!r.ready && <button className={styles.btn} onClick={() => { setDraft(r); setNames(p.staffName); }}>入力する</button>}
                {r.ready && st !== 'registered' && (
                  <>
                    {r.lastError?.code === 'EXPLORATION_NEEDS_DATE' && (
                      <input type="date" aria-label="探索日" value={dateFor[r.id] ?? ''} onChange={(e) => setDateFor((d) => ({ ...d, [r.id]: e.target.value }))} />
                    )}
                    <button className={styles.btn} onClick={() => void retry(r)}>再送</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {serverEntries.length > 0 && (
        <div className={styles.form} aria-label="探索に使った仮説を付ける">
          <h3 className={styles.h}>帰ってから: 探索に使った仮説を付ける</h3>
          <p className={styles.sub}>山では地図を見ることに集中し、仮説は帰宅後にここで付けられます</p>
          <label className={styles.field}><span>探索</span>
            <select value={attachSession} onChange={(e) => { setAttachSession(e.target.value); setAttachMsg(null); const en = serverEntries.find((x) => x.sessionId === e.target.value); setAttachHyp(en?.hypothesis?.id ?? ''); }} aria-label="仮説を付ける探索">
              <option value="">選んでください</option>
              {serverEntries.map((e) => <option key={e.sessionId!} value={e.sessionId!}>{e.exploredOn ?? '日付なし'}・{PURPOSE_LABEL[e.purpose]}・{fmtDist(e.distanceM)}{e.hypothesis ? `・仮説「${e.hypothesis.name}」` : ''}</option>)}
            </select>
          </label>
          {attachEntry && (
            <>
              <label className={styles.field}><span>仮説</span>
                <select value={attachHyp} onChange={(e) => setAttachHyp(e.target.value)} aria-label="付ける仮説">
                  <option value="">なし（外す）</option>
                  {attachEntry.hypothesis && !hyps.some((h) => h.id === attachEntry.hypothesis!.id) && (
                    <option value={attachEntry.hypothesis.id}>{attachEntry.hypothesis.name}（いま付いているもの・この端末には無い）</option>
                  )}
                  {orderHypotheses(hyps, attachEntry.exploredOn).map((h) => <option key={h.id} value={h.id}>{hypLabel(h, attachEntry.exploredOn)}</option>)}
                </select>
              </label>
              <button className={styles.btn} disabled={attaching || !p.idToken} onClick={() => void attach()}>この内容で保存（電波のある時だけ）</button>
            </>
          )}
          {attachMsg && <p className={attachMsg.ok ? styles.sub : styles.warn}>{attachMsg.text}</p>}
          <p className={styles.sub}>付けた仮説は、その時点の内容がそのまま残ります（あとで端末の仮説を直しても変わりません）。付け替え・外しは履歴に残ります</p>
        </div>
      )}

      {p.isAdmin && <ExplorationRangeEditor entries={p.history.entries} idToken={p.idToken} onPreview={p.onRangePreview} onSaved={p.history.refreshRemote} />}

      <div className={styles.row}>
        <label className={styles.field}><span>探索範囲（線から）</span>
          <select value={p.width} onChange={(e) => p.onWidthChange(Number(e.target.value) as CoverageWidth)} aria-label="探索範囲の幅">
            {COVERAGE_WIDTHS_M.map((w) => <option key={w} value={w}>{w}m</option>)}
          </select>
        </label>
        <label className={styles.field}><span>目的</span>
          <select value={p.purposeFilter} onChange={(e) => p.onPurposeFilterChange(e.target.value as Purpose | 'all')} aria-label="目的で絞る">
            <option value="all">すべて</option>
            {PURPOSES.map((x) => <option key={x} value={x}>{PURPOSE_LABEL[x]}</option>)}
          </select>
        </label>
        <label className={styles.field}><span>期間</span>
          <select value={p.period} onChange={(e) => p.onPeriodChange(e.target.value as PeriodFilter)} aria-label="期間で絞る">
            {(['all', 'thisYear', 'last30'] as PeriodFilter[]).map((x) => <option key={x} value={x}>{PERIOD_LABEL[x]}</option>)}
          </select>
        </label>
      </div>
      <p className={styles.sub}>
        {p.show && p.exploredKm2 !== null && <>この条件で探索済みの候補 {p.exploredKm2 < 1 ? p.exploredKm2.toFixed(2) : p.exploredKm2.toFixed(1)} km²（薄い青）。</>}
        サーバーの探索履歴 {p.history.entries.filter((e) => e.origin === 'server').length} 件
        {p.history.remoteAsOf && `（${new Date(p.history.remoteAsOf).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 時点）`}
      </p>
      {p.history.remoteError && <p className={styles.warn}>{p.history.remoteError}</p>}
    </>
  );
}
