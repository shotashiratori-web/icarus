import { useState } from 'react';
import { sha256Hex, checkPhotoHashes, registerPhotoHashes, type PhotoHashRegisterResult } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { Screen } from '../App';
import styles from './PhotoHashRepairScreen.module.css';

type Props = { go: (s: Screen) => void };

interface CheckedFile {
  file: File;
  hash: string;
  alreadyRegistered: boolean;
}

// 管理者専用・一時的な補完ツール。目的はphoto_hashesへのハッシュ補完のみで、
// Food Log/Sheets/GAS/Notionには一切触れない。既存レコードの再送信は行わない。
export default function PhotoHashRepairScreen({ go }: Props) {
  const { idToken, staffMe } = useAuth();
  const [checking, setChecking] = useState(false);
  const [checkedFiles, setCheckedFiles] = useState<CheckedFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [result, setResult] = useState<PhotoHashRegisterResult | null>(null);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    if (files.length === 0 || !idToken) return;

    setError(null);
    setResult(null);
    setChecking(true);
    try {
      const hashes = await Promise.all(files.map((f) => sha256Hex(f)));
      const existing = await checkPhotoHashes(hashes, idToken);
      setCheckedFiles(files.map((file, i) => ({
        file, hash: hashes[i], alreadyRegistered: existing.has(hashes[i]),
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : '確認中にエラーが発生しました');
    } finally {
      setChecking(false);
    }
  };

  const duplicateWithinSelectionCount = (() => {
    if (!checkedFiles) return 0;
    const counts = new Map<string, number>();
    for (const cf of checkedFiles) counts.set(cf.hash, (counts.get(cf.hash) ?? 0) + 1);
    let dupExtra = 0;
    for (const c of counts.values()) if (c > 1) dupExtra += c - 1;
    return dupExtra;
  })();

  const toRegisterCount = checkedFiles?.filter((cf) => !cf.alreadyRegistered).length ?? 0;

  const handleRegister = async () => {
    if (!checkedFiles || !idToken) return;
    const targets = checkedFiles.filter((cf) => !cf.alreadyRegistered);
    if (targets.length === 0) return;
    setError(null);
    setRegistering(true);
    try {
      const items = targets.map((t) => ({ hash: t.hash, fileName: t.file.name }));
      const r = await registerPhotoHashes(items, idToken);
      setResult(r);
      setCheckedFiles(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録中にエラーが発生しました');
    } finally {
      setRegistering(false);
    }
  };

  if (staffMe?.role !== 'admin') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
          <span className={styles.title}>ハッシュ補完</span>
        </header>
        <main className={styles.main}>
          <p className={styles.hintText}>管理者のみ利用できます</p>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
        <span className={styles.title}>写真ハッシュ補完（管理者専用・一時ツール）</span>
      </header>

      <main className={styles.main}>
        <p className={styles.description}>
          古いバージョンの画面から送信されたため photo_hashes に登録されなかった写真について、
          元ファイルからハッシュを再計算し、D1の photo_hashes だけへ補完登録します。
          Food Log・Sheets・GAS・Notionへは一切書き込みません。送信済みの記録も再送しません。
        </p>

        {error && <p className={styles.errorText}>{error}</p>}

        {!checkedFiles && !result && (
          <div className={styles.dropZone} onClick={() => document.getElementById('hashRepairInput')?.click()}>
            <span className={styles.dropZoneText}>
              {checking ? '確認中…' : 'クリックして補完対象の元ファイルを選択'}
            </span>
            <input
              id="hashRepairInput"
              type="file"
              accept="image/*"
              multiple
              className={styles.hiddenInput}
              onChange={handleFileInput}
              disabled={checking || !idToken}
            />
          </div>
        )}

        {checkedFiles && (
          <div className={styles.summaryBox}>
            <p className={styles.summaryTitle}>{checkedFiles.length}枚選択</p>
            <div className={styles.summaryRow}>
              <span>既存hash: {checkedFiles.length - toRegisterCount}件</span>
              <span>未登録hash: {toRegisterCount}件</span>
              <span>選択内の重複: {duplicateWithinSelectionCount}件</span>
            </div>
            <ul className={styles.list}>
              {checkedFiles.map((cf) => (
                <li key={cf.hash + cf.file.name} className={cf.alreadyRegistered ? styles.itemExisting : styles.itemNew}>
                  {cf.alreadyRegistered ? `✓ ${cf.file.name}（既存）` : `＋ ${cf.file.name}（未登録）`}
                </li>
              ))}
            </ul>
            <div className={styles.actionsRow}>
              <button
                className={styles.registerBtn}
                onClick={() => void handleRegister()}
                disabled={registering || toRegisterCount === 0}
              >
                {registering ? '登録中…' : `未登録の${toRegisterCount}件だけ登録する`}
              </button>
              <button className={styles.cancelBtn} onClick={() => setCheckedFiles(null)} disabled={registering}>
                キャンセル
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className={styles.summaryBox}>
            <p className={styles.summaryTitle}>登録結果</p>
            <div className={styles.summaryRow}>
              <span>新規登録: {result.registered}件</span>
              <span>既存扱い: {result.alreadyExisting}件</span>
              <span>失敗: {result.failed}件</span>
            </div>
            <button className={styles.cancelBtn} onClick={() => setResult(null)}>閉じる</button>
          </div>
        )}
      </main>
    </div>
  );
}
