import { useCallback, useRef } from 'react';

// 通信結果が分からないまま同じ内容で保存し直す時に、同じ requestId を使うための小さな hook
// （共通化 Audit §1「通信が曖昧な再送」）。内容（key）が変わったら新しい requestId を発行する。
// 成功・競合で「送った内容」が確定したら clear() して、次の保存では新しい requestId にする。
// requestId を使わない API（Work Log の Correction のようにサーバーが別の方法で冪等性を持つもの）では使わなくてよい
export function usePendingRequestId(): { requestIdFor: (key: string) => string; clear: () => void } {
  const ref = useRef<{ key: string; requestId: string } | null>(null);
  const requestIdFor = useCallback((key: string) => {
    if (ref.current?.key !== key) ref.current = { key, requestId: crypto.randomUUID() };
    return ref.current.requestId;
  }, []);
  const clear = useCallback(() => {
    ref.current = null;
  }, []);
  return { requestIdFor, clear };
}
