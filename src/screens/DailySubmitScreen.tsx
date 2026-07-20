import { useEffect, useState } from 'react';
import { fetchTodayDaily, submitDaily } from '../api/dailyApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import { CONCERN_TYPE_LABELS, type ConcernType, type DailyEntry } from '../types/daily';
import type { Screen } from '../App';
import styles from './DailySubmitScreen.module.css';

type Props = { go: (s: Screen) => void };
type LoadState = 'loading' | 'ready' | 'error';

interface FormState {
  movedMoment: string;
  learning: string;
  imitate: string;
  challengeMindset: string;
  challengeSkill: string;
  challengeAction: string;
  yoichiMoment: string;
  concernType: ConcernType | '';
  concernText: string;
  satisfaction: number | null;
  satisfactionReason: string;
}

const EMPTY_FORM: FormState = {
  movedMoment: '', learning: '', imitate: '',
  challengeMindset: '', challengeSkill: '', challengeAction: '',
  yoichiMoment: '', concernType: '', concernText: '',
  satisfaction: null, satisfactionReason: '',
};

function formFromEntry(item: DailyEntry): FormState {
  return {
    movedMoment: item.movedMoment,
    learning: item.learning,
    imitate: item.imitate,
    challengeMindset: item.challengeMindset,
    challengeSkill: item.challengeSkill,
    challengeAction: item.challengeAction,
    yoichiMoment: item.yoichiMoment,
    concernType: item.concernType ?? '',
    concernText: item.concernText,
    satisfaction: item.satisfaction,
    satisfactionReason: item.satisfactionReason,
  };
}

