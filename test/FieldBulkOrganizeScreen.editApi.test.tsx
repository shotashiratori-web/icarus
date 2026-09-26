import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FieldBulkOrganizeScreen from '../src/screens/FieldBulkOrganizeScreen';
import { mockUseAuth } from './testAuth';
import { useZukanFieldStore } from '../src/store/zukanFieldStore';
import type { FieldLogEntry } from '../src/types/zukan';

// 一括写真の整理: 旧 /field/update-entry（GAS経由）から、D1正本の編集API（PATCH・bulk-edit）へ切替

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('../src/components/FieldGpsMiniMap', () => ({ default: () => null }));

const api = vi.hoisted(() => ({
  fetchFieldEntryDetail: vi.fn(),
  saveFieldEntryChanges: vi.fn(),
  bulkEditFieldEntries: vi.fn(),
}));
vi.mock('../src/api/fieldEntryEditApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/fieldEntryEditApi')>()),
  ...api,
}));
vi.mock('../src/api/zukanApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/zukanApi')>()),
  classifyFieldPhoto: vi.fn().mockResolvedValue({ isFieldSubject: true, reason: '' }),
  deleteFieldLogEntries: vi.fn(),
}));

const mk = (eventId: string, takenAt: string, over: Partial<FieldLogEntry> = {}): FieldLogEntry => ({
  id: eventId, foodName: '', place: '', date: '2026-09-01', memo: '', photoUrl: '', notionUrl: '', elevation: null, kigo: '',
  lat: 43, lng: 140, recordedAt: takenAt, eventId, takenAt, ...over,
});

const detail = (eventId: string, over: Record<string, string> = {}) => ({
  eventId, food: '', place: '', memo: '', date: '2026-09-01', kigo: '', updatedAt: `t-${eventId}`, ...over,
});

function renderScreen(entries: FieldLogEntry[]) {
  useZukanFieldStore.setState({ entries, loadState: 'ready', errorMessage: '' });
  render(<FieldBulkOrganizeScreen go={vi.fn()} from={{ name: 'field' } as never} />);
}

describe('FieldBulkOrganizeScreen: 編集APIへの切替', () => {
  beforeEach(() => {
    // jsdomにはElement.scrollToが無い（画面は写真切替時に先頭へスクロールする）
    Element.prototype.scrollTo = vi.fn();
    try { window.localStorage?.clear?.(); } catch { /* テスト環境にlocalStorageが無い場合がある */ }
    api.fetchFieldEntryDetail.mockReset().mockImplementation(async (id: string) => detail(id));
    api.saveFieldEntryChanges.mockReset().mockImplementation(async (id: string, patch: Record<string, string>) => detail(id, patch));
    api.bulkEditFieldEntries.mockReset();
  });

  it('1. 保存して次へ: 食材名・場所をfood・placeとして、表示時のupdated_atで保存する', async () => {
    renderScreen([mk('e1', '2026-09-01T10:00:00+09:00')]);
    await waitFor(() => expect(api.fetchFieldEntryDetail).toHaveBeenCalledWith('e1', 'test-token'));
    fireEvent.change(screen.getByPlaceholderText('食材名を入力'), { target: { value: 'ナラタケ' } });
    fireEvent.change(screen.getByPlaceholderText('覚えていれば入力'), { target: { value: '赤井川' } });
    fireEvent.click(screen.getByRole('button', { name: '保存して次へ' }));
    await waitFor(() => expect(api.saveFieldEntryChanges).toHaveBeenCalledTimes(1));
    const [eventId, patch, , opts] = api.saveFieldEntryChanges.mock.calls[0];
    expect(eventId).toBe('e1');
    expect(patch).toEqual({ food: 'ナラタケ', place: '赤井川' });
    expect(opts.expectedUpdatedAt).toBe('t-e1');
    await screen.findByText('今回の対象は以上です');
  });

  it('2. 409なら最新を読み込み、自分の入力を残して知らせる（次へ進まない）', async () => {
    const { FieldEditConflictError } = await import('../src/api/fieldEntryEditApi');
    renderScreen([mk('e1', '2026-09-01T10:00:00+09:00')]);
    await waitFor(() => expect(api.fetchFieldEntryDetail).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('食材名を入力'), { target: { value: 'ナラタケ' } });
    api.saveFieldEntryChanges.mockRejectedValueOnce(new FieldEditConflictError('x'));
    api.fetchFieldEntryDetail.mockResolvedValue(detail('e1', { memo: '他の人のメモ', updatedAt: 't9' }));
    fireEvent.click(screen.getByRole('button', { name: '保存して次へ' }));
    await screen.findByText(/他の人が先にこの記録を更新しました/);
    expect(screen.getByPlaceholderText('食材名を入力')).toHaveValue('ナラタケ');
    expect(screen.getByPlaceholderText('気づいたこと・状況など、覚えていれば入力')).toHaveValue('他の人のメモ');
    expect(screen.queryByText('今回の対象は以上です')).not.toBeInTheDocument();
  });

  it('3. 近くの写真へ場所をまとめて適用するときはbulk-editを使い、競合は件数で知らせる', async () => {
    renderScreen([
      mk('e1', '2026-09-01T10:00:00+09:00'),
      mk('e2', '2026-09-01T10:01:00+09:00', { foodName: 'ナラタケ' }),
      mk('e3', '2026-09-01T10:02:00+09:00', { foodName: 'ナラタケ' }),
    ]);
    await waitFor(() => expect(api.fetchFieldEntryDetail).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('覚えていれば入力'), { target: { value: '赤井川' } });
    api.bulkEditFieldEntries.mockResolvedValue({
      bulkId: 'b',
      results: [
        { eventId: 'e2', ok: true, outcome: 'applied', message: '' },
        { eventId: 'e3', ok: false, code: 'EDIT_CONFLICT', message: '' },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: /この場所を、近くの2件にも/ }));
    await screen.findByText(/成功1件／競合1件／失敗0件/);
    const body = api.bulkEditFieldEntries.mock.calls[0][0];
    expect(body.changes).toEqual({ place: '赤井川' });
    expect(body.entries).toEqual([{ eventId: 'e2', expectedUpdatedAt: 't-e2' }, { eventId: 'e3', expectedUpdatedAt: 't-e3' }]);
    expect(useZukanFieldStore.getState().entries.find((e) => e.eventId === 'e2')?.place).toBe('赤井川');
    expect(useZukanFieldStore.getState().entries.find((e) => e.eventId === 'e3')?.place).toBe('');
  });
});
