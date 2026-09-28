import { useRef, useState } from 'react';
import { clearFailure, finalizeDraft, LocalGpxError, saveNewExploration } from '../../exploration/sync';
import { deletePending } from '../../exploration/pendingStore';
import {
  displayStatus, PURPOSE_LABEL, PURPOSES, RESULT_LABEL, STATUS_LABEL,
  type PendingExploration, type Purpose, type TargetResult,
} from '../../exploration/types';
import { COVERAGE_WIDTHS_M, PERIOD_LABEL, type CoverageWidth, type PeriodFilter } from '../../terrain/coverage';
import type { useExplorationHistory } from './useExplorationHistory';
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
}

interface TargetRow { target: string; result: TargetResult }

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
        <div className={styles.form} aria-label="探索の記録を入力">
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
