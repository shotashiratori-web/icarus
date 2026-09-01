import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import WineDetailScreen, { previewText } from '../src/screens/WineDetailScreen';
import { mockUseAuth } from './testAuth';
import type { AuthContextValue } from '../src/context/AuthContext';
import type { WineEntity } from '../src/types/wineEntity';
import type { WineTastingNoteItem } from '../src/api/wineTastingNoteApi';

// Tasting Note Persistence v1（Stage 1C-B）。WineDetailScreenが
// GET /wine-tasting-notes?wineId=...（既存Stage 1A API）をread-onlyで表示することを検証する。
// private ownershipはserver側（created_by=auth.email）で保証される前提のため、
// client側で追加filterを行っていないこと自体もテストで確認する。

const { fetchWineTastingNotesByWine } = vi.hoisted(() => ({ fetchWineTastingNotesByWine: vi.fn() }));
vi.mock('../src/api/wineTastingNoteApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/wineTastingNoteApi')>();
  return { ...actual, fetchWineTastingNotesByWine };
});

let authOverride: AuthContextValue = mockUseAuth();
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => authOverride }));

function wine(overrides: Partial<WineEntity> = {}): WineEntity {
  return {
    id: 'wine-1',
    title: 'モンロゼ AK',
    description: '',
    photos: [],
    tags: [],
    status: 'active',
    producer: 'ドメーヌ・モン',
    vintage: 2021,
    variety: '',
    origin: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'staff@example.com',
    ...overrides,
  };
}

function note(overrides: Partial<WineTastingNoteItem> = {}): WineTastingNoteItem {
  return {
    id: 'note-1',
    requestId: 'req-1',
    wineId: 'wine-1',
    tastingDate: '2026-08-01',
    location: '店内',
    wineNameSnapshot: 'モンロゼ AK',
    producerSnapshot: 'ドメーヌ・モン',
    vintageSnapshot: '2021',
    aromaText: 'ベリー',
    memoText: 'テストメモ',
    glassPrice: '',
    bottlePrice: '',
    rawNoteJson: {},
    status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'staff@example.com',
    photoUrl: null,
    ...overrides,
  };
}

