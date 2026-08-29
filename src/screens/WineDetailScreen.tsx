import { useEffect, useState } from 'react';
import type { WineEntity } from '../types/wineEntity';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import { useAuth } from '../context/AuthContext';
import { fetchWineTastingNotesByWine, type WineTastingNoteItem } from '../api/wineTastingNoteApi';
import { TokenExpiredError } from '../api/icarusApi';
import styles from './WineDetailScreen.module.css';

type Props = { go: (s: Screen) => void; entry: WineEntity };
type TastingNotesState = 'idle' | 'loading' | 'ready' | 'error';

// カードに全文を詰め込みすぎない（Stage 1C-B Stage 14の方針）。改行はスペースへ畳んで1行preview化する
export function previewText(text: string, maxLength: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}…` : flat;
}

export default function WineDetailScreen({ go, entry }: Props) {
  const { authState, idToken, handleTokenExpired } = useAuth();
  const [tastingNotes, setTastingNotes] = useState<WineTastingNoteItem[]>([]);
  const [tastingNotesState, setTastingNotesState] = useState<TastingNotesState>('idle');

  // Stage 1C-B: Wine基本情報の表示はblockingしない。Tasting Notesセクションだけ
  // 独立したloading/error状態を持つ。private ownership（本人のNoteのみ）はStage 1AのAPI側で
  // 保証されるため、ここでcreatedByによる追加filterは行わない
  useEffect(() => {
    if (authState !== 'ready' || !idToken) return;
    let cancelled = false;
    setTastingNotesState('loading');
    fetchWineTastingNotesByWine(entry.id, idToken)
      .then((items) => { if (!cancelled) { setTastingNotes(items); setTastingNotesState('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
        setTastingNotesState('error');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, authState, idToken]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'wineList' })}>← 一覧へ戻る</button>
        <span className={styles.title}>ワイン</span>
        <HomeButton go={go} />
      </header>

      <main className={styles.main}>
        <div className={styles.photoWrap}>
          {entry.photos[0]
            ? <img className={styles.photo} src={entry.photos[0]} alt={entry.title} />
            : <div className={styles.photoPlaceholder}>🍷</div>}
        </div>

        <h1 className={styles.wineTitle}>{entry.title || '無題'}</h1>

        <div className={styles.metaRow}>
          {entry.producer && <span className={styles.metaItem}>🏭 {entry.producer}</span>}
          {entry.vintage && <span className={styles.metaItem}>{entry.vintage}</span>}
          {entry.origin && <span className={styles.metaItem}>📍 {entry.origin}</span>}
        </div>

        {entry.variety && <span className={styles.tag}>{entry.variety}</span>}

        {entry.description && (
          <div className={styles.memoBox}>
            <p className={styles.memoLabel}>メモ</p>
            <p className={styles.memoText}>{entry.description}</p>
          </div>
        )}

        {entry.photos.length > 1 && (
          <div className={styles.sourceBox}>
            <p className={styles.sourceLabel}>元データ（そのままの記録）</p>
            <div className={styles.sourceImages}>
              {entry.photos.slice(1).map((url) => (
                <img key={url} className={styles.sourceImage} src={url} alt="元データ" />
              ))}
            </div>
          </div>
        )}

        {/* Phase10以降: ここに関連フィールド・関連料理・関連加工・関連DailyなどのKnowledge Relationセクションを追加する想定。
            Tasting Noteのみ Stage 1C-Bで先行実装（read-only）。他は引き続き空のハブのまま */}

        {tastingNotesState !== 'idle' && (
          <div className={styles.tastingNotesSection}>
            <p className={styles.sourceLabel}>テイスティングノート</p>

            {tastingNotesState === 'loading' && (
              <p className={styles.tastingNotesHint}>読み込み中…</p>
            )}
            {tastingNotesState === 'error' && (
              <p className={styles.tastingNotesHint}>テイスティングノートを取得できませんでした</p>
            )}
            {tastingNotesState === 'ready' && tastingNotes.length === 0 && (
              <p className={styles.tastingNotesHint}>このワインのテイスティングノートはまだありません</p>
            )}
            {tastingNotesState === 'ready' && tastingNotes.length > 0 && (
              <div className={styles.tastingNoteList}>
                {tastingNotes.map((note) => (
                  <div key={note.id} className={styles.tastingNoteCard}>
                    {(note.tastingDate || note.location) && (
                      <div className={styles.tastingNoteMeta}>
                        {note.tastingDate && <span>{note.tastingDate}</span>}
                        {note.location && <span>{note.location}</span>}
                      </div>
                    )}
                    {note.aromaText && <p className={styles.tastingNoteAroma}>{previewText(note.aromaText, 40)}</p>}
                    {note.memoText && <p className={styles.tastingNoteMemoText}>{previewText(note.memoText, 80)}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={styles.linkRow}>
          <button className={styles.editBtn} onClick={() => go({ name: 'wineForm', mode: 'edit', wine: entry })}>
            ✏️ 編集する
          </button>
        </div>
      </main>
    </div>
  );
}
