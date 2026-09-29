import { useEffect, useMemo, useState } from 'react';
import { photoFromFile } from '../../environmentSpots/sync';
import {
  KIND_CHOICES, PHOTO_MISSING_LABEL, type EnvSpeciesItem, type LocationSource, type PendingPhoto, type PendingSpot, type PhotoMissingReason, type SpotKindChoice,
} from '../../environmentSpots/types';
import styles from './EnvironmentSpots.module.css';

// 環境スポットの記録（S3 §3-1）。現場の速さ優先: 大きなボタン → 樹種 → 写真 → メモ。
// 写真は原則 1 枚以上。写真なしは理由が必須（暗い／危険で撮影不可／カメラ不調／その他）。
// 位置は 現在地（GPS 精度つき）か 地図で指定（GPS 精度は持たない）

export interface RecordLocation {
  lat: number;
  lng: number;
  source: LocationSource;
  accuracyM: number | null;
}

type Props = {
  location: RecordLocation;
  species: EnvSpeciesItem[];
  terrainAt: (lat: number, lng: number) => Record<string, unknown> | null;
  onSave: (body: PendingSpot['body'], photos: PendingPhoto[]) => Promise<void>;
  onClose: () => void;
};

export default function EnvironmentSpotRecordSheet({ location, species, terrainAt, onSave, onClose }: Props) {
  const [kind, setKind] = useState<SpotKindChoice | null>(null);
  const [speciesId, setSpeciesId] = useState<string | null>(null);
  const [speciesText, setSpeciesText] = useState('');
  const [dbh, setDbh] = useState('');
  const [decay, setDecay] = useState<number | null>(null);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [missing, setMissing] = useState<PhotoMissingReason | null>(null);
  const [missingMemo, setMissingMemo] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choice = KIND_CHOICES.find((k) => k.id === kind) ?? null;
  const isTree = choice?.envType === 'tree';
  const trees = useMemo(() => species.filter((s) => s.kind === 'tree').sort((a, b) => a.sortOrder - b.sortOrder), [species]);
  const other = trees.find((s) => s.id === speciesId)?.isOther ?? false;
  const urls = useMemo(() => photos.map((p) => (p.data ? URL.createObjectURL(new Blob([p.data], { type: p.type })) : '')), [photos]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);

  const dbhNum = dbh.trim() ? Number(dbh) : null;
  const problems: string[] = [];
  if (!choice) problems.push('種類を選んでください');
  if (isTree && !speciesId) problems.push('樹種を選んでください（分からない時は「不明」）');
  if (isTree && other && !speciesText.trim()) problems.push('「その他」の樹種名を入力してください');
  if (dbhNum !== null && !(Number.isInteger(dbhNum) && dbhNum >= 1 && dbhNum <= 400)) problems.push('太さは 1〜400 の整数（cm）');
  if (photos.length === 0 && !missing) problems.push('写真を撮るか、写真が無い理由を選んでください');

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    try {
      const add: PendingPhoto[] = [];
      for (const f of Array.from(files)) add.push(await photoFromFile(f));
      setPhotos((cur) => [...cur, ...add].slice(0, 10));
      setMissing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '写真を読めませんでした');
    }
  };

  const save = async () => {
    if (!choice || problems.length) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        envType: choice.envType, lifeState: choice.lifeState,
        treeSpeciesId: isTree ? speciesId : null, treeSpeciesText: isTree && other ? speciesText.trim() : null,
        dbhCm: isTree ? dbhNum : null, decayClass: choice.lifeState === 'snag' || choice.lifeState === 'fallen' ? decay : null,
        lat: location.lat, lng: location.lng, locationSource: location.source, gpsAccuracyM: location.source === 'gps' ? location.accuracyM : null,
        photoMissingReason: photos.length ? null : missing, photoMissingMemo: photos.length ? null : missingMemo.trim() || null,
        memo: memo.trim(), observedAt: new Date().toISOString(), terrain: terrainAt(location.lat, location.lng),
      }, photos);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした');
      setSaving(false);
    }
  };

  return (
    <section className={styles.sheet} role="dialog" aria-label="環境スポットを記録">
      <div className={styles.head}>
        <h3>環境スポットを記録</h3>
        <button className={styles.btn} onClick={onClose}>やめる</button>
      </div>
      <p className={styles.sub}>
        位置: {location.lat.toFixed(6)}, {location.lng.toFixed(6)}（{location.source === 'gps' ? `現在地${location.accuracyM !== null ? `・精度 約${Math.round(location.accuracyM)}m` : ''}` : '地図で指定'}）
      </p>
      {location.source === 'gps' && location.accuracyM !== null && location.accuracyM > 30 && <p className={styles.warn}>GPS の精度が低めです（{Math.round(location.accuracyM)}m）。少し待つか、空の開けた所で記録すると正確になります</p>}

      <p className={styles.label}>種類</p>
      <div className={styles.bigButtons}>
        {KIND_CHOICES.map((k) => (
          <button key={k.id} className={`${styles.big} ${kind === k.id ? styles.on : ''}`} onClick={() => setKind(k.id)} aria-pressed={kind === k.id}>{k.label}</button>
        ))}
      </div>

      {isTree && (
        <>
          <p className={styles.label}>樹種</p>
          <div className={styles.chips}>
            {trees.map((s) => (
              <button key={s.id} className={`${styles.chip} ${speciesId === s.id ? styles.on : ''}`} onClick={() => setSpeciesId(s.id)} aria-pressed={speciesId === s.id}>{s.name}</button>
            ))}
          </div>
          {trees.length === 0 && <p className={styles.warn}>樹種の一覧がまだ端末にありません。電波のある所で地形探索を一度開いてください</p>}
          {other && <input className={styles.input} value={speciesText} onChange={(e) => setSpeciesText(e.target.value)} placeholder="樹種名（例: キハダ）" maxLength={60} />}
          <p className={styles.label}>太さ（胸高直径・任意）</p>
          <input className={styles.input} inputMode="numeric" value={dbh} onChange={(e) => setDbh(e.target.value.replace(/[^0-9]/g, ''))} placeholder="cm" />
          {(choice?.lifeState === 'snag' || choice?.lifeState === 'fallen') && (
            <>
              <p className={styles.label}>腐朽度（任意）</p>
              <div className={styles.chips}>
                {[[1, '1 硬い'], [2, '2 一部腐朽'], [3, '3 ぼろぼろ']].map(([v, l]) => (
                  <button key={v} className={`${styles.chip} ${decay === v ? styles.on : ''}`} onClick={() => setDecay(decay === v ? null : (v as number))}>{l}</button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <p className={styles.label}>写真</p>
      <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} />
      {photos.length > 0 && (
        <div className={styles.photos}>
          {photos.map((p, i) => urls[i] && <img key={p.id} src={urls[i]} alt={`写真 ${i + 1}`} />)}
          <button className={styles.btn} onClick={() => setPhotos([])}>写真を外す</button>
        </div>
      )}
      {photos.length === 0 && (
        <>
          <p className={styles.sub}>写真が撮れない時は理由を選んでください</p>
          <div className={styles.chips}>
            {(Object.keys(PHOTO_MISSING_LABEL) as PhotoMissingReason[]).map((r) => (
              <button key={r} className={`${styles.chip} ${missing === r ? styles.on : ''}`} onClick={() => setMissing(missing === r ? null : r)}>{PHOTO_MISSING_LABEL[r]}</button>
            ))}
          </div>
          {missing && <input className={styles.input} value={missingMemo} onChange={(e) => setMissingMemo(e.target.value)} placeholder="補足（任意）" maxLength={500} />}
        </>
      )}

      <p className={styles.label}>メモ（任意）</p>
      <textarea className={styles.input} rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={2000} />

      {problems.length > 0 && <p className={styles.sub}>{problems[0]}</p>}
      {error && <p className={styles.warn}>{error}</p>}
      <div className={styles.actions}>
        <button className={`${styles.btn} ${styles.primary}`} disabled={problems.length > 0 || saving} onClick={() => void save()}>{saving ? '保存中…' : '端末に保存して送信'}</button>
      </div>
      <p className={styles.sub}>圏外でも端末に保存され、電波のある所で自動的に送信します（写真の原本も送信が済むまで端末に残ります）</p>
    </section>
  );
}
