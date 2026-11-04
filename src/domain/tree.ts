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

/** Existing-task picker keeps the paths to search hits while excluding unavailable branches. */
export function unfinishedTaskTree(tasks: Task[], query = ''): Task[] {
  const available = tasks.filter((task) =>
    [task, ...ancestors(task, tasks)].every((item) => item.status !== 'done' && !item.archivedAt),
  );
  const search = query.trim().toLowerCase();
  if (!search) return treeOrder(available);
  const hits = available.filter((task) =>
    `${taskPath(task, tasks)} ${task.description}`.toLowerCase().includes(search),
  );
  const ids = new Set(
    hits.flatMap((task) => [task.id, ...ancestors(task, available).map((a) => a.id)]),
  );
  return treeOrder(available.filter((task) => ids.has(task.id)));
}
