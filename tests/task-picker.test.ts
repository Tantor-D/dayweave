import test from 'node:test';
import assert from 'node:assert/strict';
import { unfinishedTaskTree } from '../src/domain/tree.ts';
import type { Task } from '../src/domain/types.ts';
const task = (id: string, parentId: string | null = null, order = 0): Task => ({
  id,
  title: id,
  parentId,
  order,
  description: '',
  status: 'todo',
  tagIds: [],
  createdAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:00:00Z',
  completedAt: null,
  archivedAt: null,
  placements: [],
});
test('existing task picker orders parents before children, retains matching paths and excludes completed/archived branches', () => {
  const root = task('root'),
    child = task('child', 'root'),
    leaf = task('leaf', 'child');
  const other = task('other', null, 1),
    sibling = task('sibling', 'root', 1);
  const done = { ...task('done'), status: 'done' as const },
    archived = { ...task('archived'), archivedAt: '2026-11-04T00:00:00Z' };
  const tasks = [leaf, other, child, done, sibling, root, archived, task('hidden', 'archived')];
  assert.deepEqual(
    unfinishedTaskTree(tasks).map((t) => t.id),
    ['root', 'child', 'leaf', 'sibling', 'other'],
  );
  assert.deepEqual(
    unfinishedTaskTree(tasks, 'LEAF').map((t) => t.id),
    ['root', 'child', 'leaf'],
  );
  assert.deepEqual(unfinishedTaskTree(tasks, 'done'), []);
  assert.deepEqual(unfinishedTaskTree(tasks, 'hidden'), []);
  assert.deepEqual(
    unfinishedTaskTree(tasks, 'root').map((t) => t.id),
    ['root', 'child', 'leaf', 'sibling'],
  );
});
