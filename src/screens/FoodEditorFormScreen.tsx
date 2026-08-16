import { useEffect, useMemo, useState } from 'react';
import { fetchAllFoods, createFood, updateFood, FoodDuplicateError } from '../api/knowledgeApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { FoodEntity, FoodFormInput } from '../types/knowledge';
import type { Screen } from '../App';
import styles from './FoodEditorFormScreen.module.css';

type Props = { go: (s: Screen) => void } & (
  | { mode: 'create' }
  | { mode: 'edit'; food: FoodEntity }
);

type CandidateState = 'loading' | 'ready' | 'error';
type Phase = 'form' | 'confirm' | 'success';

// 他Foodのcanonical_name／aliasesとexact matchするかどうかのみを見る。
// 類似度判定・かな正規化はしない（アズキナ問題を再発させないため、Food Editorでも横断conflictはexactのみ）
function findConflictFood(name: string, allFoods: FoodEntity[], excludeId: string | null): FoodEntity | null {
  const trimmed = name.trim();
  return allFoods.find((f) =>
    f.id !== excludeId && (f.canonicalName === trimmed || f.aliases.includes(trimmed)),
  ) ?? null;
}

export default function FoodEditorFormScreen(props: Props) {
  const { go, mode } = props;
  const existing = mode === 'edit' ? props.food : null;
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();

  const [candidateState, setCandidateState] = useState<CandidateState>('loading');
  const [candidateError, setCandidateError] = useState('');
  const [allFoods, setAllFoods] = useState<FoodEntity[]>([]);

  const [canonicalName, setCanonicalName] = useState(existing?.canonicalName ?? '');
  const [aliases, setAliases] = useState<string[]>(existing?.aliases ?? []);
  const [usableParts, setUsableParts] = useState<string[]>(existing?.usableParts ?? []);
  const [description, setDescription] = useState(existing?.description ?? '');

  const [newAlias, setNewAlias] = useState('');
  const [aliasError, setAliasError] = useState('');
  const [newPart, setNewPart] = useState('');
  const [partError, setPartError] = useState('');

  const [phase, setPhase] = useState<Phase>('form');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = async (token: string) => {
    setCandidateState('loading');
    try {
      const items = await fetchAllFoods(token);
      setAllFoods(items);
      setCandidateState('ready');
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
      setCandidateError(e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました');
      setCandidateState('error');
    }
  };

  useEffect(() => {
    if (authState === 'ready' && idToken) void load(idToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, idToken]);

  const excludeId = existing?.id ?? null;

  const addAlias = () => {
    const trimmed = newAlias.trim();
    if (!trimmed) { setAliasError('別名を入力してください'); return; }
    if (trimmed === canonicalName.trim()) { setAliasError('正式名称と同じ別名は追加できません'); return; }
    if (aliases.includes(trimmed)) { setAliasError('既に追加されています'); return; }
    const conflict = findConflictFood(trimmed, allFoods, excludeId);
    if (conflict) { setAliasError(`「${trimmed}」は既にFood「${conflict.canonicalName}」で使われています`); return; }
    setAliases((prev) => [...prev, trimmed]);
    setNewAlias('');
    setAliasError('');
  };
  const removeAlias = (index: number) => setAliases((prev) => prev.filter((_, i) => i !== index));

  const addPart = () => {
    const trimmed = newPart.trim();
    if (!trimmed) { setPartError('利用部位を入力してください'); return; }
    if (usableParts.includes(trimmed)) { setPartError('既に追加されています'); return; }
    setUsableParts((prev) => [...prev, trimmed]);
    setNewPart('');
    setPartError('');
  };
  const removePart = (index: number) => setUsableParts((prev) => prev.filter((_, i) => i !== index));

  const formErrors = useMemo(() => {
    const errs: string[] = [];
    const trimmedName = canonicalName.trim();
    if (!trimmedName) {
      errs.push('正式名称を入力してください');
    } else {
      const conflict = findConflictFood(trimmedName, allFoods, excludeId);
      if (conflict) errs.push(`「${trimmedName}」は既にFood「${conflict.canonicalName}」で使われています`);
    }
    return errs;
  }, [canonicalName, allFoods, excludeId]);

  const canConfirm = formErrors.length === 0;

  const buildRequest = (): FoodFormInput => ({
    canonicalName: canonicalName.trim(),
    aliases,
    usableParts,
    description: description.trim(),
  });

  const [savedFood, setSavedFood] = useState<FoodEntity | null>(null);

  const handleSave = async () => {
    if (!idToken || saving) return; // 二重送信防止
    setSaving(true);
    setSaveError('');
    try {
      const result = mode === 'edit'
        ? await updateFood(existing!.id, buildRequest(), idToken)
        : await createFood(buildRequest(), idToken);
      setSavedFood(result);
      setPhase('success');
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); setSaving(false); return; }
      // 失敗しても入力内容は保持する（フォームを初期化しない）。確認画面のまま戻って修正・再試行できる
      setSaveError(
        e instanceof FoodDuplicateError ? e.message
          : e instanceof NetworkUnknownError ? e.message
          : e instanceof Error ? e.message : '保存に失敗しました',
      );
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setCanonicalName('');
    setAliases([]);
    setUsableParts([]);
    setDescription('');
    setNewAlias('');
    setAliasError('');
    setNewPart('');
    setPartError('');
    setSaveError('');
    setSavedFood(null);
    setPhase('form');
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'foodEditorList' })}>← Food一覧</button>
        <span className={styles.title}>{mode === 'edit' ? 'Foodを編集' : 'Foodを登録'}</span>
      </header>

      <main className={styles.main}>
        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインするとFoodを編集できます</p>
            <div ref={signInContainerRef} />
          </div>
        )}

        {authState === 'ready' && candidateState === 'loading' && (
          <p className={styles.hintText}>読み込み中…</p>
        )}

        {authState === 'ready' && candidateState === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{candidateError}</p>
            <button className={styles.retryBtn} onClick={() => idToken && load(idToken)}>再読み込み</button>
          </div>
        )}

        {authState === 'ready' && candidateState === 'ready' && phase === 'form' && (
          <>
            <label className={styles.field}>
              <span className={styles.label}>正式名称 *</span>
              <input
                className={styles.input}
                type="text"
                value={canonicalName}
                onChange={(e) => setCanonicalName(e.target.value)}
                placeholder="例: トマト"
              />
            </label>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>別名</h2>
              {aliases.length > 0 && (
                <div className={styles.chipRow}>
                  {aliases.map((a, i) => (
                    <span key={a} className={styles.chip}>
                      <span className={styles.chipLabel}>{a}</span>
                      <button type="button" className={styles.chipRemove} aria-label={`${a}を削除`} onClick={() => removeAlias(i)}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.row}>
                <input
                  className={styles.input}
                  type="text"
                  value={newAlias}
                  onChange={(e) => { setNewAlias(e.target.value); setAliasError(''); }}
                  placeholder="例: アンズ"
                />
                <button type="button" className={styles.addBtn} onClick={addAlias}>+ 別名を追加</button>
              </div>
              {aliasError && <p className={styles.errorText}>{aliasError}</p>}
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>利用部位</h2>
              {usableParts.length > 0 && (
                <div className={styles.chipRow}>
                  {usableParts.map((p, i) => (
                    <span key={p} className={styles.chip}>
                      <span className={styles.chipLabel}>{p}</span>
                      <button type="button" className={styles.chipRemove} aria-label={`${p}を削除`} onClick={() => removePart(i)}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.row}>
                <input
                  className={styles.input}
                  type="text"
                  value={newPart}
                  onChange={(e) => { setNewPart(e.target.value); setPartError(''); }}
                  placeholder="例: 実"
                />
                <button type="button" className={styles.addBtn} onClick={addPart}>+ 利用部位を追加</button>
              </div>
              {partError && <p className={styles.errorText}>{partError}</p>}
            </section>

            <label className={styles.field}>
              <span className={styles.label}>説明</span>
              <textarea
                className={styles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </label>

            {formErrors.length > 0 && (
              <ul className={styles.formErrors}>
                {formErrors.map((msg) => <li key={msg}>{msg}</li>)}
              </ul>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.confirmBtn} disabled={!canConfirm} onClick={() => setPhase('confirm')}>
                内容を確認
              </button>
            </div>
          </>
        )}

        {phase === 'confirm' && (
          <div className={styles.confirmView}>
            <h2 className={styles.confirmTitle}>{canonicalName.trim()}</h2>

            <div className={styles.confirmBlock}>
              <h3 className={styles.confirmLabel}>別名</h3>
              {aliases.length > 0
                ? <ul className={styles.confirmList}>{aliases.map((a) => <li key={a}>・{a}</li>)}</ul>
                : <p className={styles.confirmText}>（なし）</p>}
            </div>

            <div className={styles.confirmBlock}>
              <h3 className={styles.confirmLabel}>利用部位</h3>
              {usableParts.length > 0
                ? <ul className={styles.confirmList}>{usableParts.map((p) => <li key={p}>・{p}</li>)}</ul>
                : <p className={styles.confirmText}>（なし）</p>}
            </div>

            {description.trim() && (
              <div className={styles.confirmBlock}>
                <h3 className={styles.confirmLabel}>説明</h3>
                <p className={styles.confirmText}>{description.trim()}</p>
              </div>
            )}

            {saveError && <p className={styles.errorText}>{saveError}</p>}

            <div className={styles.actions}>
              <button type="button" className={styles.saveBtn} disabled={saving} onClick={() => void handleSave()}>
                {saving ? '保存中…' : mode === 'edit' ? 'Foodを更新' : 'Foodとして保存'}
              </button>
              <button type="button" className={styles.cancelBtn} disabled={saving} onClick={() => setPhase('form')}>
                戻って修正
              </button>
            </div>
          </div>
        )}

        {phase === 'success' && (
          <div className={styles.successView}>
            <p className={styles.successText}>
              {mode === 'edit' ? 'Foodを更新しました' : 'Foodを保存しました'}
            </p>
            {savedFood && <p className={styles.successName}>{savedFood.canonicalName}</p>}
            <div className={styles.actions}>
              {mode === 'create' && (
                <button type="button" className={styles.addBtn} onClick={resetForm}>続けて登録する</button>
              )}
              <button type="button" className={styles.confirmBtn} onClick={() => go({ name: 'foodEditorList' })}>
                一覧へ戻る
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
