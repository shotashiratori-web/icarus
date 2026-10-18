import { useEffect, useRef, useState } from 'react';
import {
  extractExifDate, fetchGps, getImageDimensions, isHeicFile, readFileAsBase64, resizeToJpeg, sha256Hex,
} from '../../api/icarusApi';
import { PHOTO_ASSET_R2_ENABLED } from '../../config';
import { submitWithFallback } from '../../submission/orchestrator';
import type { FieldLogD1SubmissionPayload } from '../../submission/adapters/fieldLogD1Adapter';
import { useZukanFieldStore } from '../../store/zukanFieldStore';
import { ENVIRONMENT_LARGE_CATEGORY, emptyPhotoEntry, todayString } from '../../types/foodLog';
import { buildFieldLogId } from '../../types/zukan';
import {
  buildTreeMemo, loadLastTreeSpecies, parseDbhInput, saveLastTreeSpecies, speciesChoices, TREE_TAGS,
} from '../../exploration/treeQuickRecord';
import styles from './TreeQuickRecord.module.css';

// 木を撮ってすぐ記録（icarus_tree_quick_record_v1_design.md）。撮影 → 太さ → 特徴を 1〜2 タップ → 次の木を 15 秒ほどで。
// 保存は Field Log（環境）と同じ送り方（submitWithFallback・fieldLogD1）。圏外は保留にたまり、電波が戻ったら送られる。
// ［保存して次の木］は押した瞬間にカメラを開き（iPhone はボタンの操作の中でしかカメラを開けない）、保存は裏で進める

type Prepared = {
  previewUrl: string; // 入力中の見本（object URL）
  base64: string; // 縮小した JPEG（送信・地図の見本）
  date: string;
  takenAt: string;
  fileName: string;
  asset?: { originalBase64: string; fileHash: string; mimeType: string; sizeBytes: number; width?: number; height?: number };
};
type Gps = { lat: number; lng: number; accuracy: number } | null;
const SENT_SHOW_MS = 4000;
const QUEUED_SHOW_MS = 8000;

type Props = {
  idToken: string | null;
  livePos: { lat: number; lng: number; accuracy: number } | null; // 現在地を追っている時の位置（あれば待たずに使う）
  onTokenExpired: () => void;
  buttonClassName: string; // 地図のボタンの並びと同じ見た目にする
};

