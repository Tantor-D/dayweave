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
    schemaVersion: 1,
    revision: 0,
    timezone: 'Asia/Shanghai',
    categories: [
      { id: 'work', name: '工作', order: 0, archivedAt: null },
      { id: 'personal', name: '个人', order: 1, archivedAt: null },
    ],
    projects: [],
    tasks: [],
  };
}
export function validateWorkspace(value: unknown): Workspace {
  const parsed = workspaceSchema.safeParse(value);
  if (!parsed.success)
    fail(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const w = parsed.data! as Workspace;
  for (const items of [w.categories, w.projects, w.tasks]) {
    if (new Set(items.map((i) => i.id)).size !== items.length) fail('集合中存在重复 ID');
  }
  const categories = new Map(w.categories.map((c) => [c.id, c]));
  const projects = new Map(w.projects.map((p) => [p.id, p]));
  for (const p of w.projects) {
    const c = categories.get(p.categoryId);
    if (!c) fail(`项目 ${p.id} 的分类不存在`);
    if (c!.archivedAt) fail('分类仍被项目使用，须先迁移归属才能归档');
    if (!p.title.trim()) fail('项目名称不能为空');
  }
  for (const c of w.categories) if (!c.name.trim()) fail('分类名称不能为空');
  const placementIds = new Set<string>();
  for (const t of w.tasks) {
    if (!t.title.trim()) fail('任务名称不能为空');
    if (t.projectId) {
      if (!projects.has(t.projectId)) fail(`任务 ${t.id} 的项目不存在`);
      if (t.categoryId !== null) fail('项目任务不能同时保存独立分类');
    } else {
      const c = categories.get(t.categoryId ?? '');
      if (!c) fail(`任务 ${t.id} 的分类不存在`);
      if (c!.archivedAt) fail('分类仍被独立任务使用，须先迁移归属才能归档');
    }
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
  for (const item of [...result.categories, ...result.projects])
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
): { workspace: Workspace; completionEvents: Change['completionEvents'] } {
  const w = structuredClone(before);
  const completionEvents: Change['completionEvents'] = [];
  const task = (id: string) => w.tasks.find((t) => t.id === id) ?? fail(`任务 ${id} 不存在`);
  for (const value of operations) {
    const result = operationSchema.safeParse(value);
    if (!result.success) fail(result.error.message);
    const op = result.data! as Operation;
    switch (op.type) {
      case 'category.create':
        w.categories.push({
          id: op.id ?? randomUUID(),
          name: op.name,
          order: w.categories.length,
          archivedAt: null,
        });
        break;
      case 'category.update':
        Object.assign(w.categories.find((c) => c.id === op.id) ?? fail('分类不存在'), op.patch);
        break;
      case 'project.create':
        w.projects.push({
          id: op.id ?? randomUUID(),
          title: op.title,
          categoryId: op.categoryId,
          description: op.description ?? '',
          order: w.projects.length,
          archivedAt: null,
        });
        break;
      case 'project.update':
        Object.assign(w.projects.find((p) => p.id === op.id) ?? fail('项目不存在'), op.patch);
        break;
      case 'task.create': {
        w.tasks.push({
          id: op.id ?? randomUUID(),
          title: op.title,
          description: op.description ?? '',
          status: 'todo',
          priority: op.priority ?? 'P2',
          projectId: op.projectId ?? null,
          categoryId: op.projectId
            ? null
            : (op.categoryId ??
              w.categories.find((c) => !c.archivedAt)?.id ??
              fail('请先创建分类')),
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
        const oldProject = t.projectId;
        Object.assign(t, op.patch);
        if (t.projectId) t.categoryId = null;
        else if (oldProject && op.patch.categoryId === undefined)
          t.categoryId = w.projects.find((p) => p.id === oldProject)?.categoryId ?? null;
        if (t.status !== previousStatus) {
          t.completedAt = t.status === 'done' ? now : null;
          if (t.status === 'done')
            completionEvents.push({ taskId: t.id, title: t.title, completedAt: now });
        }
        t.updatedAt = now;
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
  }
  return { workspace: normalizeWorkspace(validateWorkspace(w)), completionEvents };
}
export function completionChanges(before: Workspace, after: Workspace): Change['completionEvents'] {
  const old = new Map(before.tasks.map((t) => [t.id, t]));
  return after.tasks
    .filter((t) => t.status === 'done' && old.get(t.id)?.status !== 'done' && t.completedAt)
    .map((t) => ({ taskId: t.id, title: t.title, completedAt: t.completedAt! }));
}