export default function DailySubmitScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [entry, setEntry] = useState<DailyEntry | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = async (token: string) => {
    setState('loading');
    try {
      const item = await fetchTodayDaily(token);
      setEntry(item);
      setForm(item ? formFromEntry(item) : EMPTY_FORM);
      setState('ready');
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
      setErrorMessage(e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました');
      setState('error');
    }
  };

  useEffect(() => {
    if (authState === 'ready' && idToken) void load(idToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, idToken]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const missing: string[] = [];
  if (!form.movedMoment.trim()) missing.push('心が動いたこと');
  if (!form.learning.trim()) missing.push('学び');
  if (!form.imitate.trim()) missing.push('真似したいこと');
  if (!form.challengeMindset.trim()) missing.push('明日の挑戦（心構え）');
  if (!form.challengeSkill.trim()) missing.push('明日の挑戦（技術・仕事）');
  if (!form.challengeAction.trim()) missing.push('明日の挑戦（行動）');
  if (!form.yoichiMoment.trim()) missing.push('余市を感じたこと');
  if (form.satisfaction === null) missing.push('満足度');
  if (!form.satisfactionReason.trim()) missing.push('満足度の理由');
  if (form.concernText.trim() && !form.concernType) missing.push('困っていることの種類');
  const canSubmit = missing.length === 0 && !saving;

  const isLocked = entry?.status === 'confirmed';

  const handleSubmit = async () => {
    if (!idToken || !canSubmit) return;
    setSaving(true);
    setSaveError('');
    try {
      const item = await submitDaily({
        movedMoment: form.movedMoment.trim(),
        learning: form.learning.trim(),
        imitate: form.imitate.trim(),
        challengeMindset: form.challengeMindset.trim(),
        challengeSkill: form.challengeSkill.trim(),
        challengeAction: form.challengeAction.trim(),
        yoichiMoment: form.yoichiMoment.trim(),
        concernType: form.concernText.trim() ? (form.concernType as ConcernType) : undefined,
        concernText: form.concernText.trim() || undefined,
        satisfaction: form.satisfaction as number,
        satisfactionReason: form.satisfactionReason.trim(),
      }, idToken);
      setEntry(item);
      setForm(formFromEntry(item));
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
      setSaveError(e instanceof Error ? e.message : '送信に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
        <span className={styles.title}>Lift Up Daily</span>
        <span className={styles.subtitle}>馳走ノート</span>
      </header>

      <main className={styles.main}>
        {(authState === 'checking' || (authState === 'ready' && state === 'loading')) && (
          <div className={styles.skeleton} />
        )}

        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインするとDailyを提出できます</p>
            <div ref={signInContainerRef} />
          </div>
        )}

        {authState === 'ready' && state === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={() => idToken && load(idToken)}>再読み込み</button>
          </div>
        )}

        {authState === 'ready' && state === 'ready' && (
          <>
            {entry?.status === 'revision_requested' && entry.mentorComment && (
              <div className={styles.noticeBox}>
                <p className={styles.noticeLabel}>追記をお願いします</p>
                <p className={styles.noticeText}>{entry.mentorComment}</p>
              </div>
            )}
            {entry?.status === 'submitted' && (
              <p className={styles.hintText}>管理者の確認をお待ちしています。内容はいつでも修正できます。</p>
            )}
            {entry?.status === 'confirmed' && (
              <div className={styles.noticeBox}>
                <p className={styles.noticeLabel}>確認済みです</p>
                {entry.mentorComment && <p className={styles.noticeText}>{entry.mentorComment}</p>}
              </div>
            )}

            <p className={styles.guideText}>
              「心が動いたこと」は自分の感情や印象に残った出来事を書く欄、「余市を感じたこと」は余市らしい景色・香り・自然・人について書く欄です。迷った場合は、どちらに書いても問題ありません。
            </p>

            <Field label="今日、一番心が動いたこと" value={form.movedMoment} disabled={isLocked}
              onChange={(v) => setField('movedMoment', v)} placeholder="畑の香り、お客様の反応、生産者との会話、失敗、成功…" />

            <Field label="今日の学び" value={form.learning} disabled={isLocked}
              onChange={(v) => setField('learning', v)} placeholder="香り、火入れ、サービス、畑、発酵…" />

            <Field label="今日、真似したいと思ったこと" value={form.imitate} disabled={isLocked}
              onChange={(v) => setField('imitate', v)} placeholder="先輩・生産者・仲間・お客様から見つけたこと" />

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>明日の挑戦</legend>
              <Field label="心構え" value={form.challengeMindset} disabled={isLocked}
                onChange={(v) => setField('challengeMindset', v)} placeholder="どんな気持ちで働くか" />
              <Field label="技術・仕事" value={form.challengeSkill} disabled={isLocked}
                onChange={(v) => setField('challengeSkill', v)} placeholder="明日挑戦したい仕事" />
              <Field label="行動" value={form.challengeAction} disabled={isLocked}
                onChange={(v) => setField('challengeAction', v)} placeholder="具体的に何を変えるか" />
            </fieldset>

            <Field label="今日、一番余市を感じたこと" value={form.yoichiMoment} disabled={isLocked}
              onChange={(v) => setField('yoichiMoment', v)} placeholder="朝露、海風、桃、畑、ワイン畑、生産者との会話…" />

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>困っていること（任意）</legend>
              <select
                className={styles.select}
                value={form.concernType}
                disabled={isLocked}
                onChange={(e) => setField('concernType', e.target.value as ConcernType | '')}
              >
                <option value="">選択してください</option>
                {(Object.entries(CONCERN_TYPE_LABELS) as [ConcernType, string][]).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <textarea
                className={styles.textarea}
                value={form.concernText}
                disabled={isLocked}
                onChange={(e) => setField('concernText', e.target.value)}
                placeholder="質問・相談・困っていること・改善提案があれば書いてください"
              />
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>今日の満足度</legend>
              <div className={styles.satisfactionRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`${styles.satisfactionBtn} ${form.satisfaction === n ? styles.satisfactionBtnActive : ''}`}
                    disabled={isLocked}
                    onClick={() => setField('satisfaction', n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <textarea
                className={styles.textarea}
                value={form.satisfactionReason}
                disabled={isLocked}
                onChange={(e) => setField('satisfactionReason', e.target.value)}
                placeholder="理由を一言（例: 時間配分は良かったが、魚の下処理で焦ってしまった）"
              />
            </fieldset>

            {saveError && <p className={styles.actionError}>{saveError}</p>}

            {!isLocked && (
              <button className={styles.submitBtn} disabled={!canSubmit} onClick={handleSubmit}>
                {saving ? '送信中…' : entry ? '更新する' : '提出する'}
              </button>
            )}
            {!isLocked && missing.length > 0 && (
              <p className={styles.missingText}>未入力: {missing.join('、')}</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, disabled }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>{label}</label>
      <textarea
        className={styles.textarea}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
