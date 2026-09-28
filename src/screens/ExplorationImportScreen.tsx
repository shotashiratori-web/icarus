import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import { getGpxStatus } from '../api/explorationApi';
import { fetchTerrainAreas } from '../api/terrainApi';
import { listSavedAreas } from '../terrain/areaStore';
import { findPendingBySha, getPending, listPending } from '../exploration/pendingStore';
import { saveNewExploration } from '../exploration/sync';
import { submitExploration } from '../exploration/submit';
import { AREA_OUTSIDE_NOTE, planImport, summarize, type AreaBounds, type ImportRow, type ParsedFile } from '../exploration/importPlan';
import { displayStatus, PURPOSE_LABEL, PURPOSES, STATUS_LABEL, type PendingExploration, type Purpose } from '../exploration/types';
import styles from './ExplorationImportScreen.module.css';

// 過去 YAMAP GPX の一括取り込み（admin・PC、設計 §5・§15）。
// 取り込みは 1 件ずつの登録と同じ経路（端末に原本を保存 → 2 段送信、source=yamap_import・取り込みの回）を通す。
// 過去分の目的・結果は推測で埋めない（既定: 目的=不明、探した対象=空）

type Props = { go: (s: Screen) => void };

const STATE_LABEL: Record<ImportRow['state'], string> = {
  new: '取り込む',
  server: '登録済み（スキップ）',
  device: 'この端末に保存済み（スキップ）',
  sameFile: '同じファイルを重ねて選択（スキップ）',
  invalid: 'GPX として読めない（スキップ）',
};

const fmtKm = (m: number) => `${(m / 1000).toFixed(2)}km`;
const fmtMin = (r: ImportRow) => (r.preview?.startedAt && r.endedAt ? `${Math.round((Date.parse(r.endedAt) - Date.parse(r.preview.startedAt)) / 60000)}分` : '—');

