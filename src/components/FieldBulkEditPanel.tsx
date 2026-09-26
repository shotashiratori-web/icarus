import { useEffect, useRef, useState } from 'react';
import type { FieldLogEntry } from '../types/zukan';
import type { FieldBulkEditableField, FieldEditOption } from '../types/fieldEntryEdit';
import { useAuth } from '../context/AuthContext';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import { bulkEditFieldEntries, fetchFieldEditOptions, fetchFieldEntryDetail } from '../api/fieldEntryEditApi';
import { TokenExpiredError } from '../api/icarusApi';
import {
  EMPTY_BULK_FORM,
  FIELD_LABELS,
  bulkPatchFromForm,
  choicesFor,
  formatTakenTime,
  summarizeBulkResults,
  toggleObservedPart,
  type BulkEditForm,
  type BulkEditSummary,
} from '../utils/fieldEntryEdit';
import styles from './FieldBulkEditPanel.module.css';

// まとめて編集（Editing & Classification §3-6）。契約:
// - 対象は食材名・観察日・メモ以外の編集可能項目。「変更しない」項目は送らない
// - パネルを開いた時点で各記録のupdated_atを読み、それをexpectedUpdatedAtとして送る
//   （選んだ後に他の人が更新した記録は、その記録だけ競合になり何も書かれない）
// - 記録ごとに独立して成立する。結果は成功／競合／失敗の件数と、競合・失敗した記録の一覧で示す
// - 通信結果が分からないまま同じ内容で保存し直す場合は同じrequestIdを使う（成立済みの記録は二重に書かれない）

type Props = {
  entries: FieldLogEntry[];
  onClose: () => void;
  // 成功した記録（選択から外す）
  onSucceeded: (eventIds: string[]) => void;
};

type Target = { entry: FieldLogEntry; expectedUpdatedAt: string };
type Phase = 'loading' | 'form' | 'saving' | 'result';

const KEEP = '__keep__';

const SELECT_FIELDS: Exclude<FieldBulkEditableField, 'place' | 'observed_parts'>[] = [
  'subject_type', 'large_category', 'sub_category', 'phase', 'identification_status', 'harvested',
];

// 競合・失敗した記録を人が見分けるための表示。同じ日・同じ場所・同じ食材名の記録が並ぶことが多いため、
// 写真のサムネイルと撮影時刻を出す（EventIDは人向けの識別子として見せない）
function EntryIdentity({ entry, reason }: { entry: FieldLogEntry | undefined; reason?: string }) {
  if (!entry) return <span className={styles.identityText}>（記録を表示できません）{reason && `：${reason}`}</span>;
  const photo = entry.thumbnailUrl || entry.photoUrl;
  const time = formatTakenTime(entry.takenAt);
  return (
    <span className={styles.identity}>
      {photo
        ? <img className={styles.identityThumb} src={photo} alt="" loading="lazy" />
        : <span className={styles.identityThumbEmpty}>写真なし</span>}
      <span className={styles.identityText}>
        <span className={styles.identityFood}>{entry.foodName || '無題'}</span>
        <span className={styles.identityMeta}>
          {time ? `撮影 ${time}・` : ''}{entry.date}{entry.place ? `・${entry.place}` : ''}
        </span>
        {reason && <span className={styles.problemReason}>{reason}</span>}
      </span>
    </span>
  );
}

