import { z } from 'zod';

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.iso.datetime({ offset: true });
const title = z.string().min(1).max(1000);
const archivedAt = instant.nullable();
export const placementSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: idSchema, kind: z.literal('day'), date: dateSchema }),
  z.strictObject({ id: idSchema, kind: z.literal('timed'), startAt: instant, endAt: instant }),
]);
export const categorySchema = z.strictObject({
  id: idSchema,
  name: title,
  order: z.number().finite(),
  archivedAt,
});
export const projectSchema = z.strictObject({
  id: idSchema,
  title,
  description: z.string().max(100000),
  categoryId: idSchema,
  order: z.number().finite(),
  archivedAt,
});
export const taskSchema = z.strictObject({
  id: idSchema,
  title,
  description: z.string().max(100000),
  status: z.enum(['todo', 'in_progress', 'done']),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  projectId: idSchema.nullable(),
  categoryId: idSchema.nullable(),
  order: z.number().finite(),
  createdAt: instant,
  updatedAt: instant,
  completedAt: instant.nullable(),
  archivedAt,
  placements: z.array(placementSchema),
});
export const workspaceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  timezone: z.literal('Asia/Shanghai'),
  categories: z.array(categorySchema),
  projects: z.array(projectSchema),
  tasks: z.array(taskSchema),
});

const fail = (message: string): never => {
  throw new Error(message);
};
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  );
}
export function validateLegacyWorkspace(value: unknown): z.infer<typeof workspaceSchema> {
  const parsed = workspaceSchema.safeParse(value);
  if (!parsed.success)
    fail(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const w = parsed.data! as z.infer<typeof workspaceSchema>;
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
export const legacyPreferencesSchema = z.strictObject({
  theme: z.enum(['glass-light', 'glass-dark']),
  days: z.union([z.literal(1), z.literal(3), z.literal(7)]),
  orientation: z.enum(['vertical', 'horizontal']),
  panelWidth: z.number().min(200).max(700),
  hiddenCategories: z.array(idSchema),
  hiddenProjects: z.array(idSchema),
  hiddenTasks: z.array(idSchema),
  hiddenStatuses: z.array(z.enum(['todo', 'in_progress', 'done'])),
  showArchived: z.boolean(),
});
