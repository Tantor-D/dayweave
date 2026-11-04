import type { ThemeDefinition } from '../../themes';
const common = {
  '--font': '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif',
  '--radius': '24px',
  '--spacing': '16px',
  '--material-blur': '36px',
};
export const definitions = {
  'neobrutalism-light': {
    id: 'neobrutalism-light',
    mode: 'light',
    label: '新粗野主义',
    tokens: {
      ...common,
      '--bg': '#fff9ef',
      '--surface': '#fff9ef',
      '--solid': '#ffffff',
      '--card': '#ffffff',
      '--text': '#181818',
      '--muted': '#55504a',
      '--line': '#181818',
      '--accent': '#181818',
      '--on-accent': '#ffffff',
      '--accent-soft': '#ffe0f7',
      '--shadow': '5px 5px 0 #181818',
      '--input': '#ffffff',
      '--glass-edge': '#181818',
      '--radius': '4px',
      '--material-blur': '0px',
      '--ambient-one': '#fff9ef',
      '--ambient-two': '#fff9ef',
      '--ambient-three': '#fff9ef',
    },
  },
} satisfies Record<string, ThemeDefinition>;
