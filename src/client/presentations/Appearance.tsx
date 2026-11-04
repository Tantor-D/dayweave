import { createContext, useContext } from 'react';
export interface Appearance {
  controls: Record<string, string>;
  statistics: Record<string, string>;
}
export const AppearanceContext = createContext<Appearance | null>(null);
export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('界面尚未装配');
  return value;
}
