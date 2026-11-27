import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkInventoryScreen from '../src/screens/WorkInventoryScreen';
import { mockUseAuth } from './testAuth';

// 棚卸しモード（icarus_work_log_inventory_mode_design.md）。写真をまとめて選び、1 枚 = 1 作業の下書きを作り、
// 1 件ずつ順に送信キューへ載せる。写真の準備・下書き（IndexedDB）・送信キューは mock する

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const store = new Map<string, Record<string, unknown>>();
const { saveWorkLogDraft, loadWorkLogDraft, clearWorkLogDraft } = vi.hoisted(() => ({
  saveWorkLogDraft: vi.fn(),
  loadWorkLogDraft: vi.fn(),
  clearWorkLogDraft: vi.fn(),
}));
vi.mock('../src/db/localDB', () => ({ saveWorkLogDraft, loadWorkLogDraft, clearWorkLogDraft }));

const { submitWithFallback } = vi.hoisted(() => ({ submitWithFallback: vi.fn() }));
vi.mock('../src/submission/orchestrator', () => ({ submitWithFallback }));

const { prepareWorkLogPhoto } = vi.hoisted(() => ({ prepareWorkLogPhoto: vi.fn() }));
vi.mock('../src/utils/workLogPhoto', () => ({ prepareWorkLogPhoto }));

const file = (n: string) => new File(['x'], n, { type: 'image/jpeg' });

async function fillCommonAndSelect(files: File[]) {
  fireEvent.click(screen.getByRole('radio', { name: '冷蔵' }));
  fireEvent.change(screen.getByPlaceholderText('例: 冷蔵庫A・上段'), { target: { value: '冷蔵庫A・上段' } });
  fireEvent.change(screen.getByTestId('inventory-file-input'), { target: { files } });
  await screen.findByText(`1 / ${files.length}`);
}

function setName(v: string) {
  fireEvent.change(screen.getByPlaceholderText('例: ナラタケ塩漬け'), { target: { value: v } });
}

describe('WorkInventoryScreen', () => {
  beforeEach(() => {
    store.clear();
    saveWorkLogDraft.mockReset().mockImplementation(async (d: Record<string, unknown>) => { store.set(String(d.requestId), { ...d, key: `work:${d.requestId}`, savedAt: 'now' }); });
    loadWorkLogDraft.mockReset().mockImplementation(async (id: string) => store.get(id));
    clearWorkLogDraft.mockReset().mockImplementation(async (id: string) => { store.delete(id); });
    submitWithFallback.mockReset().mockResolvedValue({ ok: true, result: { status: 'success', workId: '20261127-001', row: 2, photoUrl: '' } });
    prepareWorkLogPhoto.mockReset().mockImplementation(async (f: File) => ({
      previewBase64: `PREVIEW-${f.name}`,
      original: { assetRequestId: `asset-${f.name}`, base64: `ORIGINAL-${f.name}`, mimeType: 'image/jpeg', fileHash: 'h', sizeBytes: 1, fileName: f.name },
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('保存区分・保管場所は空のままでも写真を選べ、品名だけで下書きが揃う', async () => {
    render(<WorkInventoryScreen go={vi.fn()} />);
    expect(screen.getByRole('button', { name: '📷 写真をまとめて選ぶ' })).toBeEnabled();
    fireEvent.change(screen.getByTestId('inventory-file-input'), { target: { files: [file('a.jpg')] } });
    await screen.findByText('1 / 1');
    const requestId = saveWorkLogDraft.mock.calls[0][0].requestId;
    expect(store.get(requestId)?.content).toBe('棚卸しで登録');
    setName('ナラタケ塩漬け');
    fireEvent.click(screen.getByRole('button', { name: /次へ|確認/ }));
    await waitFor(() => expect(store.get(requestId)?.title).toBe('ナラタケ塩漬け'));
    expect(store.get(requestId)?.content).toBe('棚卸しで登録');
  });

  it('写真を選ぶと 1 枚ずつ下書き（原本つき・新規作成）を作る', async () => {
    render(<WorkInventoryScreen go={vi.fn()} />);
    await fillCommonAndSelect([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    expect(saveWorkLogDraft).toHaveBeenCalledTimes(3);
    const first = saveWorkLogDraft.mock.calls[0][0];
    expect(first).toMatchObject({ mode: 'create', type: '加工研究', photoBase64: 'PREVIEW-a.jpg', content: '保存：冷蔵\n場所：冷蔵庫A・上段' });
    expect(first.photoOriginal.base64).toBe('ORIGINAL-a.jpg');
  });

  it('品名などを入れて次へ: 下書きの題名・内容を更新し、原本は残す。品名が無いと次へ進めない', async () => {
    render(<WorkInventoryScreen go={vi.fn()} />);
    await fillCommonAndSelect([file('a.jpg'), file('b.jpg')]);
    expect(screen.getByRole('button', { name: '次へ →' })).toBeDisabled();
    setName('ナラタケ塩漬け');
    fireEvent.change(screen.getByPlaceholderText('例: 2瓶・約800g'), { target: { value: '2瓶' } });
    fireEvent.click(screen.getByRole('radio', { name: '未開封' }));
    fireEvent.click(screen.getByRole('button', { name: '次へ →' }));
    await screen.findByText('2 / 2');
    const saved = [...store.values()].find((d) => d.title === 'ナラタケ塩漬け')!;
    expect(saved.content).toBe('保存：冷蔵\n場所：冷蔵庫A・上段\n量：2瓶\n開封：未開封');
    expect((saved.photoOriginal as { base64: string }).base64).toBe('ORIGINAL-a.jpg');
  });

  it('写真を外すと、その下書きを消して登録しない', async () => {
    render(<WorkInventoryScreen go={vi.fn()} />);
    await fillCommonAndSelect([file('a.jpg'), file('b.jpg')]);
    fireEvent.click(screen.getByRole('button', { name: 'この写真を外す' }));
    await screen.findByText('1 / 1');
    expect(clearWorkLogDraft).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
  });

  it('確認 → まとめて登録: 1 件ずつ順に送信キューへ。送れなかった物は件数を出す', async () => {
    submitWithFallback
      .mockResolvedValueOnce({ ok: true, result: { status: 'success', workId: '20261127-001', row: 2, photoUrl: '' } })
      .mockResolvedValueOnce({ ok: false, item: { lastError: { retryable: true } } });
    render(<WorkInventoryScreen go={vi.fn()} />);
    await fillCommonAndSelect([file('a.jpg'), file('b.jpg')]);
    setName('ナラタケ塩漬け');
    fireEvent.click(screen.getByRole('button', { name: '次へ →' }));
    await screen.findByText('2 / 2');
    setName('杏シロップ');
    fireEvent.click(screen.getByRole('button', { name: '確認へ →' }));
    fireEvent.click(await screen.findByRole('button', { name: '2 件を登録' }));

    expect(await screen.findByText('1 件を登録しました')).toBeInTheDocument();
    expect(screen.getByText(/1 件は端末に保存しました/)).toBeInTheDocument();
    expect(submitWithFallback).toHaveBeenCalledTimes(2);
    const titles = submitWithFallback.mock.calls.map((c) => c[0].title);
    expect(titles).toEqual(['ナラタケ塩漬け', '杏シロップ']);
    expect(submitWithFallback.mock.calls[0][0]).toMatchObject({ entity: 'workLog' });
    await waitFor(() => expect([...store.values()].map((d) => d.title).sort()).toEqual(['ナラタケ塩漬け', '杏シロップ'].sort()));
  });
});
