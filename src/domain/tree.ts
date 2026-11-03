import type { Task } from './types.ts';

export function ancestors(task: Task, tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const result: Task[] = [];
  const seen = new Set([task.id]);
  let id = task.parentId;
  while (id) {
    if (seen.has(id)) break;
    seen.add(id);
    const parent = byId.get(id);
    if (!parent) break;
    result.push(parent);
    id = parent.parentId;
  }
  return result;
}
export function taskPath(task: Task, tasks: Task[]): string {
  return [...ancestors(task, tasks).reverse(), task].map((t) => t.title).join(' / ');
}
export function treeOrder(tasks: Task[]): Task[] {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const parent = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), t]);
  }
  const result: Task[] = [];
  const pending = [...(children.get(null) ?? [])].sort((a, b) => b.order - a.order);
  while (pending.length) {
    const t = pending.pop()!;
    result.push(t);
    pending.push(...[...(children.get(t.id) ?? [])].sort((a, b) => b.order - a.order));
  }
  return result;
}
