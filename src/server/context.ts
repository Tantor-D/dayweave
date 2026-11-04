import { ancestors } from '../domain/tree.ts';
import { z } from 'zod';
import { dateSchema, idSchema, targetSchema } from '../domain/schema.js';
import type { ContextData, ContextInput, Snapshot, Workspace } from '../domain/types.js';
import type { Store } from './store.js';

type ContextStore = Pick<Store, 'read'>;
export class ContextError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}

export const contextSchema = z.strictObject({
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  taskIds: z.array(idSchema).max(10000).optional(),
  reflections: z.array(targetSchema).max(30).optional(),
});
function localDate(instant: string): string {
  return new Date(new Date(instant).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function validDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(value.getTime()) &&
    value.toISOString().slice(0, 10) === date
  );
}
export async function buildContext(store: ContextStore, raw: ContextInput): Promise<ContextData> {
  const input = contextSchema.parse(raw) as ContextInput;
  for (const date of [input.startDate, input.endDate]) {
    if (date && !validDate(date)) throw new ContextError('VALIDATION', '上下文日期无效。');
  }
  if (input.startDate && input.endDate && input.startDate > input.endDate)
    throw new ContextError('VALIDATION', '开始日期不能晚于结束日期。');
  const references = [...new Set(input.reflections ?? [])];
  if (references.some((target) => !target.startsWith('daily/') && !target.startsWith('notes/'))) {
    throw new ContextError('VALIDATION', '反思范围只接受每日反思或独立反思的逻辑引用。');
  }
  const [longTerm, shortTerm, workspace, ...reflections] = await Promise.all([
    store.read('long-term'),
    store.read('short-term'),
    store.read('workspace'),
    ...references.map((target) => store.read(target)),
  ]);
  for (const snapshot of [longTerm, shortTerm, workspace, ...reflections]) {
    if (snapshot.readOnly || snapshot.external)
      throw new ContextError(
        'EXTERNAL_CHANGE',
        '上下文包含待处理的外部修改或损坏文件；请先在网页处理。',
        409,
      );
  }
  const full = workspace.data as Workspace;
  const requested = input.taskIds ? new Set(input.taskIds) : undefined;
  if (requested && [...requested].some((id) => !full.tasks.some((task) => task.id === id)))
    throw new ContextError('VALIDATION', '所选任务已不存在，请刷新上下文范围。');
  const tasks = full.tasks.filter((task) => {
    if (requested) return requested.has(task.id);
    if (task.archivedAt || ancestors(task, full.tasks).some((parent) => parent.archivedAt))
      return false;
    if (!input.startDate && !input.endDate) return true;
    return task.placements.some((placement) => {
      const start = placement.kind === 'day' ? placement.date : localDate(placement.startAt);
      const end =
        placement.kind === 'day'
          ? placement.date
          : localDate(new Date(new Date(placement.endAt).getTime() - 1).toISOString());
      return (
        (!input.endDate || start <= input.endDate) && (!input.startDate || end >= input.startDate)
      );
    });
  });
  return {
    longTerm: longTerm as Snapshot<string>,
    shortTerm: shortTerm as Snapshot<string>,
    workspace: { ...workspace, data: { ...full, tasks } } as Snapshot<Workspace>,
    reflections: reflections as Snapshot<string>[],
    scope: {
      taskIds: tasks.map((task) => task.id),
      startDate: input.startDate,
      endDate: input.endDate,
    },
  };
}
