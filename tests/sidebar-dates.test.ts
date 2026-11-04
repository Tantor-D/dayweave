import test from 'node:test';
import assert from 'node:assert/strict';
import { dayTaskRows, isOverdueTask, matchesSidebarDate } from '../src/client/time.ts';
import type { Task, Placement } from '../src/domain/types.ts';
const task = (id: string, parentId: string | null = null, placements: Placement[] = []): Task => ({
  id,
  parentId,
  placements,
  title: id,
  description: '',
  tagIds: [],
  status: 'todo',
  order: 0,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  completedAt: null,
  archivedAt: null,
});
const day = (date: string): Placement => ({ id: date, kind: 'day', date });

test('sidebar overdue uses latest scheduled end and excludes completed or unscheduled tasks', () => {
  const base = '2026-11-04';
  const overdue = task('old', null, [day('2026-10-01')]);
  for (const filter of ['today', 'week', 'next3', 'next7'] as const)
    assert.equal(matchesSidebarDate(overdue, filter, base), true);
  assert.equal(isOverdueTask({ ...overdue, status: 'done' }, base), false);
  assert.equal(matchesSidebarDate({ ...overdue, status: 'done' }, 'today', base), false);
  assert.equal(isOverdueTask(task('none'), base), false);
  const rescheduled = task('later', null, [day('2026-10-01'), day('2026-11-20')]);
  assert.equal(isOverdueTask(rescheduled, base), false);
  assert.equal(matchesSidebarDate(rescheduled, 'next7', base), false);
  assert.equal(matchesSidebarDate(task('today', null, [day(base)]), 'today', base), true);
  const timed = (endAt: string) =>
    task('timed', null, [{ id: 'p', kind: 'timed', startAt: '2026-11-03T22:00:00+08:00', endAt }]);
  assert.equal(isOverdueTask(timed('2026-11-04T00:00:00+08:00'), base), true);
  assert.equal(isOverdueTask(timed('2026-11-04T01:00:00+08:00'), base), false);
});

test('day tree defaults to roots, expands one level at a time and keeps unarranged ancestors context-only', () => {
  const date = '2026-11-04';
  const root = task('root');
  const child = task('child', 'root');
  const leaf = task('leaf', 'child', [day(date)]);
  const other = task('other', null, [day('2026-11-05')]);
  const all = [root, child, leaf, other];
  const before = structuredClone(all);
  const collapsed = dayTaskRows([leaf, other], all, date, new Set());
  assert.deepEqual(
    collapsed.map((r) => r.task.id),
    ['root'],
  );
  assert.equal(collapsed[0].placement, undefined);
  assert.equal(collapsed[0].hasChildren, true);
  assert.deepEqual(
    dayTaskRows([leaf], all, date, new Set(['root'])).map((r) => r.task.id),
    ['root', 'child'],
  );
  const expanded = dayTaskRows([leaf], all, date, new Set(['root', 'child']));
  assert.deepEqual(
    expanded.map((r) => r.depth),
    [0, 1, 2],
  );
  assert.equal(expanded[2].placement?.kind, 'day');
  assert.deepEqual(dayTaskRows([], all, date, new Set(['root'])), []);
  assert.deepEqual(all, before);
});