export default function ExplorationImportScreen({ go }: Props) {
  const { idToken, staffMe } = useAuth();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('unknown');
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Record<string, PendingExploration>>({});
  const [batchItems, setBatchItems] = useState<PendingExploration[]>([]);
  const lastFiles = useRef<ParsedFile[]>([]);

  const refreshBatch = useCallback(async () => {
    const all = await listPending().catch(() => [] as PendingExploration[]);
    setBatchItems(all.filter((p) => p.source === 'yamap_import'));
  }, []);
  useEffect(() => { void refreshBatch(); }, [refreshBatch]);

  if (staffMe?.role !== 'admin') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => go({ name: 'settings' })}>← 設定</button>
          <span className={styles.title}>探索履歴の取り込み</span>
          <HomeButton go={go} />
        </header>
        <main className={styles.main}><p className={styles.sub}>管理者のみ利用できます。</p></main>
      </div>
    );
  }

  const loadAreas = async (): Promise<AreaBounds[]> => {
    try {
      if (idToken) return (await fetchTerrainAreas(idToken)).map((a) => ({ areaId: a.areaId, ...a.bounds }));
    } catch { /* 圏外など: 端末に保存したエリアで判定 */ }
    return (await listSavedAreas().catch(() => [])).map((s) => ({ areaId: s.areaId, ...s.manifest.bounds }));
  };

  const planFiles = async (files: ParsedFile[]) => {
    lastFiles.current = files;
    const areas = await loadAreas();
    const planned = await planImport(files, areas, {
      server: async (sha) => {
        if (!idToken) return null;
        try {
          return (await getGpxStatus(sha, idToken)).sessionId;
        } catch {
          return null; // 確かめられない時は取り込み側で duplicate として扱われる（重複しない）
        }
      },
      device: async (sha) => !!(await findPendingBySha(sha).catch(() => undefined)),
    });
    setRows(planned);
  };

  const onFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setPlanning(true);
    setError(null);
    setConfirming(false);
    setProgress({});
    try {
      const files = await Promise.all(Array.from(list).filter((f) => !f.name.startsWith('.')).map(async (f) => ({ fileName: f.name, bytes: await f.arrayBuffer() })));
      await planFiles(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GPX を読み込めませんでした');
    } finally {
      setPlanning(false);
    }
  };

  const summary = summarize(rows);
  // 歩いた人は必須（分かっている事実の入力漏れを防ぐ）。目的は既定「不明」、探した対象・結果は任意
  const explorerNames = names.split(/[、,]/).map((x) => x.trim()).filter(Boolean);
  const namesMissing = explorerNames.length === 0;

  const runImport = async () => {
    setConfirming(false);
    setRunning(true);
    if (namesMissing) return;
    const importBatchId = crypto.randomUUID();
    try {
      for (const r of rows.filter((x) => x.state === 'new')) {
        // 1 件ずつ: 端末に保存（送信できる状態）→ 送信。失敗しても端末に残り、次の件へ進む（オンライン時に自動再送）
        const { record } = await saveNewExploration({
          fileName: r.fileName, bytes: r.bytes, explorerNames, purpose, memo: '', targets: [],
          source: 'yamap_import', importBatchId,
        }, true);
        setProgress((p) => ({ ...p, [r.sha256]: record }));
        await submitExploration(record.id, idToken);
        const after = await getPending(record.id);
        if (after) setProgress((p) => ({ ...p, [r.sha256]: after }));
      }
    } finally {
      setRunning(false);
      await refreshBatch();
      // 取り込んだ後は計画を作り直す（登録済みはスキップ表示になり、「取り込む」は 0 件に戻る）
      if (lastFiles.current.length > 0) await planFiles(lastFiles.current).catch(() => undefined);
    }
  };

  const retryBatch = async () => {
    setRunning(true);
    try {
      for (const p of batchItems.filter((x) => x.stage !== 'registered')) {
        await submitExploration(p.id, idToken);
      }
    } finally {
      setRunning(false);
      await refreshBatch();
    }
  };

  const unfinished = batchItems.filter((p) => p.stage !== 'registered');
  const doneCounts = { unsent: 0, gpx_uploaded: 0, registered: 0, failed: 0 };
  for (const p of Object.values(progress)) doneCounts[displayStatus(p)]++;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'settings' })}>← 設定</button>
        <span className={styles.title}>探索履歴の取り込み（YAMAP GPX）</span>
        <HomeButton go={go} />
      </header>
      <main className={styles.main}>
        <p className={styles.sub}>
          過去の YAMAP の GPX をまとめて探索履歴に登録します。1 件ずつの登録と同じく、原本を端末に保存してから送信します（無加工・同じファイルは重複しない）。
          過去分の目的・探した対象の結果は推測で埋めません。
        </p>

        {unfinished.length > 0 && (
          <div className={styles.notice}>
            前回までの取り込みで、まだ登録済みになっていないものが {unfinished.length} 件あります（端末に保存済み）。
            <button className={styles.btn} onClick={() => void retryBatch()} disabled={running || !idToken}>送信を再開</button>
          </div>
        )}

        <div className={styles.row}>
          <label className={`${styles.btn} ${styles.primary}`}>
            GPX を選ぶ（複数可）
            <input type="file" multiple hidden onChange={(e) => { const el = e.currentTarget; void onFiles(el.files).finally(() => { el.value = ''; }); }} />
          </label>
          <label className={styles.btn}>
            フォルダごと選ぶ
            <input type="file" multiple hidden {...({ webkitdirectory: '' } as Record<string, string>)} onChange={(e) => { const el = e.currentTarget; void onFiles(el.files).finally(() => { el.value = ''; }); }} />
          </label>
        </div>
        {planning && <p className={styles.sub}>読み取り中…（サーバーに同じ GPX があるかも確かめています）</p>}
        {error && <p className={styles.warn}>{error}</p>}

        {rows.length > 0 && (
          <>
            <section className={styles.summary} aria-label="取り込みの確認">
              <div><b>取り込む {summary.toImport} 件</b>（選んだ {summary.total} 件）</div>
              <div>期間 {summary.oldest ?? '—'} 〜 {summary.newest ?? '—'}・合計 {summary.distanceKm}km・{summary.durationH} 時間</div>
              <div>地形探索の範囲内 {summary.inside} 件・範囲外 {summary.outside} 件</div>
              <div className={styles.sub}>
                スキップ: 登録済み {summary.server}・この端末に保存済み {summary.device}・同じファイル {summary.sameFile}・読めない {summary.invalid}
                {summary.nearDuplicates > 0 && <>／<span className={styles.warn}>重複の可能性 {summary.nearDuplicates} 件（下の一覧で確認）</span></>}
              </div>
            </section>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>探索日</th><th>ファイル</th><th>距離</th><th>時間</th><th>範囲</th><th>状態</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const pr = progress[r.sha256];
                    return (
                      <tr key={`${r.fileName}-${r.sha256}`} className={r.state === 'new' ? '' : styles.skip}>
                        <td>{r.preview?.exploredOn ?? '—'}</td>
                        <td>{r.fileName}<br /><span className={styles.sub}>{r.sha256.slice(0, 12)}</span></td>
                        <td>{r.preview ? fmtKm(r.preview.distanceM) : '—'}</td>
                        <td>{fmtMin(r)}</td>
                        <td>{r.preview ? (r.areaIds.length ? '範囲内' : <span className={styles.outside}>{AREA_OUTSIDE_NOTE}</span>) : '—'}</td>
                        <td>
                          {pr ? <b>{STATUS_LABEL[displayStatus(pr)]}</b> : STATE_LABEL[r.state]}
                          {pr?.lastError && displayStatus(pr) !== 'registered' && <><br /><span className={styles.sub}>{pr.lastError.message}</span></>}
                          {r.error && <><br /><span className={styles.sub}>{r.error}</span></>}
                          {r.nearDuplicateOf.length > 0 && <><br /><span className={styles.warn}>重複の可能性: {r.nearDuplicateOf.join('、')}</span></>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <section className={styles.meta} aria-label="取り込む記録にまとめて付ける内容">
              <label className={styles.field}><span>歩いた人（必須。、で区切る。全件に付く）</span>
                <input type="text" value={names} placeholder="例: 翔大" aria-required="true" onChange={(e) => setNames(e.target.value)} disabled={running} />
                {namesMissing && summary.toImport > 0 && <span className={styles.warn}>歩いた人を入力してください（入力するまで取り込めません）</span>}
              </label>
              <label className={styles.field}><span>目的（全件）</span>
                <select value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)} disabled={running}>
                  {PURPOSES.map((x) => <option key={x} value={x}>{PURPOSE_LABEL[x]}</option>)}
                </select>
              </label>
              <p className={styles.sub}>探した対象・結果は空のまま登録します（分かるものは後から個別に追加）。取り込み元は「yamap_import」として記録されます。</p>
            </section>

            {Object.keys(progress).length > 0 && (
              <p className={styles.sub}>
                進み具合: 登録済み {doneCounts.registered}・原本送信済み {doneCounts.gpx_uploaded}・未送信 {doneCounts.unsent}・送信失敗 {doneCounts.failed}
                （未送信・失敗は端末に残り、オンライン時に自動で再送します）
              </p>
            )}

            {!confirming ? (
              <button className={`${styles.btn} ${styles.primary}`} onClick={() => setConfirming(true)} disabled={running || summary.toImport === 0 || !idToken || namesMissing}>
                {running ? '取り込み中…' : `${summary.toImport} 件を取り込む`}
              </button>
            ) : (
              <div className={styles.confirm}>
                <div className={styles.bigCount} role="status">取り込む {summary.toImport} 件</div>
                <span>{summary.oldest} 〜 {summary.newest}・{summary.distanceKm}km・範囲外 {summary.outside} 件を含む。歩いた人「{explorerNames.join('、')}」・目的「{PURPOSE_LABEL[purpose]}」。選んだ {summary.total} 件のうち、スキップ {summary.total - summary.toImport} 件。</span>
                <button className={`${styles.btn} ${styles.primary}`} onClick={() => void runImport()} disabled={namesMissing}>{summary.toImport} 件を取り込む</button>
                <button className={styles.btn} onClick={() => setConfirming(false)}>やめる</button>
              </div>
            )}
            {!idToken && <p className={styles.warn}>ログインが必要です</p>}
          </>
        )}
      </main>
    </div>
  );
}
