import type { Screen } from '../App';
import styles from './HomeButton.module.css';

type Props = { go: (s: Screen) => void };

// どの画面からでもホームへ直接戻れるよう、各画面のヘッダーに置く共通ボタン。
// 既存の「戻る」ボタン（1つ前の画面へ）とは別に、常にhomeへ一発で戻る導線を提供する
export default function HomeButton({ go }: Props) {
  return (
    <button className={styles.homeBtn} onClick={() => go({ name: 'home' })}>
      🏠 ホーム
    </button>
  );
}
