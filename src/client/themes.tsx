import { definitions as claymorphism } from './presentations/claymorphism/themes';
import { definitions as glass } from './presentations/glass/themes';
import { definitions as neobrutalism } from './presentations/neobrutalism/themes';
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
  id: 'glass-light' | 'glass-dark' | 'neobrutalism-light' | 'claymorphism-light';
  mode: 'light' | 'dark';
  label: string;
  tokens: Record<string, string>;
  CardAppearance?: ComponentType<CardAppearanceProps>;
}
function DefaultCard({ task, children }: CardAppearanceProps) {
  return (
    <span style={{ display: 'contents' }} data-task-status={task.status}>
      {children}
    </span>
  );
}
export const ThemeContext = createContext<ThemeDefinition['id']>('glass-light');
export function ThemeCard(props: CardAppearanceProps) {
  const id = useContext(ThemeContext);
  const Card = themes[id].CardAppearance ?? DefaultCard;
  return <Card {...props} />;
}
export const themes: Record<ThemeDefinition['id'], ThemeDefinition> = {
  ...glass,
  ...neobrutalism,
  ...claymorphism,
};
export const themeStyle = (id: ThemeDefinition['id']) => themes[id].tokens as CSSProperties;
