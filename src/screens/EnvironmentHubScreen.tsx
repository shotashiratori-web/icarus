import { useRef, useState } from 'react';
import { LocalGpxError, saveNewExploration } from '../exploration/sync';
import { displayStatus, STATUS_LABEL } from '../exploration/types';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import styles from './HomeScreen.module.css';

// 「🌲 環境を記録」の入口（ホーム）。山で: 木・倒木・地形を Field Log（🌲 環境）で送る／帰宅後: YAMAP の GPX を探索履歴へ登録。
// GPX は選んだら端末に保存（下書き。通信しない）してから、地形探索の「記録」タブでその記録の入力を開く
type Props = { go: (s: Screen) => void };

export default function EnvironmentHubScreen({ go }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onGpx = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const { record, existing } = await saveNewExploration({ fileName: file.name, bytes, explorerNames: [], purpose: 'unknown', memo: '', targets: [] }, false);
      if (existing && record.ready) {
        setNotice(`この GPX はすでに登録・保存されています（${STATUS_LABEL[displayStatus(record)]}）。2 件目は作りません`);
        return;
      }
      go({ name: 'zukanFieldMap', from: { name: 'environmentHub' }, openGpxDraftId: record.id });
    } catch (e) {
      setNotice(e instanceof LocalGpxError ? `${e.message}（保存していません）` : 'GPX を読み込めませんでした（保存していません）');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className={styles.root}>
      <header className={styles.header} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className={styles.viewAll} onClick={() => go({ name: 'home' })}>← 戻る</button>
        <strong>🌲 環境を記録</strong>
        <HomeButton go={go} />
      </header>
      <main className={styles.main}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>山で</h2></div>
          <button className={styles.cta} onClick={() => go({ name: 'foodLog', subjectType: '環境' })}>
            <span className={styles.ctaIcon}>🌲</span>
            <span className={styles.ctaLabel}>木・倒木・地形を送る</span>
            <span className={styles.ctaArrow}>→ 記録</span>
          </button>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>帰宅後</h2></div>
          <label className={styles.cta} aria-disabled={busy}>
            <span className={styles.ctaIcon}>🥾</span>
            <span className={styles.ctaLabel}>{busy ? 'GPX を読み込み中…' : 'YAMAP の GPX を登録'}</span>
            <span className={styles.ctaArrow}>→ 選ぶ</span>
            {/* iPhone は accept で拡張子を絞ると .gpx を選べないため付けない（探索履歴と同じ） */}
            <input ref={fileRef} type="file" hidden disabled={busy} onChange={(e) => void onGpx(e.target.files?.[0])} aria-label="YAMAP の GPX ファイル" />
          </label>
          <p style={{ fontSize: 'var(--font-size-xs)', margin: '4px 0' }}>YAMAP で書き出した GPX を選ぶと、端末に保存してから、歩いた人・目的・探した対象・使った仮説の入力に進みます（送信は電波のある所で）</p>
          {notice && <p role="status" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger, #c62828)' }}>{notice}</p>}
        </section>
      </main>
    </div>
  );
}
