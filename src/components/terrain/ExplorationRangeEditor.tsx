import { useEffect, useMemo, useState } from 'react';
import { ExplorationApiError, ExplorationNetworkError, fetchExplorationHistory, patchExplorationSession, type ExplorationHistoryItem } from '../../api/explorationApi';
import { PURPOSE_LABEL } from '../../exploration/types';
import { clipTrack, hhmm, timeBounds, trackDistanceM, walkingCandidate, type UseRange } from '../../exploration/trackRange';
import type { HistoryEntry } from './useExplorationHistory';
import styles from './ExplorationMap.module.css';

// 探索として使う区間（Track Range v1、管理者のみ）。設計: icarus_exploration_track_range_v1_design.md §5
// - 速度（10km/h 超が 2 分・300m 以上）で見つけた車の区間から「候補」を示すだけ。自動では切らない
// - 確定・全体に戻すには理由が必須。変更前後・実施者・日時・理由はサーバーの履歴に残る
// - 編集中は地図で 使う区間 = 青／外す区間 = 灰色の破線（onPreview）

export interface RangePreview { key: string; range: UseRange }

interface Props {
  entries: HistoryEntry[];
  idToken: string | null;
  onPreview: (p: RangePreview | null) => void;
  onSaved: () => Promise<void>;
}

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);
const span = (r: UseRange) => `${hhmm(r.fromS)}–${hhmm(r.toS)}`;
const jstDateTime = (iso: string) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 16).replace(/-/g, '/').replace('T', ' ');
const parseRange = (v: string | null): UseRange | null => (v ? (JSON.parse(v) as UseRange | null) : null);