export default function FieldBulkEditPanel({ entries, onClose, onSucceeded }: Props) {
  const { idToken, handleTokenExpired } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [options, setOptions] = useState<FieldEditOption[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loadFailed, setLoadFailed] = useState<{ entry: FieldLogEntry; message: string }[]>([]);
  const [form, setForm] = useState<BulkEditForm>(EMPTY_BULK_FORM);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<BulkEditSummary | null>(null);
  const pendingRequestRef = useRef<{ key: string; requestId: string } | null>(null);

  const handleError = (e: unknown, fallback: string): string => {
    if (e instanceof TokenExpiredError) handleTokenExpired();
    return e instanceof Error ? e.message : fallback;
  };

  // 各記録の現在のupdated_atを読む（楽観ロックの基準）。読めなかった記録は対象から外して知らせる
  const loadTargets = async (list: FieldLogEntry[]) => {
    if (!idToken) return;
    setPhase('loading');
    setError('');
    try {
      const [opts, details] = await Promise.all([
        options.length > 0 ? Promise.resolve(options) : fetchFieldEditOptions(idToken),
        Promise.allSettled(list.map((e) => fetchFieldEntryDetail(e.eventId, idToken))),
      ]);
      setOptions(opts);
      const ok: Target[] = [];
      const failed: { entry: FieldLogEntry; message: string }[] = [];
      details.forEach((d, i) => {
        if (d.status === 'fulfilled') ok.push({ entry: list[i], expectedUpdatedAt: d.value.updatedAt });
        else failed.push({ entry: list[i], message: handleError(d.reason, '読み込めませんでした') });
      });
      setTargets(ok);
      setLoadFailed(failed);
      pendingRequestRef.current = null;
      setPhase('form');
    } catch (e) {
      setError(handleError(e, '編集の準備ができませんでした。もう一度お試しください。'));
      setPhase('form');
    }
  };

  useEffect(() => {
    void loadTargets(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = bulkPatchFromForm(form);
  const changedFields = Object.keys(patch) as FieldBulkEditableField[];

  const setField = <K extends FieldBulkEditableField>(key: K, value: BulkEditForm[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // 小分類・フェーズは大分類と一緒に変える（記録ごとに大分類が違うと、合わない値が検証エラーになるため）
      if (key === 'large_category') {
        next.sub_category = null;
        next.phase = null;
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!idToken || targets.length === 0 || changedFields.length === 0 || phase === 'saving') return;
    const body = {
      entries: targets.map((t) => ({ eventId: t.entry.eventId, expectedUpdatedAt: t.expectedUpdatedAt })),
      changes: patch,
    };
    const key = JSON.stringify(body);
    if (pendingRequestRef.current?.key !== key) pendingRequestRef.current = { key, requestId: crypto.randomUUID() };
    setPhase('saving');
    setError('');
    try {
      const res = await bulkEditFieldEntries({ requestId: pendingRequestRef.current.requestId, ...body }, idToken);
      const s = summarizeBulkResults(res.results);
      // 成功した記録だけ、一覧・地図の値を更新する（ストアが持つ項目のうち、まとめて編集で変わるのは場所だけ）
      if (typeof patch.place === 'string') {
        for (const id of s.applied) useZukanFieldStore.getState().updateEntry(id, { place: patch.place });
      }
      setSummary(s);
      setPhase('result');
      if (s.succeeded.length > 0) onSucceeded(s.succeeded);
    } catch (e) {
      // 通信結果が分からない。同じ内容で保存し直せば同じrequestIdを使うので、二重には書かれない
      setError(handleError(e, '保存に失敗しました。もう一度お試しください。'));
      setPhase('form');
    }
  };

  // 競合した記録だけを、最新のupdated_atで読み直してやり直す（成功した記録はやり直さない）
  const retryConflicted = () => {
    if (!summary) return;
    const ids = new Set(summary.conflicted.map((c) => c.eventId));
    setSummary(null);
    void loadTargets(targets.map((t) => t.entry).filter((e) => ids.has(e.eventId)));
  };

  const byId = new Map(targets.map((t) => [t.entry.eventId, t.entry]));
  const partChoices = choicesFor('observed_parts', options, '', '');

  if (phase === 'result' && summary) {
    return (
      <section className={styles.panel} aria-label="まとめて編集の結果">
        <h2 className={styles.title}>まとめて編集の結果</h2>
        <p className={styles.counts}>
          <span className={styles.countOk}>成功 {summary.succeeded.length}件</span>
          <span className={summary.conflicted.length > 0 ? styles.countWarn : styles.countZero}>競合 {summary.conflicted.length}件</span>
          <span className={summary.failed.length > 0 ? styles.countWarn : styles.countZero}>失敗 {summary.failed.length}件</span>
        </p>
        {summary.noChange.length > 0 && (
          <p className={styles.note}>成功のうち{summary.noChange.length}件は、すでに同じ値だったため変更はありません。</p>
        )}
        {summary.conflicted.length > 0 && (
          <div className={styles.problemBox}>
            <p className={styles.problemTitle}>他の人が先に更新していた記録（この記録には何も書いていません）</p>
            <ul className={styles.problemList}>
              {summary.conflicted.map((c) => (
                <li key={c.eventId}><EntryIdentity entry={byId.get(c.eventId)} /></li>
              ))}
            </ul>
            <button className={styles.primaryBtn} onClick={retryConflicted}>
              競合した{summary.conflicted.length}件だけ、最新の内容でやり直す
            </button>
          </div>
        )}
        {summary.failed.length > 0 && (
          <div className={styles.problemBox}>
            <p className={styles.problemTitle}>保存できなかった記録</p>
            <ul className={styles.problemList}>
              {summary.failed.map((f) => (
                <li key={f.eventId}><EntryIdentity entry={byId.get(f.eventId)} reason={f.message} /></li>
              ))}
            </ul>
          </div>
        )}
        <button className={styles.secondaryBtn} onClick={onClose}>閉じる</button>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="まとめて編集">
      <h2 className={styles.title}>まとめて編集（{targets.length}件）</h2>
      {phase === 'loading' && <p className={styles.note}>選んだ記録の最新の状態を読み込み中…</p>}
      {loadFailed.length > 0 && (
        <div className={styles.problemBox}>
          <p className={styles.problemTitle}>読み込めなかったため対象から外した記録</p>
          <ul className={styles.problemList}>
            {loadFailed.map((f) => <li key={f.entry.eventId}><EntryIdentity entry={f.entry} reason={f.message} /></li>)}
          </ul>
        </div>
      )}

      {phase !== 'loading' && (
        <>
          <p className={styles.note}>変えたい項目だけ選んでください。「変更しない」の項目はそのまま残ります。食材名・観察日・メモは1件ずつ詳細画面で編集します。</p>

          <div className={styles.row}>
            <span className={styles.label}>{FIELD_LABELS.place}</span>
            <span className={styles.control}>
              <label className={styles.inline}>
                <input
                  type="checkbox"
                  checked={form.place !== null}
                  onChange={(e) => setField('place', e.target.checked ? '' : null)}
                />
                変更する
              </label>
              {form.place !== null && (
                <input
                  className={styles.input}
                  value={form.place}
                  onChange={(e) => setField('place', e.target.value)}
                  placeholder="新しい場所（空欄にすると場所を消します）"
                  aria-label="新しい場所"
                />
              )}
            </span>
          </div>

          {SELECT_FIELDS.map((f) => {
            const dependent = f === 'sub_category' || f === 'phase';
            const disabled = dependent && form.large_category === null;
            const choices = choicesFor(f, options, form.large_category ?? '', '');
            return (
              <label key={f} className={styles.row}>
                <span className={styles.label}>{FIELD_LABELS[f]}</span>
                <select
                  className={styles.select}
                  value={form[f] ?? KEEP}
                  disabled={disabled}
                  onChange={(e) => setField(f, e.target.value === KEEP ? null : e.target.value)}
                  aria-label={FIELD_LABELS[f]}
                >
                  <option value={KEEP}>{disabled ? '大分類と一緒に変更します' : '変更しない'}</option>
                  {f === 'phase' && <option value="">未記録（空欄）にする</option>}
                  {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
            );
          })}

          <div className={styles.row}>
            <span className={styles.label}>{FIELD_LABELS.observed_parts}</span>
            <span className={styles.control}>
              <label className={styles.inline}>
                <input
                  type="checkbox"
                  checked={form.observed_parts !== null}
                  onChange={(e) => setField('observed_parts', e.target.checked ? [] : null)}
                />
                置き換える
              </label>
              {form.observed_parts !== null && (
                <span className={styles.chips}>
                  {partChoices.map((c) => (
                    <label key={c.value} className={styles.chip}>
                      <input
                        type="checkbox"
                        checked={form.observed_parts!.includes(c.value)}
                        onChange={() => setField('observed_parts', toggleObservedPart(form.observed_parts ?? [], c.value))}
                      />
                      {c.label}
                    </label>
                  ))}
                </span>
              )}
            </span>
          </div>

          {changedFields.length > 0 && (
            <p className={styles.note}>
              {targets.length}件の{changedFields.map((f) => FIELD_LABELS[f]).join('・')}を変更します
            </p>
          )}
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.btnRow}>
            <button className={styles.secondaryBtn} onClick={onClose} disabled={phase === 'saving'}>キャンセル</button>
            <button
              className={styles.primaryBtn}
              onClick={() => void handleSave()}
              disabled={phase === 'saving' || changedFields.length === 0 || targets.length === 0}
            >
              {phase === 'saving' ? '保存中…' : `${targets.length}件に保存`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
