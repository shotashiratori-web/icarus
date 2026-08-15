import { useEffect, useMemo, useState } from 'react';
import { fetchAllFoods, fetchAllProcessedProducts, createProcessKnowledge } from '../api/knowledgeApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { FoodEntity, ProcessedProductEntity, CompositeProcessRequest } from '../types/knowledge';
import type { Screen } from '../App';
import styles from './ProcessEditorScreen.module.css';

type Props = { go: (s: Screen) => void };
type CandidateState = 'loading' | 'ready' | 'error';
type Phase = 'form' | 'confirm' | 'success';

interface SelectedInput {
  type: 'food' | 'processed_product';
  id: string;
  label: string;
}

interface StepDraft {
  key: string;
  text: string;
}

type OutputDraft =
  | { mode: 'existing'; id: string; label: string }
  | { mode: 'create'; key: string; name: string; description: string };

let localKeySeq = 0;
function nextKey(): string {
  localKeySeq += 1;
  return `k${localKeySeq}-${Date.now()}`;
}

// 新規Output名が既存ProcessedProductと同名かどうか（自動統合はしない。警告のみ）
function findDuplicateProductName(name: string, products: ProcessedProductEntity[]): boolean {
  const trimmed = name.trim();
  return products.some((p) => p.name === trimmed);
}

