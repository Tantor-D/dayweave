import { defaultTagColor } from './tags.ts';
import { migrateWorkspace } from './migration.ts';
import { ancestors, treeOrder } from './tree.ts';
import { randomUUID } from 'node:crypto';
import { operationSchema, workspaceSchema } from './schema.ts';
import type { Change, Operation, Workspace } from './types.ts';

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
export const fail = (message: string): never => {
  throw new DomainError('VALIDATION_ERROR', message);
};
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  );
}
export function emptyWorkspace(): Workspace {
  return {
    schemaVersion: 3,
    revision: 0,
    timezone: 'Asia/Shanghai',
    tags: ['P0', 'P1', 'P2', 'P3', 'P4'].map((name, order) => ({
      id: name,
      name,
      color: defaultTagColor(name),
      colorPriority: order,
      order,
      archivedAt: null,
    })),
    tasks: [],
  };
}
export function validateWorkspace(value: unknown): Workspace {
  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    [1, 2].includes(Number(value.schemaVersion))
  )
    value = migrateWorkspace(value);
  const parsed = workspaceSchema.safeParse(value);
  if (!parsed.success)
    fail(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const w = parsed.data! as Workspace;
  for (const items of [w.tags, w.tasks]) {
    if (new Set(items.map((i) => i.id)).size !== items.length) fail('集合中存在重复 ID');
  }
  if (new Set(w.tags.map((t) => t.name)).size !== w.tags.length) fail('标签名称重复');
  validateTree(w);
  const tags = new Set(w.tags.map((t) => t.id));
  const placementIds = new Set<string>();
  for (const t of w.tasks) {
    if (!t.title.trim()) fail('任务名称不能为空');
    if (new Set(t.tagIds).size !== t.tagIds.length || t.tagIds.some((id) => !tags.has(id)))
      fail('任务标签重复或不存在');
    const children = w.tasks.filter((c) => c.parentId === t.id);
    if (t.status === 'done' && children.some((c) => c.status !== 'done'))
      fail('父子任务完成状态不一致');
    if ((t.status === 'done') !== (t.completedAt !== null)) fail('完成状态与完成时间不一致');
    const dates = new Set<string>();
    for (const p of t.placements) {
      if (placementIds.has(p.id)) fail(`排期 ID ${p.id} 重复`);
      placementIds.add(p.id);
      if (p.kind === 'day') {
        if (!validDate(p.date)) fail('排期日期不存在');
        if (dates.has(p.date)) fail('同一任务同一天只能有一个未定时安排');
        dates.add(p.date);
      } else if (Date.parse(p.endAt) <= Date.parse(p.startAt)) fail('结束时间必须晚于开始时间');
    }
  }
  return w;
}
export function normalizeWorkspace(w: Workspace): Workspace {
  const result = structuredClone(w);
  for (const item of result.tags)
    if (item.archivedAt) item.archivedAt = new Date(item.archivedAt).toISOString();
  for (const task of result.tasks) {
    task.createdAt = new Date(task.createdAt).toISOString();
    task.updatedAt = new Date(task.updatedAt).toISOString();
    if (task.completedAt) task.completedAt = new Date(task.completedAt).toISOString();
    if (task.archivedAt) task.archivedAt = new Date(task.archivedAt).toISOString();
    for (const p of task.placements)
      if (p.kind === 'timed') {
        p.startAt = new Date(p.startAt).toISOString();
        p.endAt = new Date(p.endAt).toISOString();
      }
  }
  return result;
}
export function applyOperations(
  before: Workspace,
  operations: Operation[],
  now = new Date().toISOString(),
  options: { inheritParentTags: boolean; autoCompleteParents?: boolean } = {
    inheritParentTags: true,
  },
): { workspace: Workspace; completionEvents: Change['completionEvents'] } {
  const w = structuredClone(before);
  const completionEvents: Change['completionEvents'] = [];
  const task = (id: string) => w.tasks.find((t) => t.id === id) ?? fail(`任务 ${id} 不存在`);
  for (const value of operations) {
    const result = operationSchema.safeParse(value);
    if (!result.success) fail(result.error.message);
    const op = result.data! as Operation;
    switch (op.type) {
      case 'tag.create':
        w.tags.push({
          id: op.id ?? randomUUID(),
          name: op.name,
          color: op.color ?? defaultTagColor(op.name),
          colorPriority: op.colorPriority ?? w.tags.length,
          order: w.tags.length,
          archivedAt: null,
        });
        break;
      case 'tag.remove': {
        if (!w.tags.some((t) => t.id === op.id)) fail('标签不存在');
        w.tags = w.tags.filter((t) => t.id !== op.id);
        for (const t of w.tasks) {
          if (t.tagIds.includes(op.id)) {
            t.tagIds = t.tagIds.filter((id) => id !== op.id);
            t.updatedAt = now;
          }
        }
        break;
      }
      case 'tag.update':
        Object.assign(w.tags.find((t) => t.id === op.id) ?? fail('标签不存在'), op.patch);
        break;
      case 'task.create': {
        w.tasks.push({
          id: op.id ?? randomUUID(),
          title: op.title,
          description: op.description ?? '',
          status: 'todo',
          parentId: op.parentId ?? null,
          tagIds: [
            ...new Set([
              ...(op.tagIds ?? []),
              ...(options.inheritParentTags && op.parentId ? task(op.parentId).tagIds : []),
            ]),
          ],
          order: w.tasks.length,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          archivedAt: null,
          placements: [],
        });
        break;
      }
      case 'task.update': {
        const t = task(op.id);
        const previousStatus = t.status;
        const previousTags = [...t.tagIds];
        const previousParent = t.parentId;
        Object.assign(t, op.patch);
        if (options.inheritParentTags && t.parentId && t.parentId !== previousParent)
          t.tagIds = [...new Set([...t.tagIds, ...task(t.parentId).tagIds])];
        if (previousStatus !== t.status) t.completedAt = t.status === 'done' ? now : null;
        t.updatedAt = now;
        validateTree(w);
        if (op.propagateTags && (op.patch.tagIds || t.parentId !== previousParent)) {
          const removed = previousTags.filter((id) => !t.tagIds.includes(id));
          for (const child of w.tasks)
            if (ancestors(child, w.tasks).some((a) => a.id === t.id)) {
              child.tagIds = [
                ...new Set([...child.tagIds.filter((id) => !removed.includes(id)), ...t.tagIds]),
              ];
              child.updatedAt = now;
            }
        }
        if (op.patch.status === 'done') {
          for (const child of w.tasks)
            if (ancestors(child, w.tasks).some((a) => a.id === t.id)) {
              if (child.status !== 'done') child.completedAt = now;
              child.status = 'done';
              child.updatedAt = now;
            }
        } else if (
          options.autoCompleteParents !== false &&
          op.patch.status &&
          w.tasks.some((child) => child.parentId === t.id) &&
          w.tasks
            .filter((child) => child.parentId === t.id)
            .every((child) => child.status === 'done')
        ) {
          fail('请先重新打开一个子任务，父任务会自动变为进行中');
        }
        break;
      }
      case 'placement.put': {
        const t = task(op.taskId);
        const p = structuredClone(op.placement);
        if (p.kind === 'timed') {
          p.startAt = new Date(p.startAt).toISOString();
          p.endAt = new Date(p.endAt).toISOString();
        }
        const duplicate =
          p.kind === 'day'
            ? t.placements.find((a) => a.kind === 'day' && a.date === p.date && a.id !== p.id)
            : undefined;
        if (duplicate) t.placements = t.placements.filter((a) => a.id !== p.id);
        else {
          const index = t.placements.findIndex((a) => a.id === p.id);
          if (index < 0) t.placements.push(p);
          else t.placements[index] = p;
        }
        t.updatedAt = now;
        break;
      }
      case 'placement.remove': {
        const t = task(op.taskId);
        if (!t.placements.some((p) => p.id === op.id)) fail('排期不存在');
        t.placements = t.placements.filter((p) => p.id !== op.id);
        t.updatedAt = now;
        break;
      }
      case 'text.write':
        fail('工作区提案不能包含文本操作');
    }
    validateTree(w);
    for (const parent of treeOrder(w.tasks).reverse()) {
      const children = w.tasks.filter((t) => t.parentId === parent.id);
      if (!children.length) continue;
      const done = children.every((t) => t.status === 'done');
      if (options.autoCompleteParents !== false && done && parent.status !== 'done') {
        parent.status = 'done';
        parent.completedAt = now;
        parent.updatedAt = now;
      } else if (!done && parent.status === 'done') {
        parent.status = 'todo';
        parent.completedAt = null;
        parent.updatedAt = now;
      }
    }
  }
  completionEvents.push(...completionChanges(before, w));
  return { workspace: normalizeWorkspace(validateWorkspace(w)), completionEvents };
}
export function completionChanges(before: Workspace, after: Workspace): Change['completionEvents'] {
  const old = new Map(before.tasks.map((t) => [t.id, t]));
  return after.tasks
    .filter((t) => t.status === 'done' && old.get(t.id)?.status !== 'done' && t.completedAt)
    .map((t) => ({ taskId: t.id, title: t.title, completedAt: t.completedAt! }));
}

function validateTree(w: Workspace): void {
  const tasks = new Map(w.tasks.map((t) => [t.id, t]));
  for (const t of w.tasks) {
    const seen = new Set([t.id]);
    let id = t.parentId;
    while (id) {
      if (seen.has(id)) fail('任务不能属于自己或自己的后代');
      seen.add(id);
      const parent = tasks.get(id);
      if (!parent) fail('父任务不存在');
      id = parent!.parentId;
    }
  }
}
