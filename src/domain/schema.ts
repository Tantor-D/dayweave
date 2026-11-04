import { validStatisticsDate } from './statistics.ts';
import { z } from 'zod';
import type { Target } from './types.ts';

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.iso.datetime({ offset: true });
const title = z.string().min(1).max(1000);
const archivedAt = instant.nullable();
export const targetSchema: z.ZodType<Target> = z.union([
  z.enum(['workspace', 'long-term', 'short-term']),
  z.string().regex(/^daily\/\d{4}-\d{2}-\d{2}$/),
  z.string().regex(/^notes\/[A-Za-z0-9_-]{1,120}$/),
]) as z.ZodType<Target>;
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
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  colorPriority: z.number().int().min(0).max(9999),
  order: z.number().finite(),
  archivedAt,
});
export const taskSchema = z.strictObject({
  id: idSchema,
  title,
  description: z.string().max(100000),
  status: z.enum(['todo', 'done']),
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
  schemaVersion: z.literal(3),
  revision: z.number().int().nonnegative(),
  timezone: z.literal('Asia/Shanghai'),
  tags: z.array(tagSchema),
  tasks: z.array(taskSchema),
});
export const operationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('tag.remove'), id: idSchema }),
  z.strictObject({
    type: z.literal('tag.create'),
    id: idSchema.optional(),
    name: tagNameSchema,
    color: tagSchema.shape.color.optional(),
    colorPriority: tagSchema.shape.colorPriority.optional(),
  }),
  z.strictObject({
    type: z.literal('tag.update'),
    id: idSchema,
    patch: tagSchema
      .pick({ name: true, color: true, colorPriority: true, order: true, archivedAt: true })
      .partial(),
  }),
  z.strictObject({
    type: z.literal('task.create'),
    id: idSchema.optional(),
    title,
    description: z.string().max(100000).optional(),
    parentId: idSchema.nullable().optional(),
    tagIds: z.array(idSchema).optional(),
  }),
  z.strictObject({
    type: z.literal('task.update'),
    id: idSchema,
    propagateTags: z.boolean().optional(),
    patch: taskSchema
      .pick({
        title: true,
        description: true,
        status: true,
        parentId: true,
        tagIds: true,
        order: true,
        archivedAt: true,
      })
      .partial(),
  }),
  z.strictObject({
    type: z.literal('placement.put'),
    taskId: idSchema,
    placement: placementSchema,
  }),
  z.strictObject({ type: z.literal('placement.remove'), taskId: idSchema, id: idSchema }),
  z.strictObject({ type: z.literal('text.write'), content: z.string().max(2000000) }),
]);
export const previewSchema = z.strictObject({
  target: targetSchema,
  baseHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  baseRevision: z.number().int().nonnegative().optional(),
  operations: z.array(operationSchema).min(1).max(500),
  summary: z.string().max(2000).optional(),
  dependsOn: z.array(idSchema).max(20).optional(),
});
const statisticsDateSchema = z.string().refine(validStatisticsDate, '日期无效');
export const statisticsPreferencesSchema = z
  .strictObject({
    range: z.enum(['last30', 'week', 'month', 'custom']),
    startDate: statisticsDateSchema.nullable(),
    endDate: statisticsDateSchema.nullable(),
    tagId: idSchema.nullable(),
    hiddenCharts: z.array(
      z.enum(['trend', 'duration', 'first', 'parallel', 'tags', 'selectedTag']),
    ),
  })
  .refine(
    (p) =>
      p.range !== 'custom' ||
      (p.startDate !== null && p.endDate !== null && p.startDate <= p.endDate),
    '请选择有效的起止日期',
  );
export const preferencesSchema = z.strictObject({
  statistics: statisticsPreferencesSchema,
  theme: z.enum(['glass-light', 'glass-dark', 'neobrutalism-light']),
  days: z.union([z.literal(1), z.literal(3), z.literal(7)]),
  orientation: z.enum(['vertical', 'horizontal']),
  panelWidth: z.number().min(200).max(700),
  hiddenTags: z.array(idSchema),
  hiddenTasks: z.array(idSchema),
  hiddenStatuses: z.array(z.enum(['todo', 'done'])),
  showArchived: z.boolean(),
  dayStart: z.number().int().min(0).max(1439),
  dayEnd: z.number().int().min(1).max(1440),
  inheritParentTags: z.boolean(),
});
export const jsonSchemas = {
  workspace: z.toJSONSchema(workspaceSchema, { target: 'draft-7' }),
  operation: z.toJSONSchema(operationSchema, { target: 'draft-7' }),
  preview: z.toJSONSchema(previewSchema, { target: 'draft-7' }),
};
