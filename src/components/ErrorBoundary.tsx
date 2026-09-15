import { Component, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

// 2026-09-15: 白画面インシデント対応。このアプリにはErrorBoundaryが一つも無く、描画時に例外が
// 起きるとReactがtree全体をunmountし、<div id="root">だけが残る「無言の白画面」になっていた
// （新規スタッフからの報告あり）。原因は複数ありうる（デプロイ直後にキャッシュされた古いページが
// 既に削除されたJSチャンクを読もうとして失敗する、等）が、根本原因を問わず「白画面ではなく
// 最低限のフォールバックを出す」ための最終防波堤としてApp全体を包む

const RELOAD_GUARD_KEY = 'icarus:error-boundary-reloaded';

// Viteのdynamic import失敗（デプロイ直後、旧chunkが既に存在しない等）はこのパターンのメッセージで
// 投げられる。これは「リロードすれば直る」ことがほぼ確実なケースなので、無限ループしないよう
// sessionStorageのguardを立てた上で一度だけ自動リロードを試みる
function isLikelyStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(message);
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    if (!isLikelyStaleChunkError(error)) return;
    try {
      if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return; // 既に一度試みて再発 → 自動リロードは諦める
      sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
      window.location.reload();
    } catch {
      // sessionStorageが使えなくても致命的ではない（下のフォールバックUIがそのまま出るだけ）
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className={styles.root}>
          <div className={styles.icon}>⚠️</div>
          <p className={styles.title}>問題が発生しました</p>
          <p className={styles.body}>
            アプリの表示に失敗しました。再読み込みしても直らない場合は、時間を置いてもう一度お試しください。
          </p>
          <button className={styles.reloadBtn} onClick={() => window.location.reload()}>
            再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
