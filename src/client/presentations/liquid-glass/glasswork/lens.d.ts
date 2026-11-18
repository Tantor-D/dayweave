// Glasswork v1.1.0, the subset of the lens API used by the workbench.
export function isLensSupported(): boolean;
export function liquidGlass(element: HTMLElement, options: { rim: number; dispersion: number }): {
  destroy(): void;
};
