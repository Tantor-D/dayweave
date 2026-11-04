import { ancestors, taskPath, treeOrder } from '../domain/tree';
import type { Operation, Task } from '../domain/types';
import { filterDates, type TaskDateFilter } from './time';
export type TodoRange = Exclude<TaskDateFilter, 'all'>;
export interface TodoRow {
  task: Task;
  date?: string;
}
export function todoGroups(
  tasks: Task[],
  range: TodoRange,
  base: string,
  parents: boolean,
  completed: boolean,
  query = '',
) {
  const parentIds = new Set(tasks.map((t) => t.parentId));
  const dates = filterDates(range, base);
  const groups = dates.map((date) => ({ date, rows: [] as TodoRow[] }));
  const overdue: TodoRow[] = [],
    undated: TodoRow[] = [];
  for (const task of [...tasks].sort((a, b) => a.order - b.order)) {
    if (
      (!parents && parentIds.has(task.id)) ||
      (!completed && task.status === 'done') ||
      [task, ...ancestors(task, tasks)].some((t) => t.archivedAt) ||
      !taskPath(task, tasks).toLowerCase().includes(query.trim().toLowerCase())
    )
      continue;
    const assigned = [
      ...new Set(task.placements.flatMap((p) => (p.kind === 'day' ? [p.date] : []))),
    ];
    if (!assigned.length) undated.push({ task });
    for (const date of assigned) {
      const row = { task, date };
      if (date < base && task.status === 'todo') overdue.push(row);
      else groups.find((g) => g.date === date)?.rows.push(row);
    }
  }
  overdue.sort((a, b) => a.date!.localeCompare(b.date!));
  return { groups, overdue, undated };
}
/** Match first, then restore the complete ancestor chain within each date group. */
export function todoTreeRows(rows: TodoRow[], tasks: Task[]) {
  const hits = new Map<string, TodoRow[]>();
  const ids = new Set<string>();
  for (const row of rows) {
    hits.set(row.task.id, [...(hits.get(row.task.id) ?? []), row]);
    for (const task of [row.task, ...ancestors(row.task, tasks)]) ids.add(task.id);
  }
  const included = tasks.filter((task) => ids.has(task.id));
  return treeOrder(included).flatMap((task) => {
    const depth = ancestors(task, included).length;
    const matches = hits.get(task.id);
    return matches
      ? matches.map((row) => ({ ...row, depth, contextOnly: false }))
      : [{ task, date: undefined, depth, contextOnly: true }];
  });
}
export type TodoTreeRow = ReturnType<typeof todoTreeRows>[number];

export function moveTodoDate(task: Task, from: string | undefined, to: string): Operation[] {
  if (from === to) return [];
  const source = task.placements.filter((p) => p.kind === 'day' && p.date === from);
  const target = task.placements.filter((p) => p.kind === 'day' && p.date === to);
  if (from && !source.length) throw new Error('原分配日期已不存在，请刷新后重试。');
  const keep = target[0] ?? source[0];
  const remove = [...source, ...target].filter((p) => p.id !== keep?.id);
  const operations: Operation[] = remove.map((p) => ({
    type: 'placement.remove',
    taskId: task.id,
    id: p.id,
  }));
  if (!target.length)
    operations.push({
      type: 'placement.put',
      taskId: task.id,
      placement: { id: keep?.id ?? crypto.randomUUID(), kind: 'day', date: to },
    });
  return operations;
}
export function todoParentOptions(task: Task, tasks: Task[]) {
  return tasks.filter(
    (t) =>
      t.id !== task.id &&
      ![t, ...ancestors(t, tasks)].some((a) => a.id === task.id || a.archivedAt),
  );
}

/** A drag moves the subtree structurally, but only leaf day placements change dates. */
export function dropTodoSubtree(
  task: Task,
  tasks: Task[],
  sourceDates: string[],
  targetDate?: string,
  parentId?: string | null,
  fromUndated = false,
): Operation[] {
  if (parentId && !todoParentOptions(task, tasks).some((t) => t.id === parentId))
    throw new Error('不能将任务归属到自身、后代或已归档任务。');
  const operations: Operation[] = [];
  if (parentId !== undefined && parentId !== task.parentId)
    operations.push({ type: 'task.update', id: task.id, patch: { parentId } });
  if (!targetDate) return operations;
  const parents = new Set(tasks.map((t) => t.parentId));
  const leaves = tasks.filter(
    (t) =>
      !parents.has(t.id) && (t.id === task.id || ancestors(t, tasks).some((a) => a.id === task.id)),
  );
  for (const leaf of leaves) {
    const days = leaf.placements.filter((p) => p.kind === 'day');
    if (fromUndated && !days.length) {
      operations.push(...moveTodoDate(leaf, undefined, targetDate));
      continue;
    }
    const sources = days.filter((p) => sourceDates.includes(p.date) && p.date !== targetDate);
    if (!sources.length) continue;
    const targets = days.filter((p) => p.date === targetDate);
    const keep = targets[0] ?? sources[0];
    for (const p of [...sources, ...targets])
      if (p.id !== keep.id)
        operations.push({ type: 'placement.remove', taskId: leaf.id, id: p.id });
    if (!targets.length)
      operations.push({
        type: 'placement.put',
        taskId: leaf.id,
        placement: { ...keep, date: targetDate },
      });
  }
  return operations;
}
