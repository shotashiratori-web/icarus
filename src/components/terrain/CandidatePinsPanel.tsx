import { useRef, useState } from 'react';
import { CandidateGpxError, deleteCandidateSet, importCandidateGpx, setCandidateSetVisible, sortPins, type CandidatePin, type CandidateSet, type PinOrder } from '../../exploration/candidatePins';
import { archiveSharedCandidateSet, shareCandidateSet } from '../../api/candidateSetsApi';
import { TokenExpiredError } from '../../api/icarusApi';
import styles from './ExplorationMap.module.css';

// 予測地点（検証候補）の GPX を読み込む（icarus_field_candidate_pins_v1_design.md）。読み込んだ組はまず端末に保存する（圏外でも読める）。
// v2（icarus_field_candidate_pins_v2_shared_design.md）: 「スタッフと共有」は本人が押した時だけ（件数を出して確認・自動で再送しない）。
// 共有の組を消せるのは登録した本人と admin だけで、消してもサーバーには記録が残る（アーカイブ）。
// 現地で確かめた木は今までどおり Environment Spot に記録する（予測地点は自動で消さない・Spot に変えない）

interface Props {
  sets: CandidateSet[];
  idToken: string | null;
  onChanged: (sync?: boolean) => Promise<void> | void; // sync = 共有の一覧も読み直す
  onShow: (p: CandidatePin) => void; // 地図をその地点へ寄せる
  onNavigate: (p: CandidatePin) => void; // 「ここへ行く」
}

// 並べ方はこの端末に覚えておく（読めない・書けない時は読み込んだ順）
const ORDER_KEY = 'icarus.candidatePins.order';
function loadOrder(): PinOrder {
  try { return localStorage.getItem(ORDER_KEY) === 'height' ? 'height' : 'file'; } catch { return 'file'; }
}

// 開いている組（端末に保存。初めは全部閉じる）
const OPEN_KEY = 'icarus.candidatePins.open';
const HIDDEN_GROUP = '__hidden__';
function loadOpen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}

