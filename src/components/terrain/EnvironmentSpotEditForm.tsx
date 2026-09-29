import { useMemo, useState } from 'react';
import { editErrorMessage, patchEnvironmentSpot } from '../../api/environmentSpotsApi';
import { KIND_CHOICES, type EnvSpeciesItem, type EnvironmentSpot, type SpotKindChoice } from '../../environmentSpots/types';
import styles from './EnvironmentSpots.module.css';

// 環境スポットの訂正（S3）。変えた項目だけを送り、理由と一緒に履歴へ残す。座標は「現在地で取り直す」（GPS 精度つき）
// 訂正は端末に保存せず、電波のある時だけ（衝突したら開き直してもらう）

type Props = {
  spot: EnvironmentSpot;
  species: EnvSpeciesItem[];
  idToken: string | null;
  here: { lat: number; lng: number; accuracy: number } | null;
  onDone: () => void;
  onCancel: () => void;
};

const kindOf = (s: EnvironmentSpot): SpotKindChoice => (s.envType === 'tree' ? (s.lifeState as SpotKindChoice) : s.envType);

export default function EnvironmentSpotEditForm({ spot, species, idToken, here, onDone, onCancel }: Props) {
  const [kind, setKind] = useState<SpotKindChoice>(kindOf(spot));
  const [speciesId, setSpeciesId] = useState<string | null>(spot.treeSpeciesId);
  const [speciesText, setSpeciesText] = useState(spot.treeSpeciesText ?? '');
  const [dbh, setDbh] = useState(spot.dbhCm ? String(spot.dbhCm) : '');
  const [decay, setDecay] = useState<number | null>(spot.decayClass);
  const [memo, setMemo] = useState(spot.memo);
  const [retake, setRetake] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choice = KIND_CHOICES.find((k) => k.id === kind)!;
  const isTree = choice.envType === 'tree';
  const trees = useMemo(() => species.filter((s) => s.kind === 'tree').sort((a, b) => a.sortOrder - b.sortOrder), [species]);
  const other = trees.find((s) => s.id === speciesId)?.isOther ?? false;

  const changes = useMemo(() => {
    const c: Record<string, unknown> = {};
    if (choice.envType !== spot.envType) c.envType = choice.envType;
    if (choice.lifeState !== spot.lifeState) c.lifeState = choice.lifeState;
    const sid = isTree ? speciesId : null;
    if (sid !== spot.treeSpeciesId) c.treeSpeciesId = sid;
    const stext = isTree && other ? speciesText.trim() || null : null;
    if (stext !== spot.treeSpeciesText) c.treeSpeciesText = stext;
    const d = isTree && dbh.trim() ? Number(dbh) : null;
    if (d !== spot.dbhCm) c.dbhCm = d;
    const dc = choice.lifeState === 'snag' || choice.lifeState === 'fallen' ? decay : null;
    if (dc !== spot.decayClass) c.decayClass = dc;
    if (memo.trim() !== spot.memo) c.memo = memo.trim();
    if (retake && here) c.location = { lat: here.lat, lng: here.lng, source: 'gps', gpsAccuracyM: here.accuracy };
    return c;
  }, [choice, spot, isTree, speciesId, other, speciesText, dbh, decay, memo, retake, here]);

  const problems: string[] = [];
  if (isTree && !speciesId) problems.push('樹種を選んでください（分からない時は「不明」）');
  if (isTree && other && !speciesText.trim()) problems.push('「その他」の樹種名を入力してください');
  if (Object.keys(changes).length === 0) problems.push('変更がありません');

  const save = async () => {
    if (!idToken || problems.length) return;
    setSaving(true);
    setError(null);
    try {
      await patchEnvironmentSpot(spot.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: spot.updatedAt, changes, ...(reason.trim() ? { reason: reason.trim() } : {}) }, idToken);
      onDone();
    } catch (e) {
      setError(editErrorMessage(e));
      setSaving(false);
    }
  };

  return (
    <div>
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
          {other && <input className={styles.input} value={speciesText} onChange={(e) => setSpeciesText(e.target.value)} placeholder="樹種名" maxLength={60} />}
          <p className={styles.label}>太さ（胸高直径 cm）</p>
          <input className={styles.input} inputMode="numeric" value={dbh} onChange={(e) => setDbh(e.target.value.replace(/[^0-9]/g, ''))} />
          {(choice.lifeState === 'snag' || choice.lifeState === 'fallen') && (
            <div className={styles.chips}>
              {[1, 2, 3].map((v) => (
                <button key={v} className={`${styles.chip} ${decay === v ? styles.on : ''}`} onClick={() => setDecay(decay === v ? null : v)}>腐朽 {v}</button>
              ))}
            </div>
          )}
        </>
      )}
      <p className={styles.label}>メモ</p>
      <textarea className={styles.input} rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={2000} />
      <p className={styles.label}>位置</p>
      {here ? (
        <label>
          <input type="checkbox" checked={retake} onChange={(e) => setRetake(e.target.checked)} /> 現在地で取り直す（精度 約{Math.round(here.accuracy)}m）
        </label>
      ) : <p className={styles.sub}>位置を取り直す時は、その木の前で現在地を表示してください</p>}
      <p className={styles.label}>訂正の理由（任意・履歴に残ります）</p>
      <input className={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例: 樹種の見間違い" maxLength={500} />
      {problems.length > 0 && <p className={styles.sub}>{problems[0]}</p>}
      {!idToken && <p className={styles.warn}>訂正にはログインが必要です</p>}
      {error && <p className={styles.warn}>{error}</p>}
      <div className={styles.actions}>
        <button className={styles.btn} onClick={onCancel}>やめる</button>
        <button className={`${styles.btn} ${styles.primary}`} disabled={!idToken || problems.length > 0 || saving} onClick={() => void save()}>{saving ? '送信中…' : '訂正を送信'}</button>
      </div>
    </div>
  );
}
