import { definitions } from '../glass/themes';
import type { ThemeDefinition } from '../../themes';

export const jianxuTheme = {
  id: 'jianxu-light',
  mode: 'light',
  label: '间序',
  tokens: {
    ...definitions['glass-light'].tokens,
    '--bg': '#f6f8f9',
    '--surface': '#f9fbfc',
    '--solid': '#f9fbfc',
    '--card': '#ffffff',
    '--text': '#203343',
    '--muted': '#4a5e6b',
    '--accent': '#365b70',
    '--accent-soft': '#e6eff5',
    '--ambient-one': 'transparent',
    '--ambient-two': 'transparent',
    '--ambient-three': 'transparent',
  },
} satisfies ThemeDefinition;
