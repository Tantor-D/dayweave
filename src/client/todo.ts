import { ancestors, taskPath } from '../domain/tree';
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
