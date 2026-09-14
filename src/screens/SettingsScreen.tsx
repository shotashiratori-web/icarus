import { useAuth } from '../context/AuthContext';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import styles from './SettingsScreen.module.css';

type Props = { go: (s: Screen) => void };

// Home IA整理 v1（2026-09-14）。開発・管理系機能をHomeから分離し、日常業務（記録する/見る・探す/
// 最近の記録）と管理・メンテナンス業務を画面単位で完全に分ける。表示条件（role gating）は
// HomeScreenから移動しただけで一切変更しない——一般staffには従来どおりadmin限定機能を表示しない
export default function SettingsScreen({ go }: Props) {
  const { staffMe } = useAuth();

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
        <span className={styles.title}>設定</span>
        <HomeButton go={go} />
      </header>

      <main className={styles.main}>
        {!staffMe && (
          <p className={styles.empty}>ログイン後にご利用いただけます。</p>
        )}

        {staffMe && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>ツール</h2>
            <div className={styles.navRow}>
              <button className={styles.navBtn} onClick={() => go({ name: 'daily' })}>
                <span className={styles.navIcon}>📝</span>
                <span>Lift Up Daily</span>
              </button>
              <button className={styles.navBtn} onClick={() => go({ name: 'zukan' })}>
                <span className={styles.navIcon}>📚</span>
                <span>図鑑（試作版）</span>
              </button>
            </div>
            <div className={styles.navRow}>
              <button className={styles.navBtn} onClick={() => go({ name: 'photoBulkUpload' })}>
                <span className={styles.navIcon}>🗂️</span>
                <span>PC一括写真送信</span>
              </button>
            </div>
          </section>
        )}

        {staffMe?.role === 'admin' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>管理・メンテナンス</h2>
            <div className={styles.navRow}>
              <button className={styles.navBtn} onClick={() => go({ name: 'processEditor' })}>
                <span className={styles.navIcon}>🧬</span>
                <span>加工知識を登録</span>
              </button>
              <button className={styles.navBtn} onClick={() => go({ name: 'foodEditorList' })}>
                <span className={styles.navIcon}>🥕</span>
                <span>Foodを登録・編集</span>
              </button>
            </div>
            <div className={styles.navRow}>
              <button className={styles.navBtn} onClick={() => go({ name: 'staffApproval' })}>
                <span className={styles.navIcon}>🛡️</span>
                <span>スタッフ管理</span>
              </button>
              <button className={styles.navBtn} onClick={() => go({ name: 'dailyAdmin' })}>
                <span className={styles.navIcon}>📋</span>
                <span>Daily確認</span>
              </button>
            </div>
            <div className={styles.navRow}>
              <button className={styles.navBtn} onClick={() => go({ name: 'spotList' })}>
                <span className={styles.navIcon}>📍</span>
                <span>スポット管理</span>
              </button>
              <button className={styles.navBtn} onClick={() => go({ name: 'metaDebug' })}>
                <span className={styles.navIcon}>🔬</span>
                <span>画像メタデータ調査</span>
              </button>
            </div>
            <div className={styles.navRow}>
              <button className={styles.navBtn} onClick={() => go({ name: 'photoHashRepair' })}>
                <span className={styles.navIcon}>🩹</span>
                <span>写真ハッシュ補完</span>
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
