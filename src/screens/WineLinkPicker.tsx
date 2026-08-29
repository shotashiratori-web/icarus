import { useEffect, useMemo, useState } from 'react';
import { fetchWines } from '../api/wineEntityApi';
import { TokenExpiredError } from '../api/icarusApi';
import { rankWineCandidates } from '../utils/wineLinkMatch';
import type { WineEntity } from '../types/wineEntity';
import styles from './WineLinkPicker.module.css';

type Props = {
  initialQuery: string;
  producerHint: string;
  vintageHint: string;
  idToken: string;
  onSelect: (wine: WineEntity) => void;
  onClose: () => void;
  onTokenExpired: () => void;
};

type LoadState = 'loading' | 'ready' | 'error';

// Tasting Note Persistence v1（Stage 1C-A）。Tasting Noteから既存Wine Entityを検索し、
// ユーザーが手動で1件選ぶための全画面オーバーレイ。新しいScreen routingは追加せず、
// RecordScreen内で条件描画するだけに留める（既存Navigation設計を変えない最小構成）。
// 自動紐付け・自動新規作成は行わない——候補は常に一覧として提示し、タップされて初めて確定する
export default function WineLinkPicker({ initialQuery, producerHint, vintageHint, idToken, onSelect, onClose, onTokenExpired }: Props) {
  const [wines, setWines] = useState<WineEntity[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    fetchWines({}, idToken)
      .then((items) => { if (!cancelled) { setWines(items); setState('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof TokenExpiredError) { onTokenExpired(); return; }
        setState('error');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  const candidates = useMemo(
    () => rankWineCandidates(wines, query, { wineName: initialQuery, producer: producerHint, vintage: vintageHint }),
    [wines, query, initialQuery, producerHint, vintageHint],
  );

  return (
    <div className={styles.overlay} role="dialog" aria-label="ワイン図鑑と紐付ける">
      <header className={styles.header}>
        <button className={styles.closeBtn} onClick={onClose}>← 戻る</button>
        <span className={styles.title}>ワイン図鑑と紐付ける</span>
      </header>

      <div className={styles.searchBar}>
        <input
          className={styles.searchInput}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ワイン名・生産者・年で検索"
          autoFocus
        />
      </div>

      <main className={styles.main}>
        {state === 'loading' && <p className={styles.hintText}>読み込み中…</p>}
        {state === 'error' && <p className={styles.hintText}>ワイン図鑑の取得に失敗しました</p>}

        {state === 'ready' && candidates.length === 0 && (
          <p className={styles.hintText}>該当するワインが見つかりません</p>
        )}

        {state === 'ready' && candidates.length > 0 && (
          <ul className={styles.list}>
            {candidates.map((w) => (
              <li key={w.id}>
                <button className={styles.item} onClick={() => onSelect(w)}>
                  <span className={styles.itemTitle}>{w.title || '無題'}</span>
                  <span className={styles.itemMeta}>
                    {[w.producer, w.vintage ? String(w.vintage) : ''].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
