import { useEffect, useState } from 'react';
import {
  fetchStaffRoster, approveStaff, updateStaff, changeRole, suspendStaff, reactivateStaff,
  ForbiddenRoleError,
} from '../api/staffApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { StaffRosterItem, StaffRole } from '../types/staff';
import type { Screen } from '../App';
import styles from './StaffApprovalScreen.module.css';

type Props = { go: (s: Screen) => void };
type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type Tab = 'pending' | 'active' | 'suspended';

function formatDate(s: string | null): string {
  if (!s) return '—';
  return s.slice(0, 16).replace('T', ' ');
}

export default function StaffApprovalScreen({ go }: Props) {
  const { idToken, userEmail, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [items, setItems] = useState<StaffRosterItem[]>([]);
  const [tab, setTab] = useState<Tab>('pending');
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [draftRoles, setDraftRoles] = useState<Record<string, StaffRole>>({});

  const load = async (token: string) => {
    setState('loading');
    try {
      const result = await fetchStaffRoster(token);
      setItems(result);
      setState('ready');
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
      if (e instanceof ForbiddenRoleError) { setState('forbidden'); return; }
      setErrorMessage(e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました');
      setState('error');
    }
  };

  const retry = () => { if (idToken) void load(idToken); };

  useEffect(() => {
    if (authState === 'ready' && idToken) void load(idToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, idToken]);

  const nameFor = (item: StaffRosterItem) => draftNames[item.email] ?? item.displayName;
  const roleFor = (item: StaffRosterItem) => draftRoles[item.email] ?? item.role;

  const runAction = async (email: string, action: () => Promise<void>) => {
    if (!idToken) return;
    setBusyEmail(email);
    setActionError('');
    try {
      await action();
      await load(idToken);
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
      setActionError(e instanceof Error ? e.message : '操作に失敗しました');
    } finally {
      setBusyEmail(null);
    }
  };

  const handleApprove = (item: StaffRosterItem) => {
    const displayName = nameFor(item).trim();
    if (!displayName) { setActionError('表示名を入力してください'); return; }
    void runAction(item.email, () => approveStaff({ email: item.email, displayName, role: roleFor(item) }, idToken!));
  };

  const handleUpdateName = (item: StaffRosterItem) => {
    const displayName = nameFor(item).trim();
    if (!displayName) { setActionError('表示名を入力してください'); return; }
    if (displayName === item.displayName) return;
    void runAction(item.email, () => updateStaff({ email: item.email, displayName }, idToken!));
  };

  const handleChangeRole = (item: StaffRosterItem, role: StaffRole) => {
    setDraftRoles((d) => ({ ...d, [item.email]: role }));
    if (item.status !== 'active') return; // pending中はapprove時にまとめて反映
    void runAction(item.email, () => changeRole({ email: item.email, role }, idToken!));
  };

  const handleSuspend = (item: StaffRosterItem) => {
    void runAction(item.email, () => suspendStaff({ email: item.email }, idToken!));
  };

  const handleReactivate = (item: StaffRosterItem) => {
    void runAction(item.email, () => reactivateStaff({ email: item.email }, idToken!));
  };

  const grouped = {
    pending: items.filter((i) => i.status === 'pending'),
    active: items.filter((i) => i.status === 'active'),
    suspended: items.filter((i) => i.status === 'suspended'),
  };

  const isSelf = (item: StaffRosterItem) => item.email.toLowerCase() === userEmail.toLowerCase();

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
        <span className={styles.title}>スタッフ管理</span>
      </header>

      <main className={styles.main}>
        {(authState === 'checking' || (authState === 'ready' && state === 'loading')) && (
          <div className={styles.skeletonList}>
            {[0, 1, 2].map((i) => (<div key={i} className={styles.skeletonItem} />))}
          </div>
        )}

        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインするとスタッフ管理ができます</p>
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
            <button className={styles.retryBtn} onClick={retry}>再読み込み</button>
          </div>
        )}

        {state === 'ready' && (
          <>
            <div className={styles.tabs}>
              {(['pending', 'active', 'suspended'] as Tab[]).map((t) => (
                <button
                  key={t}
                  className={`${styles.tabBtn} ${tab === t ? styles.tabBtnActive : ''}`}
                  onClick={() => setTab(t)}
                >
                  {t === 'pending' ? '承認待ち' : t === 'active' ? '有効' : '停止中'} ({grouped[t].length})
                </button>
              ))}
            </div>

            {actionError && <p className={styles.actionError}>{actionError}</p>}

            {grouped[tab].length === 0 && <p className={styles.empty}>該当するスタッフはいません</p>}

            <div className={styles.list}>
              {grouped[tab].map((item) => (
                <div key={item.email} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <input
                      className={styles.nameInput}
                      value={nameFor(item)}
                      placeholder="表示名"
                      disabled={busyEmail === item.email}
                      onChange={(e) => setDraftNames((d) => ({ ...d, [item.email]: e.target.value }))}
                    />
                    {isSelf(item) && <span className={styles.selfBadge}>自分</span>}
                  </div>
                  <p className={styles.email}>{item.email}</p>
                  <div className={styles.metaRow}>
                    <span className={styles.metaItem}>source: {item.source}</span>
                    <span className={styles.metaItem}>作成: {formatDate(item.createdAt)}</span>
                    <span className={styles.metaItem}>最終アクセス: {formatDate(item.lastSeenAt)}</span>
                  </div>

                  <div className={styles.actionsRow}>
                    <select
                      className={styles.roleSelect}
                      value={roleFor(item)}
                      disabled={busyEmail === item.email || (isSelf(item) && item.role === 'admin')}
                      onChange={(e) => handleChangeRole(item, e.target.value as StaffRole)}
                    >
                      <option value="staff">staff</option>
                      <option value="admin">admin</option>
                    </select>

                    {tab === 'pending' && (
                      <button
                        className={styles.primaryBtn}
                        disabled={busyEmail === item.email}
                        onClick={() => handleApprove(item)}
                      >
                        承認する
                      </button>
                    )}

                    {tab === 'active' && (
                      <>
                        <button
                          className={styles.secondaryBtn}
                          disabled={busyEmail === item.email || nameFor(item).trim() === item.displayName}
                          onClick={() => handleUpdateName(item)}
                        >
                          表示名を保存
                        </button>
                        <button
                          className={styles.dangerBtn}
                          disabled={busyEmail === item.email || isSelf(item)}
                          onClick={() => handleSuspend(item)}
                        >
                          停止する
                        </button>
                      </>
                    )}

                    {tab === 'suspended' && (
                      <button
                        className={styles.primaryBtn}
                        disabled={busyEmail === item.email}
                        onClick={() => handleReactivate(item)}
                      >
                        再開する
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
