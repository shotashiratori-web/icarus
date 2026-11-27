import { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { WORK_TYPE_OPTIONS, nowLocalDatetimeString, type WorkSubmitSuccess } from '../types/workLog';
import { saveWorkLogDraft, loadWorkLogDraft, clearWorkLogDraft } from '../db/localDB';
import { submitWithFallback } from '../submission/orchestrator';
import type { WorkLogSubmissionPayload } from '../submission/adapters/workLogAdapter';
import { prepareWorkLogPhoto } from '../utils/workLogPhoto';
import {
  buildInventoryContent, type InventoryCommon, type InventoryItemFields, type OpenState, type StorageClass,
} from '../utils/inventoryContent';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import styles from './WorkFormScreen.module.css';
import own from './WorkInventoryScreen.module.css';

// 作業ログの棚卸しモード（icarus/docs/architecture/icarus_work_log_inventory_mode_design.md）。
// 写真をまとめて選び、1 枚 = 1 品 = 1 作業として登録する。各写真は選んだ時点で普通の作業ログの下書き
// （work_log_draft、requestId ごと）として端末に保存し、送信は今の作業ログと同じ送信キュー（workLogAdapter）で
// 1 件ずつ順に行う。原本は下書き（IndexedDB）にだけ持ち、画面の状態には縮小 JPEG（プレビュー）だけを持つ
// （20 枚の原本を同時にメモリへ載せない）。途中で閉じても、入れた分は「未送信の下書き」に 1 件ずつ残る。

export const INVENTORY_MAX_PHOTOS = 20;
const STORAGE_CLASSES: StorageClass[] = ['冷蔵', '冷凍', '常温'];
const OPEN_STATES: Exclude<OpenState, ''>[] = ['未開封', '開封済み'];
const LAST_LOCATION_KEY = 'icarus.inventory.lastLocation';

type Phase = 'common' | 'loading' | 'items' | 'confirm' | 'sending' | 'done';

interface Item extends InventoryItemFields {
  requestId: string;
  previewBase64: string;
}

type ItemResult = 'sent' | 'queued' | 'blocked';

function readLastLocation(): string {
  try { return localStorage.getItem(LAST_LOCATION_KEY) ?? ''; } catch { return ''; }
}
function writeLastLocation(v: string): void {
  try { localStorage.setItem(LAST_LOCATION_KEY, v); } catch { /* 覚えられなくても続ける */ }
}

// 下書きの文字の項目だけを書き換える（原本は下書きにあるものをそのまま残す）
async function updateDraft(item: Item, common: InventoryCommon): Promise<void> {
  const draft = await loadWorkLogDraft(item.requestId);
  if (!draft) return;
  const { key: _key, savedAt: _savedAt, ...rest } = draft;
  await saveWorkLogDraft({
    ...rest,
    title: item.name.trim(),
    type: common.type,
    content: buildInventoryContent(common, item),
    datetime: common.datetime,
  });
}

type Props = { go: (s: Screen) => void };

const commonSummary = (values: string[]) => values.map((v) => v.trim()).filter(Boolean).join('・');

export default function WorkInventoryScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [phase, setPhase] = useState<Phase>('common');
  const [common, setCommon] = useState<InventoryCommon>(() => ({
    type: '加工研究', storageClass: '', location: readLastLocation(), datetime: nowLocalDatetimeString(),
  }));
  const [items, setItems] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const [loadProgress, setLoadProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [results, setResults] = useState<Record<string, ItemResult>>({});
  const [sendIndex, setSendIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const commonErrors: string[] = [];
  if (!common.type) commonErrors.push('種別');
  if (!common.datetime.trim()) commonErrors.push('記録日時');

  const setCommonField = <K extends keyof InventoryCommon>(k: K, v: InventoryCommon[K]) => setCommon((c) => ({ ...c, [k]: v }));
  const setItemField = <K extends keyof InventoryItemFields>(k: K, v: InventoryItemFields[K]) =>
    setItems((list) => list.map((it, i) => (i === index ? { ...it, [k]: v } : it)));

  // ── 写真をまとめて読み込む（1 枚ずつ順に。原本は下書きへ書いて画面の状態には持たない）──
  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, INVENTORY_MAX_PHOTOS);
    e.target.value = '';
    if (files.length === 0) return;
    writeLastLocation(common.location.trim());
    setPhase('loading');
    setLoadProgress({ done: 0, total: files.length, failed: 0 });
    const loaded: Item[] = [];
    let failed = 0;
    for (const file of files) {
      try {
        const { previewBase64, original } = await prepareWorkLogPhoto(file);
        const item: Item = {
          requestId: crypto.randomUUID(), previewBase64,
          name: '', quantity: '', producedOn: '', openState: '', memo: '',
        };
        await saveWorkLogDraft({
          requestId: item.requestId, mode: 'create', title: '', type: common.type,
          content: buildInventoryContent(common, item), datetime: common.datetime,
          photoBase64: previewBase64, photoMimeType: 'image/jpeg', photoOriginal: original,
        });
        loaded.push(item);
      } catch {
        failed += 1;
      }
      setLoadProgress({ done: loaded.length + failed, total: files.length, failed });
    }
    setItems(loaded);
    setIndex(0);
    setPhase(loaded.length > 0 ? 'items' : 'common');
    if (failed > 0) alert(`${failed} 枚の写真を読み込めませんでした`);
  };

  const current = items[index];

  const goTo = async (next: number) => {
    if (current) await updateDraft(current, common).catch(() => undefined);
    if (next >= items.length) { setPhase('confirm'); return; }
    setIndex(Math.max(0, next));
  };

  const removeCurrent = async () => {
    if (!current) return;
    if (!window.confirm('この写真を外しますか？（登録しません）')) return;
    await clearWorkLogDraft(current.requestId).catch(() => undefined);
    const rest = items.filter((_, i) => i !== index);
    setItems(rest);
    if (rest.length === 0) { setPhase('common'); return; }
    setIndex(Math.min(index, rest.length - 1));
  };

  const missingNames = items.filter((it) => !it.name.trim()).length;

  // ── まとめて送る（1 件ずつ順に。GAS が作業 ID を 1 件ずつ採番するため同時に送らない）──
  const sendAll = async () => {
    if (!idToken) { handleTokenExpired(); return; }
    setPhase('sending');
    const out: Record<string, ItemResult> = {};
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      setSendIndex(i);
      await updateDraft(it, common).catch(() => undefined);
      const outcome = await submitWithFallback<WorkLogSubmissionPayload, WorkSubmitSuccess | undefined>({
        entity: 'workLog',
        itemId: it.requestId,
        payload: { requestId: it.requestId },
        title: it.name.trim() || '（無題の作業）',
        displayDate: common.datetime,
        idToken,
      });
      out[it.requestId] = outcome.ok ? 'sent' : outcome.item.lastError?.retryable === false ? 'blocked' : 'queued';
      setResults({ ...out });
    }
    setPhase('done');
  };

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════

  const header = (title: string, back?: () => void) => (
    <header className={styles.header}>
      {back && <button className={styles.backBtn} onClick={back}>← 戻る</button>}
      <span className={styles.headerTitle}>{title}</span>
      <HomeButton go={go} />
    </header>
  );

  if (authState !== 'ready') {
    return (
      <div className={styles.root}>
        {header('棚卸しモード', () => go({ name: 'processing' }))}
        <main className={styles.authMain}>
          <div className={styles.authCard}>
            {authState === 'signedOut' ? (
              <>
                <p className={styles.authLead}>Googleアカウントでログインしてください。</p>
                <div ref={signInContainerRef} className={styles.googleBtnWrap} />
              </>
            ) : (
              <p className={styles.authLead}>ログイン確認中…</p>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (phase === 'common') {
    return (
      <div className={styles.root}>
        {header('棚卸しモード', () => go({ name: 'processing' }))}
        <main className={styles.formMain}>
          <p className={own.lead}>全部の品に同じ値が入ります。保存区分・保管場所は空のままでも大丈夫です（品名だけで登録できます）。次に写真をまとめて選びます（最大 {INVENTORY_MAX_PHOTOS} 枚）。</p>
          <label className={styles.fieldLabel}>
            種別 <span className={styles.required}>*</span>
            <select className={styles.selectInput} value={common.type} onChange={(e) => setCommonField('type', e.target.value)}>
              {WORK_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <div className={styles.fieldLabel}>
            保存区分
            <div className={own.choiceRow} role="radiogroup" aria-label="保存区分">
              {STORAGE_CLASSES.map((c) => (
                <button
                  key={c} type="button" role="radio" aria-checked={common.storageClass === c}
                  className={common.storageClass === c ? own.choiceOn : own.choice}
                  onClick={() => setCommonField('storageClass', common.storageClass === c ? '' : c)}
                >{c}</button>
              ))}
            </div>
          </div>
          <label className={styles.fieldLabel}>
            保管場所
            <input type="text" className={styles.textInput} placeholder="例: 冷蔵庫A・上段" value={common.location} onChange={(e) => setCommonField('location', e.target.value)} />
          </label>
          <label className={styles.fieldLabel}>
            記録日時 <span className={styles.required}>*</span>
            <input type="datetime-local" className={styles.textInput} value={common.datetime} onChange={(e) => setCommonField('datetime', e.target.value)} />
          </label>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className={styles.hidden} onChange={handleFiles} data-testid="inventory-file-input" />
        </main>
        <footer className={styles.footer}>
          <button className={styles.primaryBtn} disabled={commonErrors.length > 0} onClick={() => fileInputRef.current?.click()}>
            📷 写真をまとめて選ぶ
          </button>
          {commonErrors.length > 0 && <p className={styles.footerHint}>未入力: {commonErrors.join('・')}</p>}
        </footer>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className={styles.root}>
        {header('写真を読み込み中')}
        <main className={styles.centeredMain}>
          <div className={styles.spinner} />
          <p className={styles.sendingText}>読み込み中 {loadProgress.done} / {loadProgress.total}</p>
        </main>
      </div>
    );
  }

  if (phase === 'items' && current) {
    return (
      <div className={styles.root}>
        {header(`${index + 1} / ${items.length}`, () => setPhase('common'))}
        <main className={styles.formMain}>
          <img src={`data:image/jpeg;base64,${current.previewBase64}`} alt="" className={own.bigPhoto} />
          {commonSummary([common.storageClass, common.location]) && <p className={own.commonLine}>{commonSummary([common.storageClass, common.location])}</p>}
          <label className={styles.fieldLabel}>
            品名 <span className={styles.required}>*</span>
            <input type="text" className={styles.textInput} placeholder="例: ナラタケ塩漬け" value={current.name} onChange={(e) => setItemField('name', e.target.value)} />
          </label>
          <label className={styles.fieldLabel}>
            数量・残量
            <input type="text" className={styles.textInput} placeholder="例: 2瓶・約800g" value={current.quantity} onChange={(e) => setItemField('quantity', e.target.value)} />
          </label>
          <label className={styles.fieldLabel}>
            製造日
            <input type="text" className={styles.textInput} placeholder="例: 2025/10（分からなければ空）" value={current.producedOn} onChange={(e) => setItemField('producedOn', e.target.value)} />
          </label>
          <div className={styles.fieldLabel}>
            開封状態
            <div className={own.choiceRow} role="radiogroup" aria-label="開封状態">
              {OPEN_STATES.map((o) => (
                <button
                  key={o} type="button" role="radio" aria-checked={current.openState === o}
                  className={current.openState === o ? own.choiceOn : own.choice}
                  onClick={() => setItemField('openState', current.openState === o ? '' : o)}
                >{o}</button>
              ))}
            </div>
          </div>
          <label className={styles.fieldLabel}>
            メモ
            <textarea className={styles.textarea} rows={2} value={current.memo} onChange={(e) => setItemField('memo', e.target.value)} />
          </label>
          <button type="button" className={own.removeBtn} onClick={removeCurrent}>この写真を外す</button>
        </main>
        <footer className={styles.footer}>
          <div className={own.navRow}>
            <button className={styles.secondaryBtn} disabled={index === 0} onClick={() => goTo(index - 1)}>← 前へ</button>
            <button className={styles.primaryBtn} disabled={!current.name.trim()} onClick={() => goTo(index + 1)}>
              {index === items.length - 1 ? '確認へ →' : '次へ →'}
            </button>
          </div>
          {!current.name.trim() && <p className={styles.footerHint}>品名を入れてください</p>}
        </footer>
      </div>
    );
  }

  if (phase === 'confirm') {
    return (
      <div className={styles.root}>
        {header('登録内容の確認', () => { setIndex(items.length - 1); setPhase('items'); })}
        <main className={styles.confirmMain}>
          <p className={own.commonLine}>{commonSummary([common.type, common.storageClass, common.location, common.datetime.replace('T', ' ')])}</p>
          <ul className={own.confirmGrid}>
            {items.map((it, i) => (
              <li key={it.requestId}>
                <button type="button" className={own.confirmItem} onClick={() => { setIndex(i); setPhase('items'); }}>
                  <img src={`data:image/jpeg;base64,${it.previewBase64}`} alt="" className={own.thumb} />
                  <span className={it.name.trim() ? own.thumbName : own.thumbMissing}>{it.name.trim() || '品名なし'}</span>
                </button>
              </li>
            ))}
          </ul>
        </main>
        <footer className={styles.footer}>
          <button className={styles.primaryBtn} disabled={missingNames > 0} onClick={sendAll}>{items.length} 件を登録</button>
          {missingNames > 0 && <p className={styles.footerHint}>品名が無いものが {missingNames} 件あります（押して入れられます）</p>}
        </footer>
      </div>
    );
  }

  if (phase === 'sending') {
    return (
      <div className={styles.root}>
        {header('登録中…')}
        <main className={styles.centeredMain}>
          <div className={styles.spinner} />
          <p className={styles.sendingText}>送信中 {Math.min(sendIndex + 1, items.length)} / {items.length}</p>
        </main>
      </div>
    );
  }

  // ── 完了 ──
  const sent = items.filter((it) => results[it.requestId] === 'sent').length;
  const queued = items.filter((it) => results[it.requestId] === 'queued').length;
  const blocked = items.filter((it) => results[it.requestId] === 'blocked').length;
  return (
    <div className={styles.root}>
      {header('棚卸しの登録')}
      <main className={styles.completeMain}>
        <div className={queued + blocked > 0 ? styles.warnIcon : styles.successIcon}>{queued + blocked > 0 ? '…' : '✓'}</div>
        <p className={styles.successText}>{sent} 件を登録しました</p>
        {queued > 0 && <p className={styles.footerHint}>{queued} 件は端末に保存しました。通信が戻ると自動で送ります。</p>}
        {blocked > 0 && <p className={styles.footerHint}>{blocked} 件は送れませんでした。保留中一覧から確かめてください。</p>}
        <button className={styles.primaryBtn} onClick={() => { setItems([]); setResults({}); setCommonField('datetime', nowLocalDatetimeString()); setPhase('common'); }}>続けて棚卸しする</button>
        {(queued > 0 || blocked > 0) && <button className={styles.secondaryBtn} onClick={() => go({ name: 'pendingList' })}>保留中一覧へ</button>}
        <button className={styles.secondaryBtn} onClick={() => go({ name: 'processing' })}>一覧へ戻る</button>
      </main>
    </div>
  );
}
