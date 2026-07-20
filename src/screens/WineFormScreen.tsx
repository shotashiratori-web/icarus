import { useState } from 'react';
import { createWine, updateWine, deleteWine, WineValidationError } from '../api/wineEntityApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { WineEntity, WineFormInput } from '../types/wineEntity';
import type { Screen } from '../App';
import styles from './WineFormScreen.module.css';

type Props = { go: (s: Screen) => void } & (
  | { mode: 'create' }
  | { mode: 'edit'; wine: WineEntity }
);

export default function WineFormScreen(props: Props) {
  const { go, mode } = props;
  const existing = mode === 'edit' ? props.wine : null;
  const { idToken } = useAuth();

  const [photoUrl, setPhotoUrl] = useState(existing?.photos[0] ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [producer, setProducer] = useState(existing?.producer ?? '');
  const [vintage, setVintage] = useState(existing?.vintage != null ? String(existing.vintage) : '');
  const [variety, setVariety] = useState(existing?.variety ?? '');
  const [origin, setOrigin] = useState(existing?.origin ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const backToList = () => go({ name: 'wineList' });

  const handleSave = async () => {
    if (!idToken) return;
    if (!title.trim()) {
      setErrorMessage('ワイン名は必須です');
      return;
    }

    const input: WineFormInput = {
      title: title.trim(),
      description: description.trim(),
      photos: photoUrl.trim() ? [photoUrl.trim()] : [],
      tags: [],
      producer: producer.trim(),
      vintage: vintage.trim() ? Number(vintage.trim()) : null,
      variety: variety.trim(),
      origin: origin.trim(),
    };

    setSaving(true);
    setErrorMessage('');
    try {
      if (mode === 'edit') {
        await updateWine(existing!.id, input, idToken);
      } else {
        await createWine(input, idToken);
      }
      backToList();
    } catch (e) {
      if (e instanceof TokenExpiredError) return;
      setErrorMessage(
        e instanceof WineValidationError ? e.message
          : e instanceof NetworkUnknownError ? e.message
          : e instanceof Error ? e.message : '保存に失敗しました',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!idToken || mode !== 'edit') return;
    setDeleting(true);
    setErrorMessage('');
    try {
      await deleteWine(existing!.id, idToken);
      backToList();
    } catch (e) {
      if (e instanceof TokenExpiredError) return;
      setErrorMessage(e instanceof Error ? e.message : '削除に失敗しました');
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={backToList}>← ワイン一覧</button>
        <span className={styles.title}>{mode === 'edit' ? 'ワインを編集' : 'ワインを追加'}</span>
      </header>

      <main className={styles.main}>
        <div className={styles.photoWrap}>
          {photoUrl
            ? <img className={styles.photo} src={photoUrl} alt="" />
            : <div className={styles.photoPlaceholder}>🍷</div>}
        </div>
        <label className={styles.field}>
          <span className={styles.label}>写真URL</span>
          <input className={styles.input} type="text" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://..." />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>ワイン名 *</span>
          <input className={styles.input} type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ワイン名" />
        </label>

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>生産者</span>
            <input className={styles.input} type="text" value={producer} onChange={(e) => setProducer(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>ヴィンテージ</span>
            <input className={styles.input} type="number" value={vintage} onChange={(e) => setVintage(e.target.value)} placeholder="例: 2021" />
          </label>
        </div>

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>品種</span>
            <input className={styles.input} type="text" value={variety} onChange={(e) => setVariety(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>産地</span>
            <input className={styles.input} type="text" value={origin} onChange={(e) => setOrigin(e.target.value)} />
          </label>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>メモ</span>
          <textarea className={styles.textarea} value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </label>

        {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}

        <div className={styles.actions}>
          <button className={styles.saveBtn} disabled={saving || deleting} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存する'}
          </button>

          {mode === 'edit' && !confirmingDelete && (
            <button className={styles.deleteBtn} disabled={saving || deleting} onClick={() => setConfirmingDelete(true)}>
              このワインを削除
            </button>
          )}
          {mode === 'edit' && confirmingDelete && (
            <div className={styles.confirmRow}>
              <span className={styles.confirmText}>本当に削除しますか？</span>
              <button className={styles.deleteBtn} disabled={deleting} onClick={() => void handleDelete()}>
                {deleting ? '削除中…' : '削除する'}
              </button>
              <button className={styles.cancelBtn} disabled={deleting} onClick={() => setConfirmingDelete(false)}>
                キャンセル
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
