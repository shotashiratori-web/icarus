import { useState } from 'react';
import { createSpot, updateSpot, deleteSpot, SpotValidationError } from '../api/spotEntityApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { SpotEntity, SpotFormInput } from '../types/spotEntity';
import type { Screen } from '../App';
import styles from './SpotFormScreen.module.css';

type Props = { go: (s: Screen) => void } & (
  | { mode: 'create'; initial?: { lat?: number; lng?: number; photoUrl?: string } }
  | { mode: 'edit'; spot: SpotEntity }
);

export default function SpotFormScreen(props: Props) {
  const { go, mode } = props;
  const existing = mode === 'edit' ? props.spot : null;
  const initial = mode === 'create' ? props.initial : undefined;
  const { idToken } = useAuth();

  const [photoUrl, setPhotoUrl] = useState(existing?.photos[0] ?? initial?.photoUrl ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [lat, setLat] = useState(existing?.lat != null ? String(existing.lat) : initial?.lat != null ? String(initial.lat) : '');
  const [lng, setLng] = useState(existing?.lng != null ? String(existing.lng) : initial?.lng != null ? String(initial.lng) : '');
  const [description, setDescription] = useState(existing?.description ?? '');

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const backToList = () => go({ name: 'spotList' });

  const handleSave = async () => {
    if (!idToken) return;
    if (!title.trim()) {
      setErrorMessage('スポット名は必須です');
      return;
    }

    const input: SpotFormInput = {
      title: title.trim(),
      description: description.trim(),
      photos: photoUrl.trim() ? [photoUrl.trim()] : [],
      tags: [],
      category: category.trim(),
      lat: lat.trim() ? Number(lat.trim()) : null,
      lng: lng.trim() ? Number(lng.trim()) : null,
    };

    setSaving(true);
    setErrorMessage('');
    try {
      if (mode === 'edit') {
        await updateSpot(existing!.id, input, idToken);
      } else {
        await createSpot(input, idToken);
      }
      backToList();
    } catch (e) {
      if (e instanceof TokenExpiredError) return;
      setErrorMessage(
        e instanceof SpotValidationError ? e.message
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
      await deleteSpot(existing!.id, idToken);
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
        <button className={styles.back} onClick={backToList}>← スポット一覧</button>
        <span className={styles.title}>{mode === 'edit' ? 'スポットを編集' : 'スポットを追加'}</span>
      </header>

      <main className={styles.main}>
        <div className={styles.photoWrap}>
          {photoUrl
            ? <img className={styles.photo} src={photoUrl} alt="" />
            : <div className={styles.photoPlaceholder}>📍</div>}
        </div>
        <label className={styles.field}>
          <span className={styles.label}>写真URL</span>
          <input className={styles.input} type="text" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://..." />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>スポット名 *</span>
          <input className={styles.input} type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 〇〇神社" />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>種別</span>
          <input className={styles.input} type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="例: 神社・看板・採集ポイント・工房・店・景観など" />
        </label>

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>緯度</span>
            <input className={styles.input} type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="任意" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>経度</span>
            <input className={styles.input} type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="任意" />
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
              このスポットを削除
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
