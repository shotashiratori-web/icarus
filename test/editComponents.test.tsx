import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import EditFooter from '../src/components/edit/EditFooter';
import ConflictBanner from '../src/components/edit/ConflictBanner';
import EditHistoryList from '../src/components/edit/EditHistoryList';
import BulkResultSummary from '../src/components/edit/BulkResultSummary';
import { summarizeBulkOutcomes } from '../src/utils/editCore';

// 共通の編集 UX 部品（共通化 Audit、2026-09-27）。既存画面にはまだ導入しない

describe('EditFooter', () => {
  it('変更があれば「変更する項目」と保存、無ければ「変更なし（閉じる）」', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<EditFooter changedLabels={['本文', '注記']} isSaving={false} onSave={onSave} onClose={onClose} />);
    expect(screen.getByText('変更する項目: 本文・注記')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    rerender(<EditFooter changedLabels={[]} isSaving={false} onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '変更なし（閉じる）' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
  it('保存中・入力エラーでは押せない。エラー文言を出す', () => {
    const { rerender } = render(<EditFooter changedLabels={['本文']} isSaving onSave={vi.fn()} errorMessage="失敗しました" />);
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('失敗しました');
    rerender(<EditFooter changedLabels={['本文']} isSaving={false} canSave={false} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });
  it('未保存の確認: 編集を続ける／変更を破棄する', () => {
    const onContinue = vi.fn();
    const onDiscard = vi.fn();
    render(<EditFooter changedLabels={['本文']} isSaving={false} onSave={vi.fn()} showUnsavedConfirm onContinueEditing={onContinue} onDiscard={onDiscard} />);
    expect(screen.getByText('保存されていない変更があります')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }));
    fireEvent.click(screen.getByRole('button', { name: '変更を破棄する' }));
    expect(onContinue).toHaveBeenCalled();
    expect(onDiscard).toHaveBeenCalled();
  });
});

describe('ConflictBanner', () => {
  it('自分が変えた項目は残した旨、両方が変えた項目を名前で示す', () => {
    render(<ConflictBanner mineLabels={['本文']} overlapLabels={['本文']} />);
    const b = screen.getByRole('alert');
    expect(b).toHaveTextContent('他の人が先にこの記録を更新しました');
    expect(b).toHaveTextContent('あなたが変更した項目（本文）はそのまま残しています');
    expect(b).toHaveTextContent('本文は他の人も変更しています');
  });
  it('両方が変えた項目が無ければその文は出さない', () => {
    render(<ConflictBanner mineLabels={['注記']} overlapLabels={[]} />);
    expect(screen.getByRole('alert')).not.toHaveTextContent('他の人も変更しています');
  });
});

describe('EditHistoryList', () => {
  it('いつ・誰が・経路・理由・項目：変更前 → 変更後。空欄は（空欄）', () => {
    render(<EditHistoryList items={[
      { id: '1', editedAt: '2026-09-26T03:00:00Z', actorName: '山田', sourceLabel: '訂正', reason: '誤字', changes: [{ label: '本文', old: '', new: '仕込み' }] },
    ]} />);
    const item = screen.getAllByRole('listitem')[0]; // 外側（1 件の履歴）
    expect(item).toHaveTextContent('山田・訂正');
    expect(item).toHaveTextContent('誤字');
    expect(item).toHaveTextContent('本文（空欄） → 仕込み');
  });
  it('読み込み中・エラー・空の表示', () => {
    const { rerender } = render(<EditHistoryList items={null} loading />);
    expect(screen.getByText('読み込み中…')).toBeInTheDocument();
    rerender(<EditHistoryList items={null} errorMessage="読めませんでした" />);
    expect(screen.getByText('読めませんでした')).toBeInTheDocument();
    rerender(<EditHistoryList items={[]} emptyText="訂正履歴はまだありません" />);
    expect(screen.getByText('訂正履歴はまだありません')).toBeInTheDocument();
  });
});

describe('BulkResultSummary', () => {
  it('件数・見分け表示・競合だけやり直す', () => {
    const onRetry = vi.fn();
    const summary = summarizeBulkOutcomes([
      { id: 'a', outcome: 'applied' }, { id: 'b', outcome: 'conflict' }, { id: 'c', outcome: 'failed', message: '見つかりません' },
    ]);
    render(<BulkResultSummary summary={summary} renderIdentity={(id) => <span>記録{id}</span>} onRetryConflicted={onRetry} onClose={vi.fn()} />);
    const panel = screen.getByRole('region', { name: 'まとめて編集の結果' });
    expect(within(panel).getByText('成功 1件')).toBeInTheDocument();
    expect(within(panel).getByText('競合 1件')).toBeInTheDocument();
    expect(within(panel).getByText('失敗 1件')).toBeInTheDocument();
    expect(within(panel).getByText('記録b')).toBeInTheDocument();
    expect(within(panel).getByText('見つかりません')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: '競合した1件だけ、最新の内容でやり直す' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
