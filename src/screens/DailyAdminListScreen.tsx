import { useEffect, useState } from 'react';
import { fetchDailyList, commentOnDaily, confirmDaily, requestMoreOnDaily, ForbiddenRoleError } from '../api/dailyApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import { CONCERN_TYPE_LABELS, type DailyEntry } from '../types/daily';
import type { Screen } from '../App';
import styles from './DailyAdminListScreen.module.css';

type Props = { go: (s: Screen) => void };
type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type Tab = 'submitted' | 'revision_requested' | 'confirmed';

export default function DailyAdminListScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [items, setItems] = useState<DailyEntry[]>([]);
  const [tab, setTab] = useState<Tab>('submitted');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');

  const load = async (token: string) => {
    setState('loading');
    try {
      const result = await fetchDailyList({}, token);
      setItems(result);
      setState('ready');
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
      if (e instanceof ForbiddenRoleError) { setState('forbidden'); return; }
      setErrorMessage(e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました');
      setState('error');
    }
  };

  useEffect(() => {
    if (authState === 'ready' && idToken) void load(idToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, idToken]);

  const grouped = {
    submitted: items.filter((i) => i.status === 'submitted'),
    revision_requested: items.filter((i) => i.status === 'revision_requested'),
    confirmed: items.filter((i) => i.status === 'confirmed'),
  };

  const draftFor = (item: DailyEntry) => drafts[item.id] ?? item.mentorComment ?? '';

  const runAction = async (id: number, action: () => Promise<void>) => {
    if (!idToken) return;
    setBusyId(id);
    setActionError('');
    try {
      await action();
      await load(idToken);
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
      setActionError(e instanceof Error ? e.message : '操作に失敗しました');
    } finally {
      setBusyId(null);
    }
  };

  const handleComment = (item: DailyEntry) => {
    const comment = draftFor(item).trim();
    if (!comment) { setActionError('コメントを入力してください'); return; }
    void runAction(item.id, () => commentOnDaily(item.id, comment, idToken!));
  };

  const handleConfirm = (item: DailyEntry) => {
    const comment = draftFor(item).trim();
    void runAction(item.id, () => confirmDaily(item.id, comment || undefined, idToken!));
  };

  const handleRequestMore = (item: DailyEntry) => {
    const comment = draftFor(item).trim();
    if (!comment) { setActionError('追記をお願いする場合はコメントが必須です'); return; }
    void runAction(item.id, () => requestMoreOnDaily(item.id, comment, idToken!));
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
        <span className={styles.title}>Daily確認</span>
      </header>

      <main className={styles.main}>
        {(authState === 'checking' || (authState === 'ready' && state === 'loading')) && (
          <div className={styles.skeletonList}>
            {[0, 1, 2].map((i) => (<div key={i} className={styles.skeletonItem} />))}
          </div>
        )}

        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインするとDailyを確認できます</p>
            <div ref={signInContainerRef} />
          </div>
        )}

        {authState === 'ready' && state === 'forbidden' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>管理者のみ利用できます</p>
            <button className={styles.retryBtn} onClick={() => go({ name: 'home' })}>ホームへ戻る</button>
          </div>
        )}

        {authState === 'ready' && state === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={() => idToken && load(idToken)}>再読み込み</button>
          </div>
        )}

        {state === 'ready' && (
          <>
            <div className={styles.tabs}>
              {([
                ['submitted', '未確認'],
                ['revision_requested', '追記依頼中'],
                ['confirmed', '確認済み'],
              ] as [Tab, string][]).map(([t, label]) => (
                <button
                  key={t}
                  className={`${styles.tabBtn} ${tab === t ? styles.tabBtnActive : ''}`}
                  onClick={() => setTab(t)}
                >
                  {label} ({grouped[t].length})
                </button>
              ))}
            </div>

            {actionError && <p className={styles.actionError}>{actionError}</p>}

            {grouped[tab].length === 0 && <p className={styles.empty}>該当するDailyはありません</p>}

            <div className={styles.list}>
              {grouped[tab].map((item) => {
                const expanded = expandedId === item.id;
                return (
                  <div key={item.id} className={styles.card}>
                    <div className={styles.cardHeader} onClick={() => setExpandedId(expanded ? null : item.id)}>
                      <span className={styles.name}>{item.displayName || item.staffEmail}</span>
                      <span className={styles.date}>{item.entryDate}</span>
                      <span className={styles.satisfaction}>満足度 {item.satisfaction}/5</span>
                      {tab === 'revision_requested' && <span className={styles.statusBadge}>追記依頼中</span>}
                    </div>

                    {expanded && (
                      <div className={styles.body}>
                        <BodyField label="心が動いたこと" value={item.movedMoment} />
                        <BodyField label="学び" value={item.learning} />
                        <BodyField label="真似したいこと" value={item.imitate} />
                        <BodyField label="明日の挑戦（心構え）" value={item.challengeMindset} />
                        <BodyField label="明日の挑戦（技術・仕事）" value={item.challengeSkill} />
                        <BodyField label="明日の挑戦（行動）" value={item.challengeAction} />
                        <BodyField label="余市を感じたこと" value={item.yoichiMoment} />
                        {item.concernText && (
                          <BodyField
                            label={`困っていること${item.concernType ? `（${CONCERN_TYPE_LABELS[item.concernType]}）` : ''}`}
                            value={item.concernText}
                          />
                        )}
                        <BodyField label="満足度の理由" value={item.satisfactionReason} />
                      </div>
                    )}

                    {tab === 'submitted' && (
                      <div className={styles.actionsRow}>
                        <textarea
                          className={styles.commentInput}
                          value={draftFor(item)}
                          disabled={busyId === item.id}
                          onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                          placeholder="コメント・アドバイス"
                        />
                        <div className={styles.buttonRow}>
                          <button className={styles.secondaryBtn} disabled={busyId === item.id} onClick={() => handleComment(item)}>
                            コメントを保存
                          </button>
                          <button className={styles.primaryBtn} disabled={busyId === item.id} onClick={() => handleConfirm(item)}>
                            確認する
                          </button>
                          <button className={styles.dangerBtn} disabled={busyId === item.id} onClick={() => handleRequestMore(item)}>
                            追記をお願いする
                          </button>
                        </div>
                      </div>
                    )}

                    {tab !== 'submitted' && item.mentorComment && (
                      <div className={styles.mentorCommentBox}>
                        <span className={styles.bodyLabel}>管理者コメント</span>
                        <p className={styles.bodyValue}>{item.mentorComment}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function BodyField({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.bodyField}>
      <span className={styles.bodyLabel}>{label}</span>
      <p className={styles.bodyValue}>{value}</p>
    </div>
  );
}
