import type { CSSProperties } from 'react';
import { defaultNeumorphism, type NeumorphismSettings } from '../../../domain/neumorphism';
import type { ThemeDefinition } from '../../themes';

export function neumorphismTokens(
  settings: NeumorphismSettings = defaultNeumorphism,
): Record<string, string> & CSSProperties {
  const { background, accent, radius, distance, intensity, blur, light } = settings;
  const dawn = background.toLowerCase() === '#f3f3f8';
  const channels = (color: string) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const shade = (factor: number) =>
    '#' +
    channels(background)
      .map((c) =>
        Math.min(255, Math.round(c * factor))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  const x = light.endsWith('left') ? distance : -distance;
  const y = light.startsWith('top') ? distance : -distance;
  const dark = shade(1 - intensity),
    bright = shade(1 + intensity);
  const shadow = (scale: number, inset = '') =>
    `${inset}${x * scale}px ${y * scale}px ${blur * scale}px ${dark}, ${inset}${-x * scale}px ${-y * scale}px ${blur * scale}px ${bright}`;
  const luminance = channels(accent)
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((v, c, i) => v + c * [0.2126, 0.7152, 0.0722][i], 0);
  return {
    '--font': '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
    '--radius': `${radius}px`,
    '--spacing': '16px',
    '--material-blur': '0px',
    '--bg': background,
    '--neu-canvas': dawn
      ? 'radial-gradient(ellipse at 0% 20%, #deddf0 0%, transparent 65%), radial-gradient(ellipse at 100% 0%, #f0e3df 0%, transparent 58%), radial-gradient(ellipse at 90% 100%, #dfeef3 0%, transparent 65%), #eceef2'
      : background,
    '--neu-wash': dawn
      ? 'linear-gradient(135deg, #efedf866, #fff5ef55 48%, #e8f5f955)'
      : 'none',
    '--neu-heading': dawn ? 'transparent' : background,
    '--surface': background,
    '--solid': background,
    '--card': background,
    '--input': background,
    '--text': '#252b34',
    '--muted': '#505763',
    '--p0': '#a52742',
    '--line': shade(0.82),
    '--glass-edge': bright,
    '--accent': accent,
    '--on-accent': luminance > 0.179 ? '#000000' : '#ffffff',
    '--accent-soft': `color-mix(in srgb, ${accent} 12%, ${background})`,
    '--focus': luminance > 0.35 ? '#303944' : accent,
    '--shadow': shadow(1),
    '--neu-soft': shadow(0.4),
    '--neu-inset': shadow(0.45, 'inset '),
    '--neu-root-task': settings.rootRelief === 'raised' ? shadow(0.2) : shadow(0.45, 'inset '),
  };
}
export const definitions = {
  'neumorphism-light': {
    id: 'neumorphism-light',
    mode: 'light',
    label: '柔光拟态 Neumorphism',
    tokens: neumorphismTokens(),
  },
} satisfies Record<string, ThemeDefinition>;
