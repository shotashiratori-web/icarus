import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import type { SheetSnap } from '../types/sheet';
import styles from './BottomSheet.module.css';

const SNAP_FRACTION: Record<SheetSnap, number> = {
  collapsed: 0.16,
  half: 0.5,
  full: 0.86,
};

const SNAP_ORDER: SheetSnap[] = ['collapsed', 'half', 'full'];

type Props = {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  peek: ReactNode;
  children: ReactNode;
  contentRef?: RefObject<HTMLDivElement | null>;
  onContentScroll?: () => void;
};

export default function BottomSheet({ snap, onSnapChange, peek, children, contentRef, onContentScroll }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ startY: number; startHeight: number; containerHeight: number; moved: boolean } | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const containerHeight = rootRef.current?.parentElement?.clientHeight ?? window.innerHeight;
    dragState.current = {
      startY: e.clientY,
      startHeight: SNAP_FRACTION[snap] * containerHeight,
      containerHeight,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const deltaY = drag.startY - e.clientY;
    if (Math.abs(deltaY) > 3) drag.moved = true;
    const min = drag.containerHeight * 0.1;
    const max = drag.containerHeight * 0.92;
    setDragHeight(Math.min(max, Math.max(min, drag.startHeight + deltaY)));
  };

  const onPointerUp = () => {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag) return;

    if (!drag.moved) {
      // ドラッグでなくタップだった場合は、次のスナップ位置へ順送りする（地図中心⇄一覧中心を1タップで切替）
      const nextIndex = (SNAP_ORDER.indexOf(snap) + 1) % SNAP_ORDER.length;
      setDragHeight(null);
      onSnapChange(SNAP_ORDER[nextIndex]);
      return;
    }

    const currentFraction = (dragHeight ?? drag.startHeight) / drag.containerHeight;
    let nearest: SheetSnap = 'collapsed';
    let nearestDist = Infinity;
    SNAP_ORDER.forEach((key) => {
      const dist = Math.abs(SNAP_FRACTION[key] - currentFraction);
      if (dist < nearestDist) { nearestDist = dist; nearest = key; }
    });
    setDragHeight(null);
    onSnapChange(nearest);
  };

  const style = dragHeight !== null
    ? { height: `${dragHeight}px`, transition: 'none' }
    : { height: `${SNAP_FRACTION[snap] * 100}%` };

  return (
    <div ref={rootRef} className={styles.sheet} style={style}>
      <div
        className={styles.handle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className={styles.handleBar} />
        {peek}
      </div>
      <div className={styles.content} ref={contentRef} onScroll={onContentScroll}>
        {children}
      </div>
    </div>
  );
}