export default function ExplorationRangeEditor(p: Props) {
  const editable = useMemo(() => p.entries.filter((e) => e.origin === 'server' && e.sessionId && e.updatedAt && e.rawTrack && timeBounds(e.rawTrack)), [p.entries]);
  const analysis = useMemo(() => new Map(editable.map((e) => [e.key, walkingCandidate(e.rawTrack!)])), [editable]);
  const [key, setKey] = useState('');
  const [range, setRange] = useState<UseRange | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hist, setHist] = useState<ExplorationHistoryItem[] | null>(null);

  const entry = editable.find((e) => e.key === key) ?? null;
  const bounds = entry ? timeBounds(entry.rawTrack!) : null;
  const found = entry ? analysis.get(entry.key)! : null;
  const { onPreview, idToken } = p;

  // 探索を選び直した時: 確定済みの区間 → 候補 → 全区間 の順で初期値にする
  const select = (k: string) => {
    setKey(k);
    setMsg(null);
    setReason('');
    const e = editable.find((x) => x.key === k);
    setRange(e ? e.useRange ?? analysis.get(k)?.candidate ?? timeBounds(e.rawTrack!) : null);
  };

  useEffect(() => {
    onPreview(entry && range ? { key: entry.key, range } : null);
  }, [entry, range, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  useEffect(() => {
    setHist(null);
    if (!entry?.sessionId || !idToken || !navigator.onLine) return;
    let alive = true;
    fetchExplorationHistory(entry.sessionId, idToken).then((items) => { if (alive) setHist(items); }, () => undefined);
    return () => { alive = false; };
  }, [entry?.sessionId, entry?.updatedAt, idToken]);

  const usedM = entry && range ? trackDistanceM(clipTrack(entry.rawTrack!, range)) : 0;
  const describe = (r: UseRange | null) => (r ? `探索区間 ${span(r)}` : bounds ? `全区間 ${span(bounds)}` : '全区間');

  const save = async (next: UseRange | null) => {
    if (!entry || !p.idToken) return;
    if (!reason.trim()) { setMsg({ ok: false, text: '理由を入力してください（例: 下山後の車移動を除外）' }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const r = await patchExplorationSession(entry.sessionId!, { requestId: crypto.randomUUID(), expectedUpdatedAt: entry.updatedAt!, changes: { useRange: next }, reason: reason.trim() }, p.idToken);
      setMsg({ ok: true, text: r.outcome === 'noChange' ? '変更はありません' : next ? `探索区間 ${span(next)} で確定しました` : '全区間を使うように戻しました' });
      setReason('');
      await p.onSaved();
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof ExplorationNetworkError ? '通信できませんでした。電波のある所でもう一度確定してください'
          : e instanceof ExplorationApiError && e.status === 409 ? '他の人が先にこの探索を更新しました。少し待ってから選び直してください'
            : e instanceof Error ? e.message : '保存できませんでした',
      });
    } finally {
      setSaving(false);
    }
  };

  if (editable.length === 0) return null;
  const setFrom = (v: number) => range && setRange({ fromS: Math.min(v, range.toS - 60), toS: range.toS });
  const setTo = (v: number) => range && setRange({ fromS: range.fromS, toS: Math.max(v, range.fromS + 60) });
  const rangeHist = (hist ?? []).filter((h) => h.changes.some((c) => c.field === 'useRange'));

  return (
    <div className={styles.form} aria-label="探索として使う区間">
      <h3 className={styles.h}>帰ってから: 探索として使う区間（管理者）</h3>
      <p className={styles.sub}>記録の止め忘れで入った車の移動を、元の GPX を残したまま探索から外します。速度の判定は候補を出すだけで、確定は理由を書いて行います</p>
      <label className={styles.field}><span>探索</span>
        <select value={key} onChange={(e) => select(e.target.value)} aria-label="区間を決める探索">
          <option value="">選んでください</option>
          {editable.map((e) => (
            <option key={e.key} value={e.key}>
              {e.exploredOn ?? '日付なし'}・{PURPOSE_LABEL[e.purpose]}・{fmtDist(e.rawDistanceM)}
              {e.useRange ? '・区間確定済み' : analysis.get(e.key)!.vehicles.length ? '・車の区間あり' : ''}
            </option>
          ))}
        </select>
      </label>
      {entry && bounds && range && found && (
        <>
          <p className={styles.sub}>
            記録 {span(bounds)}・{fmtDist(entry.rawDistanceM)} → 探索として使用 {span(range)}・{fmtDist(usedM)}
            {entry.useRange ? `（いま確定している区間 ${span(entry.useRange)}）` : '（いまは全区間を使用）'}
          </p>
          <p className={styles.sub}>
            {found.vehicles.length
              ? `車の区間の候補（10km/h 超）: ${found.vehicles.map((v) => `${span(v)}・${fmtDist(v.distanceM)}`).join('、')}`
              : '車の区間は見つかりませんでした'}
            {found.candidate && `／候補 ${span(found.candidate)}`}
          </p>
          <label className={styles.field}><span>開始 {hhmm(range.fromS)}</span>
            <input type="range" min={bounds.fromS} max={bounds.toS} step={10} value={range.fromS} onChange={(e) => setFrom(Number(e.target.value))} aria-label="使う区間の開始" />
          </label>
          <label className={styles.field}><span>終了 {hhmm(range.toS)}</span>
            <input type="range" min={bounds.fromS} max={bounds.toS} step={10} value={range.toS} onChange={(e) => setTo(Number(e.target.value))} aria-label="使う区間の終了" />
          </label>
          <p className={styles.sub}>地図: 青 = 使う区間／灰色の破線 = 外す区間</p>
          <div className={styles.row}>
            {found.candidate && <button className={styles.btn} onClick={() => setRange(found.candidate)}>候補に合わせる</button>}
            <button className={styles.btn} onClick={() => setRange(bounds)}>全区間に合わせる</button>
          </div>
          <label className={styles.field}><span>理由（必須）</span>
            <input type="text" maxLength={200} value={reason} placeholder="例: 下山後の車移動を除外" onChange={(e) => setReason(e.target.value)} aria-label="区間を変える理由" />
          </label>
          <div className={styles.row}>
            <button className={`${styles.btn} ${styles.primary}`} disabled={saving || !p.idToken} onClick={() => void save(range)}>この区間で確定（電波のある時だけ）</button>
            {entry.useRange && <button className={styles.btn} disabled={saving || !p.idToken} onClick={() => void save(null)}>全体を使う（元に戻す）</button>}
          </div>
          {msg && <p className={msg.ok ? styles.sub : styles.warn}>{msg.text}</p>}
          {rangeHist.length > 0 && (
            <div aria-label="区間の変更履歴">
              <p className={styles.sub}><b>区間の変更履歴</b></p>
              {rangeHist.map((h) => {
                const c = h.changes.find((x) => x.field === 'useRange')!;
                return (
                  <p key={h.id} className={styles.sub}>
                    {jstDateTime(h.editedAt)} {h.editedByName}　{describe(parseRange(c.old))} → {describe(parseRange(c.new))}
                    {h.reason && <>　理由: {h.reason}</>}
                  </p>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
