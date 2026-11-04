import type { ThemeDefinition } from '../../themes';

export const definitions = {
  'claymorphism-light': {
    id: 'claymorphism-light',
    mode: 'light',
    label: '黏土拟态 Claymorphism',
    tokens: {
      '--font': '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "PingFang SC", sans-serif',
      '--radius': '28px',
      '--spacing': '16px',
      '--material-blur': '0px',
      '--bg': '#f4f1fb',
      '--surface': '#fffdfd',
      '--solid': '#fffdfd',
      '--card': '#ffffff',
      '--text': '#1f1235',
      '--muted': '#71627f',
      '--p0': '#ae3655',
      '--line': '#e8e0f0',
      '--accent': '#7250b5',
      '--on-accent': '#ffffff',
      '--accent-soft': '#eae0fc',
      '--input': '#faf7ff',
      '--glass-edge': '#ffffff',
      '--clay-primary': '#c4a7f2',
      '--clay-pink': '#f8d8e9',
      '--shadow':
        'inset 7px 7px 16px #ffffff, inset -7px -7px 16px #e9e1f2, 8px 12px 26px #70508d1c',
      '--clay-soft':
        'inset 3px 3px 6px #ffffffc9, inset -3px -3px 7px #8562ae20, 3px 5px 10px #70508d15',
      '--clay-button':
        'inset 3px 3px 6px #ffffffa6, inset -3px -3px 7px #8054b940, 3px 5px 9px #8054b922',
      '--clay-inset': 'inset 3px 3px 6px #70508d18, inset -3px -3px 6px #ffffff',
    },
  },
} satisfies Record<string, ThemeDefinition>;
