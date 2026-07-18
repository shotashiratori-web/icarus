import type { StaffStatus } from '../types/staff';
import { useAuth } from '../context/AuthContext';
import styles from './PendingApprovalScreen.module.css';

type Props = {
  status: StaffStatus;
};

export default function PendingApprovalScreen({ status }: Props) {
  const { userEmail, signOut } = useAuth();

  const isSuspended = status === 'suspended';

  return (
    <div className={styles.root}>
      <main className={styles.main}>
        <div className={styles.icon}>{isSuspended ? '🚫' : '⏳'}</div>
        <h1 className={styles.title}>{isSuspended ? '利用停止中です' : '承認待ちです'}</h1>
        <p className={styles.body}>
          {isSuspended
            ? 'このアカウントは利用を停止されています。心当たりがない場合は管理者にご連絡ください。'
            : '管理者の承認をお待ちください。承認されると利用できるようになります。'}
        </p>
        {userEmail && <p className={styles.email}>{userEmail}</p>}
        <button className={styles.signOutBtn} onClick={signOut}>別のアカウントでログインし直す</button>
      </main>
    </div>
  );
}
