export interface NeumorphismSettings {
  background: string;
  accent: string;
  radius: number;
  distance: number;
  intensity: number;
  blur: number;
  light: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  rootRelief: 'inset' | 'raised';
}
export const defaultNeumorphism: NeumorphismSettings = {
  background: '#f3f3f8',
  accent: '#365c87',
  radius: 13,
  distance: 11,
  intensity: 0.22,
  blur: 11,
  light: 'top-left',
  rootRelief: 'inset',
};
export function isLightSurface(color: string): boolean {
  return (
    /^#[0-9a-f]{6}$/i.test(color) &&
    [1, 3, 5].every((i) => parseInt(color.slice(i, i + 2), 16) >= 180)
  );
}
