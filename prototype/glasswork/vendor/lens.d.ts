export function isLensSupported(): boolean;
export function liquidGlass(
  element: HTMLElement,
  options: {
    rim: number;
    edge: number;
    power: number;
    dispersion: number;
  },
): { destroy(): void };
