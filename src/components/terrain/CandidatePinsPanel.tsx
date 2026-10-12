import { useRef, useState } from 'react';
import { CandidateGpxError, deleteCandidateSet, importCandidateGpx, pinSummary, setCandidateSetVisible, type CandidatePin, type CandidateSet } from '../../exploration/candidatePins';
import styles from './ExplorationMap.module.css';

// 予測地点（検証候補）の GPX を読み込む（icarus_field_candidate_pins_v1_design.md）。この端末だけに保存し、D1 には送らない。
// 現地で確かめた木は今までどおり Environment Spot に記録する（予測地点は自動で消さない・Spot に変えない）

interface Props {
  sets: CandidateSet[];
  onChanged: () => Promise<void> | void;
  onShow: (p: CandidatePin) => void; // 地図をその地点へ寄せる
  onNavigate: (p: CandidatePin) => void; // 「ここへ行く」
}


export default function CandidatePinsPanel({ sets, onChanged, onShow, onNavigate }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      const { set, existing } = await importCandidateGpx(f.name, await f.text());
      setMsg({ ok: true, text: existing ? `「${set.title}」はもう読み込んであります（${set.pins.length} 地点）` : `「${set.title}」の ${set.pins.length} 地点を読み込みました（地図に紫の「？」で出ます）` });
      await onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof CandidateGpxError ? e.message : 'GPX を読み込めませんでした' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className={styles.form} aria-label="予測地点（検証候補）">
      <h3 className={styles.h}>予測地点（検証候補・この端末だけ）</h3>
      <p className={styles.sub}>GPX の目印（ウェイポイント）を地図に紫の「？」で出します。予測・未確認の地点で、記録（Environment Spot・探索履歴）には入りません。木を確かめたら、今までどおり Spot に記録してください</p>
      <label className={styles.btn}>
        予測地点の GPX を読み込む
        {/* iPhone は accept で拡張子を絞ると .gpx を選べないため付けない */}
        <input ref={fileRef} type="file" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {msg && <p className={msg.ok ? styles.sub : styles.warn}>{msg.text}</p>}
      {sets.map((s) => (
        <div key={s.id}>
        <div className={styles.row}>
          <label className={styles.check}>
            <input type="checkbox" checked={s.visible} onChange={async (e) => { await setCandidateSetVisible(s.id, e.target.checked); await onChanged(); }} />
            {s.title}（{s.pins.length} 地点）
          </label>
          {confirmDelete === s.id ? (
            <>
              <button className={styles.btn} onClick={async () => { await deleteCandidateSet(s.id); setConfirmDelete(null); await onChanged(); }}>本当に消す</button>
              <button className={styles.btn} onClick={() => setConfirmDelete(null)}>やめる</button>
            </>
          ) : (
            <button className={styles.btn} onClick={() => setConfirmDelete(s.id)}>この組を消す</button>
          )}
        </div>
        {/* 地点の一覧（ミズナラの「Spot にする候補」と同じ並び） */}
        {s.pins.map((p, i) => (
          <div key={i} className={styles.captureRow} aria-label={`予測地点 ${p.name}`}>
            <span className={styles.captureNoImg} style={{ background: '#7b1fa2', color: '#fff', fontWeight: 700 }}>？</span>
            <span className={styles.captureText}><b>{p.name}</b><br /><small>予測・未確認{pinSummary(p.desc) ? `・${pinSummary(p.desc)}` : ''}</small></span>
            <button className={styles.btn} onClick={() => onShow(p)}>地図で見る</button>
            <button className={styles.btn} onClick={() => onNavigate(p)}>ここへ行く</button>
          </div>
        ))}
        </div>
      ))}
    </div>
  );
}
