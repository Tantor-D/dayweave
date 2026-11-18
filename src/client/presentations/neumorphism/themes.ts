import type { CSSProperties } from 'react';
import { defaultNeumorphism, type NeumorphismSettings } from '../../../domain/neumorphism';
import type { ThemeDefinition } from '../../themes';

interface BackgroundPreset {
  name: string;
  color: string;
  gradient?: string;
  wash?: string;
  animated?: boolean;
}

export const backgroundPresets: BackgroundPreset[] = [
  { name: '浅灰', color: '#e0e0e0' },
  { name: '暖白', color: '#ebe5dc' },
  { name: '灰蓝', color: '#dce4ec' },
  {
    name: '晨光暖白',
    color: '#f3f3f8',
    gradient:
      'radial-gradient(ellipse at 0% 20%, #deddf0 0%, transparent 65%), radial-gradient(ellipse at 100% 0%, #f0e3df 0%, transparent 58%), radial-gradient(ellipse at 90% 100%, #dfeef3 0%, transparent 65%), #eceef2',
    wash: 'linear-gradient(135deg, #efedf866, #fff5ef55 48%, #e8f5f955)',
  },
  { name: '冷白', color: '#f3f5f8' },
  { name: '鼠尾草', color: '#dbe6d5' },
  {
    name: '杏桃晚霞',
    color: '#f0dfda',
    gradient: 'linear-gradient(125deg, #f7e4c8, #edd5d1 52%, #d6cde4)',
    wash: 'linear-gradient(125deg, #fff0d780, #decfe455)',
  },
  {
    name: '山岚',
    color: '#dce9e5',
    gradient: 'linear-gradient(150deg, #d0dfca, #e1eee5 45%, #c2d9e4)',
    wash: 'linear-gradient(150deg, #d9e7cf70, #c7dfed66)',
  },
  {
    name: '流动极光',
    color: '#e2e2f0',
    gradient: 'linear-gradient(115deg, #c3e7df, #d3e4f4 32%, #d2caeb 62%, #eed6e3)',
    wash: 'linear-gradient(115deg, #c9eee566, #dad1ed66)',
    animated: true,
  },
];

export function neumorphismTokens(
  settings: NeumorphismSettings = defaultNeumorphism,
): Record<string, string> & CSSProperties {
  const { background, accent, radius, distance, intensity, blur, light } = settings;
  const preset = backgroundPresets.find(({ color }) => color === background.toLowerCase());
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
    '--neu-canvas': preset?.gradient ?? background,
    '--neu-wash': preset?.wash ?? 'none',
    '--neu-heading': preset?.gradient ? 'transparent' : background,
    '--neu-drift-duration': preset?.animated ? '22s' : '0s',
    '--neu-canvas-size': preset?.animated ? '200% 100%' : 'auto',
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
