import { isLensSupported, liquidGlass } from './glasswork/lens.js';

// React calls each ref's cleanup when its panel unmounts or the material changes.
export function attachGlassRim(element: HTMLElement | null) {
  if (!element || !isLensSupported()) return;
  const reduced = window.matchMedia('(prefers-reduced-transparency: reduce)');
  let lens: ReturnType<typeof liquidGlass> | undefined;
  function refresh() {
    lens?.destroy();
    lens = element && !reduced.matches ? liquidGlass(element, { rim: 22, dispersion: 0.09 }) : undefined;
  }
  refresh();
  reduced.addEventListener('change', refresh);
  return () => {
    reduced.removeEventListener('change', refresh);
    lens?.destroy();
  };
}