export default function CandidatePinsPanel({ sets, idToken, onChanged, onShow, onNavigate }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: 'share' | 'delete' | 'archive' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [order, setOrder] = useState<PinOrder>(loadOrder);
  const [openIds, setOpenIds] = useState<string[]>(loadOpen);
  const isOpen = (id: string) => openIds.includes(id);
  const toggleOpen = (id: string) => {
    const next = isOpen(id) ? openIds.filter((x) => x !== id) : [...openIds, id];
    setOpenIds(next);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* 覚えられなくても開閉はできる */ }
  };
  const changeOrder = (o: PinOrder) => {
    setOrder(o);
    try { localStorage.setItem(ORDER_KEY, o); } catch { /* 覚えられなくても並べ替えはできる */ }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    let text = '';
    try {
      text = await f.text();
      const { set, existing } = await importCandidateGpx(f.name, text);
      const next = !navigator.onLine
        ? 'この端末に保存しました。スタッフへの共有は電波のある場所で行ってください'
        : 'この端末に保存しました。スタッフにも見せるには「スタッフと共有」を押してください';
      setMsg({ ok: true, text: existing ? `「${set.title}」はもう読み込んであります（${set.pins.length} 地点）` : `「${set.title}」の ${set.pins.length} 地点を読み込みました（地図に紫の「？」で出ます）。${set.shared ? '' : next}` });
      await onChanged();
    } catch (e) {
      // 何を受け取ったかを添える（iPhone で AirDrop・iCloud のファイルが空・別の形式になっている時に原因が分かるように）
      const head = text.slice(0, 40).replace(/\s+/g, ' ').trim();
      const detail = `（選んだファイル: ${f.name}・${f.size.toLocaleString()} バイト${head ? `・先頭「${head}」` : '・中身が空'}）`;
      setMsg({ ok: false, text: `${e instanceof CandidateGpxError ? e.message : 'GPX を読み込めませんでした'}${detail}` });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // 共有・アーカイブ（電波とログインが要る）。失敗しても端末の組はそのまま
  const run = async (s: CandidateSet, kind: 'share' | 'archive') => {
    setConfirm(null);
    if (!navigator.onLine) { setMsg({ ok: false, text: '電波のある場所で、もう一度押してください' }); return; }
    if (!idToken) { setMsg({ ok: false, text: 'ログインしてから、もう一度押してください' }); return; }
    setBusy(s.id); setMsg(null);
    try {
      if (kind === 'share') {
        await shareCandidateSet(s, idToken);
        setMsg({ ok: true, text: `「${s.title}」の ${s.pins.length} 地点をスタッフと共有しました` });
      } else {
        await archiveSharedCandidateSet(s.id, idToken);
        await deleteCandidateSet(s.id); // この端末に保存した共有版も外す（サーバーには記録が残る）
        setMsg({ ok: true, text: `「${s.title}」をスタッフ全員の一覧から外しました（記録は残ります）` });
      }
      await onChanged(true);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof TokenExpiredError ? 'ログインの有効期限が切れています。ログインし直してください' : `${kind === 'share' ? '共有' : '削除'}できませんでした: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const renderSet = (s: CandidateSet) => {
    const open = isOpen(s.id);
    return (
      <div key={s.id} className={styles.candSet}>
        <div className={styles.candSetHead}>
          <input type="checkbox" aria-label={`${s.title} を地図に出す`} checked={s.visible} onChange={async (e) => { await setCandidateSetVisible(s.id, e.target.checked); await onChanged(); }} />
          <button className={styles.candToggle} aria-expanded={open} onClick={() => toggleOpen(s.id)}>
            {open ? '▼' : '▶'} <span className={styles.candSetTitle}>{s.title}</span>
          </button>
          <span className={styles.candSetMeta}>{s.pins.length} 地点・{s.shared ? `共有・${s.shared.createdByName || '不明'}` : 'この端末だけ'}</span>
        </div>
        {open && (
          <>
            <div className={styles.row}>
              {confirm?.id === s.id ? (
                <>
                  <span className={styles.sub}>
                    {confirm.kind === 'share' ? `${s.pins.length} 地点をスタッフと共有します` : confirm.kind === 'archive' ? 'スタッフ全員の地図から消えます（記録は残ります）' : 'この端末から消します'}
                  </span>
                  <button className={styles.btn} onClick={async () => {
                    if (confirm.kind === 'delete') { await deleteCandidateSet(s.id); setConfirm(null); await onChanged(); } else void run(s, confirm.kind);
                  }}>{confirm.kind === 'share' ? '共有する' : '本当に消す'}</button>
                  <button className={styles.btn} onClick={() => setConfirm(null)}>やめる</button>
                </>
              ) : busy === s.id ? (
                <span className={styles.sub}>送信中…</span>
              ) : s.shared ? (
                <>
                  <span className={styles.sub}>登録: {s.shared.createdByName || '不明'}・{s.shared.createdAt.slice(0, 10)}</span>
                  {s.shared.canArchive && <button className={styles.btn} onClick={() => setConfirm({ id: s.id, kind: 'archive' })}>この組を消す</button>}
                </>
              ) : (
                <>
                  <button className={`${styles.btn} ${styles.primary}`} onClick={() => setConfirm({ id: s.id, kind: 'share' })}>スタッフと共有</button>
                  <button className={styles.btn} onClick={() => setConfirm({ id: s.id, kind: 'delete' })}>この組を消す</button>
                </>
              )}
            </div>
            {/* 地点は名前だけ 1 行（押すと地図で見る）。詳しい根拠は地図の紫の「？」のポップアップ */}
            {sortPins(s.pins, order).map((p) => (
              <div key={`${p.lat},${p.lng},${p.name}`} className={styles.candLine} aria-label={`予測地点 ${p.name}`}>
                <span className={styles.candidateRowIcon}>？</span>
                <button className={styles.candName} onClick={() => onShow(p)} title="地図で見る">{p.name}</button>
                <button className={styles.btn} onClick={() => onNavigate(p)}>行く</button>
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className={styles.form} aria-label="予測地点（検証候補）">
      <h3 className={styles.h}>予測地点（検証候補）</h3>
      <p className={styles.sub}>GPX の目印（ウェイポイント）を地図に紫の「？」で出します。予測・未確認の地点で、記録（Environment Spot・探索履歴）には入りません。読み込んだ組はこの端末に保存され、「スタッフと共有」を押すとスタッフ全員の地図にも出ます。木を確かめたら、今までどおり Spot に記録してください</p>
      <label className={styles.btn}>
        予測地点の GPX を読み込む
        {/* iPhone は accept で拡張子を絞ると .gpx を選べないため付けない */}
        <input ref={fileRef} type="file" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {msg && <p className={msg.ok ? styles.sub : styles.warn}>{msg.text}</p>}
      {sets.length > 0 && (
        <label className={styles.check}>
          並べ替え
          <select value={order} onChange={(e) => changeOrder(e.target.value as PinOrder)}>
            <option value="file">読み込んだ順</option>
            <option value="height">樹冠高の高い順</option>
          </select>
        </label>
      )}
      {/* 地図に出している組。初めは閉じて「名前・地点数・共有状態」の 1 行だけ */}
      {sets.filter((s) => s.visible).map(renderSet)}
      {/* 地図に出していない組は 1 つにまとめて閉じる */}
      {sets.some((s) => !s.visible) && (
        <div>
          <button className={styles.candToggle} aria-expanded={isOpen(HIDDEN_GROUP)} onClick={() => toggleOpen(HIDDEN_GROUP)}>
            {isOpen(HIDDEN_GROUP) ? '▼' : '▶'} 表示していない組（{sets.filter((s) => !s.visible).length}）
          </button>
          {isOpen(HIDDEN_GROUP) && <div className={styles.candHiddenGroup}>{sets.filter((s) => !s.visible).map(renderSet)}</div>}
        </div>
      )}
    </div>
  );
}