export default function ProcessEditorScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();

  const [candidateState, setCandidateState] = useState<CandidateState>('loading');
  const [candidateError, setCandidateError] = useState('');
  const [foods, setFoods] = useState<FoodEntity[]>([]);
  const [products, setProducts] = useState<ProcessedProductEntity[]>([]);

  const [processName, setProcessName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [inputs, setInputs] = useState<SelectedInput[]>([]);
  const [outputs, setOutputs] = useState<OutputDraft[]>([]);

  const [inputPanelOpen, setInputPanelOpen] = useState(false);
  const [inputQuery, setInputQuery] = useState('');

  const [outputPanelOpen, setOutputPanelOpen] = useState(false);
  const [outputMode, setOutputMode] = useState<'existing' | 'create' | null>(null);
  const [outputQuery, setOutputQuery] = useState('');
  const [newOutputName, setNewOutputName] = useState('');
  const [newOutputDescription, setNewOutputDescription] = useState('');
  const [newOutputError, setNewOutputError] = useState('');

  const [phase, setPhase] = useState<Phase>('form');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = async (token: string) => {
    setCandidateState('loading');
    try {
      const [foodItems, productItems] = await Promise.all([
        fetchAllFoods(token),
        fetchAllProcessedProducts(token),
      ]);
      setFoods(foodItems);
      setProducts(productItems);
      setCandidateState('ready');
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
      setCandidateError(e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '候補の取得に失敗しました');
      setCandidateState('error');
    }
  };

  useEffect(() => {
    if (authState === 'ready' && idToken) void load(idToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, idToken]);

  // ── Input（Food/ProcessedProduct、複数選択・重複禁止） ──────────
  const inputCandidates = useMemo(() => {
    const q = inputQuery.trim().toLowerCase();
    const isSelected = (type: 'food' | 'processed_product', id: string) =>
      inputs.some((i) => i.type === type && i.id === id);
    const foodCandidates: SelectedInput[] = foods
      .filter((f) => !isSelected('food', f.id))
      .filter((f) => !q || f.canonicalName.toLowerCase().includes(q) || f.aliases.some((a) => a.toLowerCase().includes(q)))
      .map((f) => ({ type: 'food', id: f.id, label: f.canonicalName }));
    const productCandidates: SelectedInput[] = products
      .filter((p) => !isSelected('processed_product', p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((p) => ({ type: 'processed_product', id: p.id, label: p.name }));
    return [...foodCandidates, ...productCandidates].slice(0, 20);
  }, [foods, products, inputs, inputQuery]);

  const addInput = (candidate: SelectedInput) => {
    setInputs((prev) => (prev.some((i) => i.type === candidate.type && i.id === candidate.id) ? prev : [...prev, candidate]));
    setInputQuery('');
  };
  const removeInput = (type: 'food' | 'processed_product', id: string) => {
    setInputs((prev) => prev.filter((i) => !(i.type === type && i.id === id)));
  };

  // ── steps（追加・上下並べ替え・削除のみ。orderは常に配列位置で決まる） ──────────
  const addStep = () => setSteps((prev) => [...prev, { key: nextKey(), text: '' }]);
  const updateStepText = (key: string, text: string) =>
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, text } : s)));
  const removeStep = (key: string) => setSteps((prev) => prev.filter((s) => s.key !== key));
  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // ── Output（既存を使う／新しく作る。existing重複禁止・new同名重複禁止） ──────────
  const existingOutputCandidates = useMemo(() => {
    const q = outputQuery.trim().toLowerCase();
    return products
      .filter((p) => !outputs.some((o) => o.mode === 'existing' && o.id === p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 20);
  }, [products, outputs, outputQuery]);

  const addExistingOutput = (product: ProcessedProductEntity) => {
    setOutputs((prev) =>
      prev.some((o) => o.mode === 'existing' && o.id === product.id)
        ? prev
        : [...prev, { mode: 'existing', id: product.id, label: product.name }],
    );
    setOutputQuery('');
    setOutputPanelOpen(false);
    setOutputMode(null);
  };

  const addCreateOutput = () => {
    const name = newOutputName.trim();
    if (!name) {
      setNewOutputError('名前は必須です');
      return;
    }
    if (outputs.some((o) => o.mode === 'create' && o.name === name)) {
      setNewOutputError('同一request内で同名のできるものは追加できません');
      return;
    }
    setOutputs((prev) => [...prev, { mode: 'create', key: nextKey(), name, description: newOutputDescription.trim() }]);
    setNewOutputName('');
    setNewOutputDescription('');
    setNewOutputError('');
    setOutputPanelOpen(false);
    setOutputMode(null);
  };

  const removeOutput = (target: OutputDraft) => {
    setOutputs((prev) => prev.filter((o) => o !== target));
  };

  // ── 確認へ進む前のvalidation（サーバーへ送る前にここで止める） ──────────
  const formErrors = useMemo(() => {
    const errs: string[] = [];
    if (!processName.trim()) errs.push('加工名を入力してください');
    if (inputs.length === 0) errs.push('入力を1件以上選んでください');
    if (outputs.length === 0) errs.push('できるものを1件以上追加してください');
    if (steps.some((s) => !s.text.trim())) errs.push('工程の内容が空の行があります');
    return errs;
  }, [processName, inputs, outputs, steps]);

  const canConfirm = formErrors.length === 0;

  const buildRequest = (): CompositeProcessRequest => ({
    process: {
      name: processName.trim(),
      description: description.trim(),
      steps: steps.map((s, i) => ({ order: i + 1, text: s.text.trim() })),
    },
    inputs: inputs.map((i) => ({ type: i.type, id: i.id })),
    outputs: outputs.map((o) =>
      o.mode === 'existing'
        ? { mode: 'existing' as const, id: o.id }
        : { mode: 'create' as const, name: o.name, description: o.description },
    ),
  });

  const handleSave = async () => {
    if (!idToken || saving) return; // 二重送信防止
    setSaving(true);
    setSaveError('');
    try {
      await createProcessKnowledge(buildRequest(), idToken);
      setPhase('success');
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); setSaving(false); return; }
      // 失敗しても入力内容は保持する（フォームを初期化しない）。確認画面のまま戻って修正・再試行できる
      setSaveError(e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setProcessName('');
    setDescription('');
    setSteps([]);
    setInputs([]);
    setOutputs([]);
    setInputPanelOpen(false);
    setInputQuery('');
    setOutputPanelOpen(false);
    setOutputMode(null);
    setOutputQuery('');
    setNewOutputName('');
    setNewOutputDescription('');
    setNewOutputError('');
    setSaveError('');
    setPhase('form');
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
        <span className={styles.title}>加工知識を登録</span>
      </header>

      <main className={styles.main}>
        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインすると加工知識を登録できます</p>
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
              <span className={styles.label}>加工名 *</span>
              <input
                className={styles.input}
                type="text"
                value={processName}
                onChange={(e) => setProcessName(e.target.value)}
                placeholder="例: 杏セミドライを作る"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>説明</span>
              <textarea
                className={styles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </label>

            {/* 入力 */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>入力 *</h2>
              {inputs.length > 0 && (
                <div className={styles.chipRow}>
                  {inputs.map((i) => (
                    <span key={`${i.type}:${i.id}`} className={styles.chip}>
                      <span className={styles.chipTag}>{i.type === 'food' ? '🥕食材' : '🧂加工品'}</span>
                      <span className={styles.chipLabel}>{i.label}</span>
                      <button
                        type="button"
                        className={styles.chipRemove}
                        aria-label={`${i.label}を入力から外す`}
                        onClick={() => removeInput(i.type, i.id)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {!inputPanelOpen && (
                <button type="button" className={styles.addBtn} onClick={() => setInputPanelOpen(true)}>
                  + 食材・加工品を追加
                </button>
              )}

              {inputPanelOpen && (
                <div className={styles.panel}>
                  <input
                    className={styles.input}
                    type="text"
                    autoFocus
                    value={inputQuery}
                    onChange={(e) => setInputQuery(e.target.value)}
                    placeholder="食材名・加工品名で検索"
                  />
                  <ul className={styles.candidateList}>
                    {inputCandidates.length === 0 && (
                      <li className={styles.candidateEmpty}>該当する候補がありません</li>
                    )}
                    {inputCandidates.map((c) => (
                      <li key={`${c.type}:${c.id}`}>
                        <button type="button" className={styles.candidateItem} onClick={() => addInput(c)}>
                          <span className={styles.chipTag}>{c.type === 'food' ? '🥕食材' : '🧂加工品'}</span>
                          <span>{c.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className={styles.cancelBtn} onClick={() => { setInputPanelOpen(false); setInputQuery(''); }}>
                    閉じる
                  </button>
                </div>
              )}
            </section>

            {/* 工程 */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>工程</h2>
              {steps.map((s, index) => (
                <div key={s.key} className={styles.stepRow}>
                  <span className={styles.stepIndex}>{index + 1}.</span>
                  <input
                    className={styles.input}
                    type="text"
                    value={s.text}
                    onChange={(e) => updateStepText(s.key, e.target.value)}
                    placeholder="工程の内容"
                  />
                  <div className={styles.stepActions}>
                    <button type="button" className={styles.stepBtn} disabled={index === 0} onClick={() => moveStep(index, -1)} aria-label="上へ">↑</button>
                    <button type="button" className={styles.stepBtn} disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)} aria-label="下へ">↓</button>
                    <button type="button" className={styles.stepBtn} onClick={() => removeStep(s.key)} aria-label="削除">削除</button>
                  </div>
                </div>
              ))}
              <button type="button" className={styles.addBtn} onClick={addStep}>+ 工程を追加</button>
            </section>

            {/* できるもの（Output） */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>できるもの *</h2>
              {outputs.length > 0 && (
                <div className={styles.chipRow}>
                  {outputs.map((o) => (
                    <span key={o.mode === 'existing' ? `e:${o.id}` : `c:${o.key}`} className={styles.chip}>
                      <span className={styles.chipTag}>{o.mode === 'existing' ? '既存' : '新規'}</span>
                      <span className={styles.chipLabel}>{o.mode === 'existing' ? o.label : o.name}</span>
                      <button
                        type="button"
                        className={styles.chipRemove}
                        aria-label="できるものから外す"
                        onClick={() => removeOutput(o)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {outputs.some((o) => o.mode === 'create' && findDuplicateProductName(o.name, products)) && (
                <p className={styles.warnText}>⚠️ 同名の加工品があります（自動統合はしません。既存加工品を使う場合は「既存加工品を使う」から選んでください）</p>
              )}

              {!outputPanelOpen && (
                <button type="button" className={styles.addBtn} onClick={() => setOutputPanelOpen(true)}>
                  + 加工品を追加
                </button>
              )}

              {outputPanelOpen && outputMode === null && (
                <div className={styles.panel}>
                  <button type="button" className={styles.optionBtn} onClick={() => setOutputMode('existing')}>
                    A. 既存加工品を使う
                  </button>
                  <button type="button" className={styles.optionBtn} onClick={() => setOutputMode('create')}>
                    B. 新しい加工品を作る
                  </button>
                  <button type="button" className={styles.cancelBtn} onClick={() => setOutputPanelOpen(false)}>閉じる</button>
                </div>
              )}

              {outputPanelOpen && outputMode === 'existing' && (
                <div className={styles.panel}>
                  <input
                    className={styles.input}
                    type="text"
                    autoFocus
                    value={outputQuery}
                    onChange={(e) => setOutputQuery(e.target.value)}
                    placeholder="加工品名で検索"
                  />
                  <ul className={styles.candidateList}>
                    {existingOutputCandidates.length === 0 && (
                      <li className={styles.candidateEmpty}>該当する候補がありません</li>
                    )}
                    {existingOutputCandidates.map((p) => (
                      <li key={p.id}>
                        <button type="button" className={styles.candidateItem} onClick={() => addExistingOutput(p)}>
                          {p.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className={styles.cancelBtn} onClick={() => { setOutputMode(null); setOutputQuery(''); }}>戻る</button>
                </div>
              )}

              {outputPanelOpen && outputMode === 'create' && (
                <div className={styles.panel}>
                  <label className={styles.field}>
                    <span className={styles.label}>名前 *</span>
                    <input
                      className={styles.input}
                      type="text"
                      autoFocus
                      value={newOutputName}
                      onChange={(e) => { setNewOutputName(e.target.value); setNewOutputError(''); }}
                      placeholder="例: セミドライ杏"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>説明</span>
                    <textarea
                      className={styles.textarea}
                      value={newOutputDescription}
                      onChange={(e) => setNewOutputDescription(e.target.value)}
                      rows={2}
                    />
                  </label>
                  {newOutputName.trim() && findDuplicateProductName(newOutputName, products) && (
                    <p className={styles.warnText}>⚠️ 同名の加工品があります</p>
                  )}
                  {newOutputError && <p className={styles.errorText}>{newOutputError}</p>}
                  <div className={styles.row}>
                    <button type="button" className={styles.addBtn} onClick={addCreateOutput}>追加</button>
                    <button type="button" className={styles.cancelBtn} onClick={() => { setOutputMode(null); setNewOutputError(''); }}>戻る</button>
                  </div>
                </div>
              )}
            </section>

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
            <h2 className={styles.confirmTitle}>{processName.trim()}</h2>

            {description.trim() && (
              <div className={styles.confirmBlock}>
                <h3 className={styles.confirmLabel}>説明</h3>
                <p className={styles.confirmText}>{description.trim()}</p>
              </div>
            )}

            <div className={styles.confirmBlock}>
              <h3 className={styles.confirmLabel}>入力</h3>
              <ul className={styles.confirmList}>
                {inputs.map((i) => <li key={`${i.type}:${i.id}`}>・{i.label}</li>)}
              </ul>
            </div>

            {steps.length > 0 && (
              <div className={styles.confirmBlock}>
                <h3 className={styles.confirmLabel}>工程</h3>
                <ol className={styles.confirmOrderedList}>
                  {steps.map((s) => <li key={s.key}>{s.text.trim()}</li>)}
                </ol>
              </div>
            )}

            <div className={styles.confirmBlock}>
              <h3 className={styles.confirmLabel}>できるもの</h3>
              <ul className={styles.confirmList}>
                {outputs.map((o) => (
                  <li key={o.mode === 'existing' ? `e:${o.id}` : `c:${o.key}`}>
                    ・{o.mode === 'existing' ? o.label : o.name}{o.mode === 'create' ? '（新規）' : ''}
                  </li>
                ))}
              </ul>
            </div>

            {saveError && <p className={styles.errorText}>{saveError}</p>}

            <div className={styles.actions}>
              <button type="button" className={styles.saveBtn} disabled={saving} onClick={() => void handleSave()}>
                {saving ? '保存中…' : '加工知識として保存'}
              </button>
              <button type="button" className={styles.cancelBtn} disabled={saving} onClick={() => setPhase('form')}>
                戻って修正
              </button>
            </div>
          </div>
        )}

        {phase === 'success' && (
          <div className={styles.successView}>
            <p className={styles.successText}>加工知識を保存しました</p>
            <div className={styles.actions}>
              <button type="button" className={styles.addBtn} onClick={resetForm}>続けて登録する</button>
              <button type="button" className={styles.confirmBtn} onClick={() => go({ name: 'home' })}>ホームへ戻る</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
