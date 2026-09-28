import { useEffect, useState } from 'react';
import { hasNewVersion } from '../utils/appShell';
import styles from './UpdateBanner.module.css';

// 新しい版が公開されていたら知らせる。切り替えは利用者が［再読み込み］を押した時だけ（Exploration Mode Stage 1、§11-1）
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export default function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let stopped = false;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void hasNewVersion().then((v) => { if (!stopped && v) setAvailable(true); });
    };
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    check();
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, []);

  if (!available) return null;
  return (
    <div className={styles.banner} role="status">
      <span>Icarus の更新があります</span>
      <button className={styles.btn} onClick={() => location.reload()}>再読み込み</button>
      <button className={styles.later} onClick={() => setAvailable(false)}>あとで</button>
    </div>
  );
}
