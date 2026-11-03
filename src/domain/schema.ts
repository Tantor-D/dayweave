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
export const operationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('category.create'), id: idSchema.optional(), name: title }),
  z.strictObject({
    type: z.literal('category.update'),
    id: idSchema,
    patch: categorySchema.pick({ name: true, order: true, archivedAt: true }).partial(),
  }),
  z.strictObject({
    type: z.literal('project.create'),
    id: idSchema.optional(),
    title,
    categoryId: idSchema,
    description: z.string().max(100000).optional(),
  }),
  z.strictObject({
    type: z.literal('project.update'),
    id: idSchema,
    patch: projectSchema.omit({ id: true }).partial(),
  }),
  z.strictObject({
    type: z.literal('task.create'),
    id: idSchema.optional(),
    title,
    description: z.string().max(100000).optional(),
    categoryId: idSchema.nullable().optional(),
    projectId: idSchema.nullable().optional(),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  }),
  z.strictObject({
    type: z.literal('task.update'),
    id: idSchema,
    patch: taskSchema
      .pick({
        title: true,
        description: true,
        status: true,
        priority: true,
        categoryId: true,
        projectId: true,
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
export const preferencesSchema = z.strictObject({
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
export const settingsPatchSchema = z.strictObject({
  approvalMode: z.enum(['require_confirmation', 'auto_accept']).optional(),
  baseUrl: z.string().max(2000).optional(),
  model: z.string().max(500).optional(),
  apiKey: z.string().max(20000).optional(),
  toolSupport: z.enum(['auto', 'enabled', 'disabled']).optional(),
});
export const jsonSchemas = {
  workspace: z.toJSONSchema(workspaceSchema, { target: 'draft-7' }),
  operation: z.toJSONSchema(operationSchema, { target: 'draft-7' }),
  preview: z.toJSONSchema(previewSchema, { target: 'draft-7' }),
};
