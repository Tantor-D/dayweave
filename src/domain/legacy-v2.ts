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
export const tagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .regex(/^[^/]+$/, '标签不能包含 /');
export const tagSchema = z.strictObject({
  id: idSchema,
  name: tagNameSchema,
  order: z.number().finite(),
  archivedAt,
});
export const taskSchema = z.strictObject({
  id: idSchema,
  title,
  description: z.string().max(100000),
  status: z.enum(['todo', 'in_progress', 'done']),
  parentId: idSchema.nullable(),
  tagIds: z.array(idSchema),
  order: z.number().finite(),
  createdAt: instant,
  updatedAt: instant,
  completedAt: instant.nullable(),
  archivedAt,
  placements: z.array(placementSchema),
});
export const workspaceSchema = z.strictObject({
  schemaVersion: z.literal(2),
  revision: z.number().int().nonnegative(),
  timezone: z.literal('Asia/Shanghai'),
  tags: z.array(tagSchema),
  tasks: z.array(taskSchema),
});

export type WorkspaceV2 = z.infer<typeof workspaceSchema>;
type Workspace = WorkspaceV2;
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
export function validateV2(value: unknown): Workspace {
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
    if (children.length && (t.status === 'done') !== children.every((c) => c.status === 'done'))
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