describe('WineDetailScreen — Tasting Notes（Stage 1C-B）', () => {
  beforeEach(() => {
    fetchWineTastingNotesByWine.mockReset();
    authOverride = mockUseAuth();
  });

  it('1. wine.idを使ってfetchWineTastingNotesByWineを呼び出す', async () => {
    fetchWineTastingNotesByWine.mockResolvedValue([]);
    render(<WineDetailScreen go={vi.fn()} entry={wine({ id: 'wine-42' })} />);

    await waitFor(() => expect(fetchWineTastingNotesByWine).toHaveBeenCalledWith('wine-42', 'test-token'));
  });

  it('3. 0件ならempty stateを表示する', async () => {
    fetchWineTastingNotesByWine.mockResolvedValue([]);
    render(<WineDetailScreen go={vi.fn()} entry={wine()} />);

    await waitFor(() => expect(screen.getByText('このワインのテイスティングノートはまだありません')).toBeInTheDocument());
  });

  it('2/4. 複数件のNoteを表示する（本人Noteのみという前提でAPIが返した内容をそのまま表示）', async () => {
    fetchWineTastingNotesByWine.mockResolvedValue([
      note({ id: 'n1', memoText: '1件目' }),
      note({ id: 'n2', memoText: '2件目' }),
    ]);
    render(<WineDetailScreen go={vi.fn()} entry={wine()} />);

    await waitFor(() => {
      expect(screen.getByText('1件目')).toBeInTheDocument();
      expect(screen.getByText('2件目')).toBeInTheDocument();
    });
  });

  it('5. APIが返した順序のまま表示する（client側で並び替えない）', async () => {
    fetchWineTastingNotesByWine.mockResolvedValue([
      note({ id: 'n-newest', memoText: '新しい方が先' }),
      note({ id: 'n-older', memoText: '古い方が後' }),
    ]);
    render(<WineDetailScreen go={vi.fn()} entry={wine()} />);

    await waitFor(() => expect(screen.getByText('新しい方が先')).toBeInTheDocument());
    const memos = screen.getAllByText(/先|後/).map((el) => el.textContent);
    expect(memos).toEqual(['新しい方が先', '古い方が後']);
  });

  it('6/7. 日付とlocationを表示する', async () => {
    fetchWineTastingNotesByWine.mockResolvedValue([note({ tastingDate: '2026-08-15', location: 'カウンター席' })]);
    render(<WineDetailScreen go={vi.fn()} entry={wine()} />);

    await waitFor(() => {
      expect(screen.getByText('2026-08-15')).toBeInTheDocument();
      expect(screen.getByText('カウンター席')).toBeInTheDocument();
    });
  });

  it('date/locationが両方空でもレイアウトが壊れない（metaを表示しないだけ）', async () => {
    fetchWineTastingNotesByWine.mockResolvedValue([note({ tastingDate: '', location: '', memoText: 'メモのみ' })]);
    render(<WineDetailScreen go={vi.fn()} entry={wine()} />);

    await waitFor(() => expect(screen.getByText('メモのみ')).toBeInTheDocument());
  });

  it('8/9. aroma/memoは長文をpreview（truncate）して表示する', async () => {
    const longMemo = 'あ'.repeat(200);
    fetchWineTastingNotesByWine.mockResolvedValue([note({ aromaText: 'い'.repeat(100), memoText: longMemo })]);
    render(<WineDetailScreen go={vi.fn()} entry={wine()} />);

    await waitFor(() => {
      const memoEl = screen.getByText(/^あ+…$/);
      expect(memoEl.textContent!.length).toBeLessThan(longMemo.length);
    });
  });

  it('10. Tasting Note API失敗でもWine Detail本体（title等）は表示し続ける', async () => {
    fetchWineTastingNotesByWine.mockRejectedValue(new Error('network error'));
    render(<WineDetailScreen go={vi.fn()} entry={wine({ title: 'クラッシュしないワイン' })} />);

    expect(screen.getByText('クラッシュしないワイン')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('テイスティングノートを取得できませんでした')).toBeInTheDocument());
  });

  it('11. 未ログイン（idToken無し）ならAPIを呼ばず、Tasting Notesセクション自体を表示しない', async () => {
    authOverride = { ...mockUseAuth(), idToken: null, authState: 'signedOut' };
    render(<WineDetailScreen go={vi.fn()} entry={wine()} />);

    expect(fetchWineTastingNotesByWine).not.toHaveBeenCalled();
    expect(screen.queryByText('テイスティングノート')).not.toBeInTheDocument();
  });

  it('12/13/14. private ownership: APIが返したitemsをそのまま表示し、wineId/createdByによるclient側再filterを行わない', async () => {
    // 別Wine宛て（wineId不一致）のitemが万一混ざっていても、componentはfilterせずそのまま描画する
    // （＝server側のcreated_by/wineId scoping契約を信頼し、clientで重複ロジックを持たない設計の確認）
    fetchWineTastingNotesByWine.mockResolvedValue([
      note({ id: 'n1', wineId: 'wine-1', memoText: '自分のNote' }),
      note({ id: 'n2', wineId: 'other-wine', memoText: '本来別Wine宛てのはずの値' }),
    ]);
    render(<WineDetailScreen go={vi.fn()} entry={wine({ id: 'wine-1' })} />);

    await waitFor(() => {
      expect(screen.getByText('自分のNote')).toBeInTheDocument();
      // clientがfilterしていれば消えるはずだが、Stage 1C-Bの設計上はserver結果をそのまま描画するため表示される
      expect(screen.getByText('本来別Wine宛てのはずの値')).toBeInTheDocument();
    });
  });

  it('15. 既存Wine Detail情報（title/producer/vintage/origin/variety/description）は回帰しない', async () => {
    fetchWineTastingNotesByWine.mockResolvedValue([]);
    render(
      <WineDetailScreen
        go={vi.fn()}
        entry={wine({
          title: 'テストワイン',
          producer: 'テスト生産者',
          vintage: 2020,
          origin: '北海道',
          variety: 'ピノ・ノワール',
          description: '既存メモ本文',
        })}
      />,
    );

    expect(screen.getByText('テストワイン')).toBeInTheDocument();
    expect(screen.getByText('🏭 テスト生産者')).toBeInTheDocument();
    expect(screen.getByText('2020')).toBeInTheDocument();
    expect(screen.getByText('📍 北海道')).toBeInTheDocument();
    expect(screen.getByText('ピノ・ノワール')).toBeInTheDocument();
    expect(screen.getByText('既存メモ本文')).toBeInTheDocument();
    expect(screen.getByText('✏️ 編集する')).toBeInTheDocument();
  });

  it('16. Tasting Noteカードは縦積み（既存sourceBox等と同じdesign言語のクラス）で描画される', async () => {
    fetchWineTastingNotesByWine.mockResolvedValue([note({ id: 'n1' }), note({ id: 'n2' })]);
    const { container } = render(<WineDetailScreen go={vi.fn()} entry={wine()} />);

    await waitFor(() => expect(container.querySelectorAll('[class*="tastingNoteCard"]')).toHaveLength(2));
  });

  it('17. photoUrlがあればカード内に<img>を描画する（Stage 1D-D-A）', async () => {
    fetchWineTastingNotesByWine.mockResolvedValue([
      note({ id: 'n1', photoUrl: 'https://icarus-api.example.workers.dev/assets/a1/image?variant=thumbnail&expires=1&signature=sig' }),
    ]);
    const { container } = render(<WineDetailScreen go={vi.fn()} entry={wine()} />);

    await waitFor(() => {
      const img = container.querySelector('[class*="tastingNotePhoto"]') as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img!.src).toBe('https://icarus-api.example.workers.dev/assets/a1/image?variant=thumbnail&expires=1&signature=sig');
    });
  });

  it('18. photoUrlがnullなら<img>を描画しない（プレースホルダーも出さない、既存レイアウトのまま）', async () => {
    fetchWineTastingNotesByWine.mockResolvedValue([note({ id: 'n1', photoUrl: null, memoText: '写真なしメモ' })]);
    const { container } = render(<WineDetailScreen go={vi.fn()} entry={wine()} />);

    await waitFor(() => expect(screen.getByText('写真なしメモ')).toBeInTheDocument());
    expect(container.querySelector('[class*="tastingNotePhoto"]')).toBeNull();
  });
});

describe('previewText', () => {
  it('maxLength以下ならそのまま返す', () => {
    expect(previewText('短いテキスト', 40)).toBe('短いテキスト');
  });

  it('maxLengthを超えたら切り詰めて…を付ける', () => {
    const long = 'あ'.repeat(50);
    const result = previewText(long, 10);
    expect(result).toBe(`${'あ'.repeat(10)}…`);
  });

  it('改行を空白へ畳んで1行化する', () => {
    expect(previewText('1行目\n2行目\n3行目', 100)).toBe('1行目 2行目 3行目');
  });
});
