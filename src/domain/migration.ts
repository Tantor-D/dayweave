import { createHash } from 'node:crypto';
import { validateLegacyWorkspace } from './legacy.ts';
import { validateV2, type WorkspaceV2 } from './legacy-v2.ts';
import type { Workspace } from './types.ts';
import { defaultTagColor } from './tags.ts';

export function migrateWorkspace(value: unknown): Workspace {
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 2)
    return upgradeV2(value);
  const old = validateLegacyWorkspace(value);
  const tags: WorkspaceV2['tags'] = [];
  const tag = (name: string, archivedAt: string | null = null) => {
    const cleaned = name.replaceAll('/', '／').trim();
    const existing = tags.find((t) => t.name === cleaned);
    if (existing) return existing.id;
    const id = 'tag_' + createHash('sha256').update(cleaned).digest('hex').slice(0, 24);
    tags.push({ id, name: cleaned, order: tags.length, archivedAt });
    return id;
  };
  for (const name of ['P0', 'P1', 'P2', 'P3', 'P4']) tag(name);
  const categories = new Map(old.categories.map((c) => [c.id, tag(c.name, c.archivedAt)]));
  const occupied = new Set(old.tasks.map((t) => t.id));
  const projectIds = new Map<string, string>();
  for (const p of old.projects) {
    let id = p.id;
    let n = 0;
    while (occupied.has(id))
      id =
        'root_' +
        createHash('sha256')
          .update(p.id + ':' + n++)
          .digest('hex')
          .slice(0, 24);
    occupied.add(id);
    projectIds.set(p.id, id);
  }
  const tasks: WorkspaceV2['tasks'] = old.tasks.map(
    ({ priority, projectId, categoryId, ...t }) => ({
      ...t,
      parentId: projectId ? projectIds.get(projectId)! : null,
      tagIds: [
        ...new Set([
          tag(priority),
          categories.get(
            projectId ? old.projects.find((p) => p.id === projectId)!.categoryId : categoryId!,
          )!,
        ]),
      ],
    }),
  );
  for (const p of old.projects) {
    const children = tasks.filter((t) => t.parentId === projectIds.get(p.id));
    const done = children.length > 0 && children.every((t) => t.status === 'done');
    const times = children.map((t) => t.createdAt).sort();
    const completedAt = done
      ? children
          .map((t) => t.completedAt!)
          .sort()
          .at(-1)!
      : null;
    tasks.push({
      id: projectIds.get(p.id)!,
      title: p.title,
      description: p.description,
      parentId: null,
      tagIds: [categories.get(p.categoryId)!],
      order: p.order,
      archivedAt: p.archivedAt,
      status: done ? 'done' : children.some((t) => t.status !== 'todo') ? 'in_progress' : 'todo',
      createdAt: times[0] ?? '1970-01-01T00:00:00.000Z',
      updatedAt:
        children
          .map((t) => t.updatedAt)
          .sort()
          .at(-1) ?? '1970-01-01T00:00:00.000Z',
      completedAt,
      placements: [],
    });
  }
  return upgradeV2({
    schemaVersion: 2,
    timezone: old.timezone,
    revision: old.revision,
    tags,
    tasks,
  });
}

function upgradeV2(value: unknown): Workspace {
  const old = validateV2(value);
  return {
    ...old,
    schemaVersion: 3,
    tags: old.tags.map((t, i) => ({ ...t, color: defaultTagColor(t.name), colorPriority: i })),
    tasks: old.tasks.map((t) => ({ ...t, status: t.status === 'done' ? 'done' : 'todo' })),
  };
}
