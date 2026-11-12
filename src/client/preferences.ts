import { defaultLiquidGlass } from '../domain/liquid-glass';
import { defaultNeumorphism } from '../domain/neumorphism';
import { api } from './api.ts';
import { defaultStatistics } from '../domain/statistics.ts';
import type { Preferences } from '../domain/types.ts';

// A dev server can serve the new client while its backend still returns pre-v0.4 preferences.
function normalizePreferences(value: Preferences): Preferences {
  return {
    ...value,
    liquidGlass: value.liquidGlass ?? { ...defaultLiquidGlass },
    showUntimed: value.showUntimed ?? false,
    neumorphism: { ...defaultNeumorphism, ...value.neumorphism },
    autoCompleteParents: value.autoCompleteParents ?? true,
    statistics: value.statistics ?? structuredClone(defaultStatistics),
  };
}
export const readPreferences = () => api<Preferences>('/preferences').then(normalizePreferences);
export const savePreferences = (patch: Partial<Preferences>) =>
  api<Preferences>('/preferences', patch, 'PATCH').then(normalizePreferences);