export default function TreeQuickRecord({ idToken, livePos, onTokenExpired, buttonClassName }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const prep = useRef<Promise<Prepared | null> | null>(null);
  const gps = useRef<Promise<Gps> | null>(null);
  const [species, setSpecies] = useState(loadLastTreeSpecies);
  const [other, setOther] = useState('');
  const [dbh, setDbh] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  // 送信の状態の表示（2026-10-18 Gate: 「送信 1」が送信中とも読め、送っている間は何も出ていなかった）。
  // 送信中…は送り終わるまで、送信済み・保留は数秒で消える（数は今回の記録の合計）
  const [count, setCount] = useState({ sending: 0, sent: 0, queued: 0, failed: 0 });
  const [flash, setFlash] = useState<'sent' | 'queued' | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), flash === 'sent' ? SENT_SHOW_MS : QUEUED_SHOW_MS);
    return () => window.clearTimeout(t);
  }, [flash, count.sent, count.queued]);
  const [msg, setMsg] = useState<string | null>(null);
  const useR2Asset = PHOTO_ASSET_R2_ENABLED;

  const openCamera = () => inputRef.current?.click();

  const onFile = (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    if (useR2Asset && isHeicFile(file)) { setMsg('HEIC の写真は送れません（カメラの設定を「互換性優先」にしてください）'); return; }
    const shotAt = new Date();
    // 位置: 撮った時の現在地（木のすぐ横で撮る）。追っている現在地があれば待たない。取れなければ「位置なし」
    gps.current = livePos ? Promise.resolve({ ...livePos }) : fetchGps();
    prep.current = (async () => {
      try {
        const [base64, exif, original, hash, dims] = await Promise.all([
          resizeToJpeg(file),
          extractExifDate(file),
          useR2Asset ? readFileAsBase64(file) : Promise.resolve(undefined),
          useR2Asset ? sha256Hex(file) : Promise.resolve(undefined),
          useR2Asset ? getImageDimensions(file) : Promise.resolve(null),
        ]);
        return {
          previewUrl: '', base64, fileName: file.name,
          date: exif?.date ?? todayString(),
          takenAt: exif?.takenAt ?? shotAt.toISOString(),
          ...(useR2Asset && original && hash ? { asset: { originalBase64: original, fileHash: hash, mimeType: file.type === 'image/png' ? 'image/png' : 'image/jpeg', sizeBytes: file.size, width: dims?.width, height: dims?.height } } : {}),
        };
      } catch {
        return null;
      }
    })();
    setPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    setDbh(''); setTags([]); setNote(''); setMsg(null);
    setOpen(true);
  };

  // 裏で保存（送信 or 保留）。画面は待たない
  const save = (snapshot: { species: string; dbh: string; tags: string[]; note: string }, prepP: Promise<Prepared | null>, gpsP: Promise<Gps>) => {
    setCount((c) => ({ ...c, sending: c.sending + 1 }));
    void (async () => {
      const [p, g] = await Promise.all([prepP, gpsP]);
      if (!p) { setCount((c) => ({ ...c, sending: c.sending - 1, failed: c.failed + 1 })); setMsg('写真を読めませんでした。もう一度撮ってください'); return; }
      const ids = emptyPhotoEntry();
      const memo = buildTreeMemo({ dbhCm: parseDbhInput(snapshot.dbh), tags: snapshot.tags, note: snapshot.note, accuracyM: g ? g.accuracy : null });
      const payload: FieldLogD1SubmissionPayload = {
        eventId: ids.eventId, requestId: ids.requestId, date: p.date, food: snapshot.species, place: '', memo,
        largeCategory: ENVIRONMENT_LARGE_CATEGORY, phase: '', harvested: '不明', subjectType: '環境',
        latitude: g?.lat, longitude: g?.lng, takenAt: p.takenAt, hasPhoto: true, photoFileName: p.fileName,
        photoBase64: p.asset ? undefined : p.base64,
        useR2Asset: !!p.asset,
        ...(p.asset ? { assetOriginalBase64: p.asset.originalBase64, assetFileHash: p.asset.fileHash, assetMimeType: p.asset.mimeType, assetSizeBytes: p.asset.sizeBytes, assetWidth: p.asset.width, assetHeight: p.asset.height } : {}),
      };
      const outcome = await submitWithFallback({
        entity: 'fieldLogD1', itemId: ids.requestId, payload, title: `${snapshot.species} ${memo}`,
        photoThumbnail: `data:image/jpeg;base64,${p.base64}`, displayDate: p.date, idToken,
      });
      if (outcome.ok) {
        setCount((c) => ({ ...c, sending: c.sending - 1, sent: c.sent + 1 }));
        setFlash('sent');
        if (g) {
          const recordedAt = new Date().toISOString();
          useZukanFieldStore.getState().addEntry({
            id: buildFieldLogId(p.date, g.lat, g.lng, recordedAt), foodName: snapshot.species, place: '', date: p.date, memo,
            photoUrl: '', notionUrl: '', elevation: null, kigo: '', lat: g.lat, lng: g.lng, recordedAt, eventId: ids.eventId,
            takenAt: p.takenAt, subjectType: '環境', largeCategory: ENVIRONMENT_LARGE_CATEGORY,
          });
        }
      } else {
        setCount((c) => ({ ...c, sending: c.sending - 1, queued: c.queued + 1 }));
        setFlash('queued');
        if (outcome.item.lastError?.code === 'AUTH_EXPIRED') onTokenExpired();
      }
      if (!g) setMsg('位置が取れなかった木があります（位置なしで保存。記録の一覧から 📍 で直せます）');
    })();
  };

  const finish = (next: boolean) => {
    if (next) openCamera(); // ボタンの操作の中で、保存より先にカメラを開く
    const name = species === 'その他' ? other.trim() || 'その他' : species;
    saveLastTreeSpecies(name);
    setSpecies(name); setOther(''); // 次の木は同じ樹種から（一覧に無い名前も先頭のボタンになる）
    if (prep.current && gps.current) save({ species: name, dbh, tags, note }, prep.current, gps.current);
    prep.current = null; gps.current = null;
    setOpen(false);
  };
  const cancel = () => { prep.current = null; gps.current = null; setOpen(false); };
  const toggle = (t: string) => setTags((v) => (v.includes(t) ? v.filter((x) => x !== t) : [...v, t]));
  const choices = speciesChoices(loadLastTreeSpecies());

  return (
    <>
      <button className={buttonClassName} onClick={openCamera}>🌳 木を記録</button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      {(count.sending > 0 || flash || msg) && !open && (
        <div className={styles.status} role="status" onClick={() => { setMsg(null); setFlash(null); }}>
          {count.sending > 0 && <div>送信中… {count.sending}本</div>}
          {flash === 'sent' && count.sending === 0 && <div>送信済み {count.sent}本</div>}
          {flash === 'queued' && <div>保留 {count.queued}本｜電波が戻れば送ります</div>}
          {msg && <div className={styles.warn}>{msg}</div>}
        </div>
      )}
      {open && (
        <div className={styles.overlay} role="dialog" aria-label="木を記録">
          <div className={styles.sheet}>
            <div className={styles.top}>
              {preview && <img className={styles.thumb} src={preview} alt="撮った木" />}
              <label className={styles.dbh}>
                太さ
                <input className={styles.dbhInput} type="text" inputMode="decimal" autoFocus value={dbh} onChange={(e) => setDbh(e.target.value)} placeholder="80" aria-label="太さ（cm）" />
                cm
              </label>
            </div>
            {dbh.trim() && parseDbhInput(dbh) === null && <p className={styles.warn}>太さは数字（cm）で入れてください</p>}
            <div className={styles.chips} aria-label="特徴">
              {TREE_TAGS.map((t) => (
                <button key={t} type="button" className={`${styles.chip} ${tags.includes(t) ? styles.chipOn : ''}`} aria-pressed={tags.includes(t)} onClick={() => toggle(t)}>{t}</button>
              ))}
            </div>
            <div className={styles.chips} aria-label="樹種">
              {[...choices, 'その他'].map((s) => (
                <button key={s} type="button" className={`${styles.chip} ${styles.species} ${species === s ? styles.chipOn : ''}`} aria-pressed={species === s} onClick={() => setSpecies(s)}>{s}</button>
              ))}
            </div>
            {species === 'その他' && <input className={styles.text} value={other} onChange={(e) => setOther(e.target.value)} placeholder="樹種の名前" aria-label="樹種の名前" />}
            <input className={styles.text} value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ（なくてよい）" aria-label="メモ" />
            <div className={styles.actions}>
              <button className={`${styles.btn} ${styles.primary}`} onClick={() => finish(true)}>保存して次の木</button>
              <button className={styles.btn} onClick={() => finish(false)}>保存して閉じる</button>
              <button className={styles.btn} onClick={cancel}>やめる</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
