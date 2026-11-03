import type { Tag, Task } from './types.ts';

export function defaultTagColor(name: string): string {
  const presets: Record<string, string> = {
    P0: '#c44750',
    P1: '#b86a2c',
    P2: '#537fc5',
    P3: '#5c8c78',
    P4: '#8965bb',
  };
  return presets[name] ?? '#537fc5';
}
export function taskColor(task: Task, tags: Tag[]): string | undefined {
  return tags
    .filter((t) => !t.archivedAt && task.tagIds.includes(t.id))
    .sort(
      (a, b) => a.colorPriority - b.colorPriority || a.order - b.order || a.id.localeCompare(b.id),
    )[0]?.color;
}
