export interface NeumorphismSettings {
  background: string;
  accent: string;
  radius: number;
  distance: number;
  intensity: number;
  blur: number;
  light: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}
export const defaultNeumorphism: NeumorphismSettings = {
  background: '#e0e0e0',
  accent: '#365c87',
  radius: 20,
  distance: 6,
  intensity: 0.15,
  blur: 18,
  light: 'top-left',
};
export function isLightSurface(color: string): boolean {
  return (
    /^#[0-9a-f]{6}$/i.test(color) &&
    [1, 3, 5].every((i) => parseInt(color.slice(i, i + 2), 16) >= 180)
  );
}
