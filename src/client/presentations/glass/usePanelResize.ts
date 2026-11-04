import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
// This interaction belongs to the glass layout; other presentations need not support a divider.
export function usePanelResize(
  width: number,
  save: (patch: { panelWidth: number }) => Promise<boolean>,
) {
  const [panelWidth, setPanelWidth] = useState(width);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    setPanelWidth(width);
  }, [width]);
  useEffect(() => () => cleanup.current?.(), []);
  const resize = (event: ReactPointerEvent) => {
    event.preventDefault();
    cleanup.current?.();
    const initialX = event.clientX;
    let next = panelWidth;
    const move = (e: PointerEvent) => {
      next = Math.max(220, Math.min(480, panelWidth + e.clientX - initialX));
      setPanelWidth(next);
    };
    const clear = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
    };
    const end = () => {
      clear();
      void save({ panelWidth: next }).then((ok) => {
        if (!ok) setPanelWidth(width);
      });
    };
    const cancel = () => {
      clear();
      setPanelWidth(width);
    };
    cleanup.current = clear;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
    window.addEventListener('pointercancel', cancel, { once: true });
  };
  return { panelWidth, resize };
}
