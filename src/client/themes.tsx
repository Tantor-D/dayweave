import {
  createContext,
  useContext,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Task } from '../domain/types';
export interface CardAppearanceProps {
  task: Task;
  children: ReactNode;
}
export interface ThemeDefinition {
  id: 'glass-light' | 'glass-dark';
  mode: 'light' | 'dark';
  label: string;
  tokens: Record<string, string>;
  CardAppearance?: ComponentType<CardAppearanceProps>;
}
function GlassCard({ task, children }: CardAppearanceProps) {
  return (
    <span style={{ display: 'contents' }} data-card-priority={task.priority}>
      {children}
    </span>
  );
}
export const ThemeContext = createContext<ThemeDefinition['id']>('glass-light');
export function ThemeCard(props: CardAppearanceProps) {
  const id = useContext(ThemeContext);
  const Card = themes[id].CardAppearance ?? GlassCard;
  return <Card {...props} />;
}
const common = {
  '--font':
    '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  '--radius': '18px',
  '--spacing': '16px',
  '--material-blur': '24px',
  '--p0': '#c44750',
  '--p1': '#b86a2c',
  '--p2': '#537fc5',
  '--p3': '#5c8c78',
};
export const themes: Record<ThemeDefinition['id'], ThemeDefinition> = {
  'glass-light': {
    id: 'glass-light',
    mode: 'light',
    CardAppearance: GlassCard,
    label: '晨光玻璃',
    tokens: {
      ...common,
      '--bg': '#e8edf2',
      '--surface': 'rgba(255,255,255,.76)',
      '--solid': '#f7f9fc',
      '--card': 'rgba(255,255,255,.87)',
      '--text': '#243349',
      '--muted': '#6d7b8d',
      '--line': 'rgba(99,120,151,.16)',
      '--accent': '#456b96',
      '--accent-soft': '#e1ebf6',
      '--shadow': '0 16px 50px rgba(38,60,86,.07)',
      '--input': 'rgba(255,255,255,.74)',
    },
  },
  'glass-dark': {
    id: 'glass-dark',
    mode: 'dark',
    CardAppearance: GlassCard,
    label: '夜色玻璃',
    tokens: {
      ...common,
      '--bg': '#101b2a',
      '--surface': 'rgba(26,40,58,.87)',
      '--solid': '#1d2d41',
      '--card': 'rgba(35,52,73,.94)',
      '--text': '#e5edf7',
      '--muted': '#a3b1c5',
      '--line': 'rgba(170,192,220,.16)',
      '--accent': '#9ebfe8',
      '--accent-soft': '#2c435f',
      '--shadow': '0 16px 50px rgba(0,0,0,.2)',
      '--input': 'rgba(12,24,40,.55)',
      '--p0': '#f58b92',
      '--p1': '#eeb879',
      '--p2': '#9abff6',
      '--p3': '#8ac5aa',
    },
  },
};
export const themeStyle = (id: ThemeDefinition['id']) => themes[id].tokens as CSSProperties;
export interface ViewLayoutProps {
  sidebar: ReactNode;
  board: ReactNode;
  detail?: ReactNode;
  divider?: ReactNode;
  panelWidth: number;
  className?: string;
}
export function ViewLayout({
  sidebar,
  board,
  detail,
  divider,
  panelWidth,
  className,
}: ViewLayoutProps) {
  return (
    <main className={className} style={{ '--panel-width': `${panelWidth}px` } as CSSProperties}>
      {sidebar}
      {divider}
      {board}
      {detail}
    </main>
  );
}
