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
  '--font': '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif',
  '--radius': '24px',
  '--spacing': '16px',
  '--material-blur': '36px',
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
      '--bg': '#eceef2',
      '--surface': 'rgba(255,255,255,.52)',
      '--solid': '#f7f8fb',
      '--card': 'rgba(255,255,255,.85)',
      '--text': '#24252b',
      '--muted': '#696c78',
      '--line': 'rgba(55,60,78,.10)',
      '--accent': '#4167cd',
      '--on-accent': '#ffffff',
      '--accent-soft': 'rgba(74,112,217,.10)',
      '--shadow': '0 16px 48px -24px rgba(30,36,63,.22), inset 0 1px 0 rgba(255,255,255,.92)',
      '--input': 'rgba(255,255,255,.58)',
      '--glass-edge': 'rgba(255,255,255,.82)',
      '--ambient-one': '#d9d7ef',
      '--ambient-two': '#d5e7ef',
      '--ambient-three': '#f0e3df',
    },
  },
  'glass-dark': {
    id: 'glass-dark',
    mode: 'dark',
    CardAppearance: GlassCard,
    label: '夜色玻璃',
    tokens: {
      ...common,
      '--bg': '#16171d',
      '--surface': 'rgba(37,38,47,.65)',
      '--solid': '#24252e',
      '--card': 'rgba(65,67,82,.66)',
      '--text': '#f1f1f5',
      '--muted': '#a8a9b9',
      '--line': 'rgba(220,222,242,.10)',
      '--accent': '#aac0ff',
      '--on-accent': '#1d2b4c',
      '--accent-soft': 'rgba(152,178,255,.13)',
      '--shadow': '0 20px 60px -24px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08)',
      '--input': 'rgba(20,21,29,.36)',
      '--glass-edge': 'rgba(223,226,255,.12)',
      '--ambient-one': '#353046',
      '--ambient-two': '#203440',
      '--ambient-three': '#332c31',
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
