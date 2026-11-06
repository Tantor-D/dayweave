import type { ThemeDefinition } from '../../themes';

export const definitions = {
  'liquid-glass-light': {
    id: 'liquid-glass-light',
    mode: 'light',
    label: '液态玻璃 Liquid Glass',
    tokens: {
      '--font': '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif',
      '--radius': '28px',
      '--spacing': '16px',
      '--material-blur': '28px',
      '--bg': '#e6edf7',
      '--surface': 'rgba(255,255,255,.48)',
      '--solid': '#f4f7fc',
      '--card': 'rgba(255,255,255,.78)',
      '--text': '#192c46',
      '--muted': '#50617a',
      '--line': 'rgba(48,77,115,.13)',
      '--accent': '#175ac4',
      '--on-accent': '#ffffff',
      '--accent-soft': 'rgba(35,107,222,.11)',
      '--shadow':
        '0 16px 42px -24px rgba(33,65,108,.38), 0 3px 10px rgba(47,78,119,.05), inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(255,255,255,.65)',
      '--input': 'rgba(255,255,255,.62)',
      '--glass-edge': 'rgba(255,255,255,.8)',
      '--ambient-one': '#afc9fa',
      '--ambient-two': '#a9ddd9',
      '--ambient-three': '#e7bede',
      '--liquid-material':
        'linear-gradient(145deg, rgba(255,255,255,.65), rgba(255,255,255,.18) 45%, rgba(255,255,255,.4)), var(--surface)',
    },
  },
} satisfies Record<string, ThemeDefinition>;
