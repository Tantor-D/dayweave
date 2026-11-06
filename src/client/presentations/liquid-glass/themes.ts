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
      '--material-blur': '0px',
      '--bg': '#f4f4f5',
      '--surface': 'rgba(255,255,255,.12)',
      '--solid': '#fafafa',
      '--card': 'rgba(255,255,255,.46)',
      '--text': '#232326',
      '--muted': '#68686d',
      '--line': 'rgba(30,30,35,.09)',
      '--accent': '#0066d6',
      '--on-accent': '#ffffff',
      '--accent-soft': 'rgba(0,102,214,.07)',
      '--shadow':
        '0 12px 28px -18px rgba(20,20,25,.23), 0 2px 5px rgba(20,20,25,.035), inset 0 2px 1px rgba(255,255,255,1), inset 2px 0 2px rgba(255,255,255,.9), inset -1px -2px 2px rgba(40,40,45,.12), inset 0 -5px 5px -5px rgba(255,255,255,1)',
      '--input': 'rgba(255,255,255,.35)',
      '--glass-edge': 'rgba(255,255,255,.88)',
      '--ambient-one': '#ededee',
      '--ambient-two': '#f7f7f8',
      '--ambient-three': '#ffffff',
      '--liquid-material':
        'linear-gradient(165deg, rgba(255,255,255,.58) 0%, rgba(255,255,255,.08) 18%, rgba(255,255,255,.02) 78%, rgba(255,255,255,.38) 100%), var(--surface)',
    },
  },
} satisfies Record<string, ThemeDefinition>;
