import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, emptyWorkspace } from '../src/domain/operations.ts';
import { moveTodoDate, todoGroups, todoParentOptions } from '../src/client/todo.ts';
import { filterDates } from '../src/client/time.ts';
const now = '2026-11-04T01:00:00Z';
function fixture() {
  return applyOperations(
    emptyWorkspace(),
    [
      { type: 'task.create', id: 'parent', title: 'Parent' },
      { type: 'task.create', id: 'child', title: 'Child', parentId: 'parent' },
      { type: 'task.create', id: 'timed', title: 'Timed only' },
      { type: 'task.create', id: 'done', title: 'Done' },
      { type: 'task.update', id: 'done', patch: { status: 'done' } },
      {
        type: 'placement.put',
        taskId: 'child',
        placement: { id: 'past', kind: 'day', date: '2026-11-03' },
      },
      {
        type: 'placement.put',
        taskId: 'child',
        placement: { id: 'today', kind: 'day', date: '2026-11-04' },
      },
      {
        type: 'placement.put',
        taskId: 'child',
        placement: { id: 'future', kind: 'day', date: '2026-11-05' },
      },
      {
        type: 'placement.put',
        taskId: 'child',
        placement: { id: 'bar', kind: 'timed', startAt: now, endAt: '2026-11-04T02:00:00Z' },
      },
      {
        type: 'placement.put',
        taskId: 'timed',
        placement: { id: 'bar2', kind: 'timed', startAt: now, endAt: '2026-11-04T02:00:00Z' },
      },
      {
        type: 'placement.put',
        taskId: 'done',
        placement: { id: 'doneDay', kind: 'day', date: '2026-11-04' },
      },
    ],
    now,
  ).workspace;
}
test('date rows use only own day placements; parents are flat and timed-only is undated', () => {
  const w = fixture();
  const a = todoGroups(w.tasks, 'week', '2026-11-04', false, false);
  assert.deepEqual(
    a.undated.map((r) => r.task.id),
    ['timed'],
  );
  assert.equal(a.overdue.length, 1);
  assert.equal(a.groups.find((g) => g.date === '2026-11-03')!.rows.length, 0);
  assert.equal(a.groups.find((g) => g.date === '2026-11-04')!.rows.length, 1);
  assert.equal(a.groups.find((g) => g.date === '2026-11-05')!.rows.length, 1);
  const b = todoGroups(w.tasks, 'today', '2026-11-04', true, true);
  assert.deepEqual(
    b.undated.map((r) => r.task.id),
    ['parent', 'timed'],
  );
  assert.deepEqual(
    b.groups[0].rows.map((r) => r.task.id),
    ['child', 'done'],
  );
});
test('move preserves placement identity, all other dates and timed bars; duplicate target merges', () => {
  const w = fixture(),
    child = w.tasks.find((t) => t.id === 'child')!;
  const moved = applyOperations(
    w,
    moveTodoDate(child, '2026-11-04', '2026-11-06'),
    now,
  ).workspace.tasks.find((t) => t.id === 'child')!;
  assert.deepEqual(
    moved.placements.find((p) => p.id === 'today'),
    { id: 'today', kind: 'day', date: '2026-11-06' },
  );
  assert.deepEqual(
    moved.placements.filter((p) => p.id !== 'today'),
    child.placements.filter((p) => p.id !== 'today'),
  );
  const merged = applyOperations(
    w,
    moveTodoDate(child, '2026-11-04', '2026-11-05'),
    now,
  ).workspace.tasks.find((t) => t.id === 'child')!;
  assert.deepEqual(
    merged.placements,
    child.placements.filter((p) => p.id !== 'today'),
  );
  assert.deepEqual(moveTodoDate(child, '2026-11-04', '2026-11-04'), []);
  assert.throws(() => moveTodoDate(child, '2026-11-09', '2026-11-10'));
});
test('assigning undated task retains timed arrangements', () => {
  const w = fixture(),
    task = w.tasks.find((t) => t.id === 'timed')!;
  const next = applyOperations(
    w,
    moveTodoDate(task, undefined, '2026-11-04'),
    now,
  ).workspace.tasks.find((t) => t.id === task.id)!;
  assert.deepEqual(
    next.placements.filter((p) => p.kind === 'timed'),
    task.placements,
  );
  assert.equal(next.placements.filter((p) => p.kind === 'day').length, 1);
});
test('range boundaries include today and Monday through Sunday', () => {
  assert.deepEqual(filterDates('next3', '2026-12-31'), ['2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(filterDates('next7', '2026-11-04').length, 7);
  assert.deepEqual(filterDates('week', '2026-11-01'), [
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
  ]);
});
test('parent choices exclude descendants and archived branches; reparent does not change dates', () => {
  const w = fixture(),
    parent = w.tasks.find((t) => t.id === 'parent')!,
    child = w.tasks.find((t) => t.id === 'child')!;
  assert.deepEqual(
    todoParentOptions(parent, w.tasks).map((t) => t.id),
    ['timed', 'done'],
  );
  const next = applyOperations(
    w,
    [{ type: 'task.update', id: 'child', patch: { parentId: 'timed' } }],
    now,
  ).workspace;
  assert.deepEqual(next.tasks.find((t) => t.id === 'child')!.placements, child.placements);
  assert.throws(() =>
    applyOperations(w, [{ type: 'task.update', id: 'parent', patch: { parentId: 'child' } }], now),
  );
  parent.archivedAt = now;
  assert.equal(todoGroups(w.tasks, 'today', '2026-11-04', true, false).groups[0].rows.length, 0);
});

test('parents with their own dates are ordinary dated rows, unrelated to child dates', () => {
  const w = fixture();
  const next = applyOperations(
    w,
    [
      {
        type: 'placement.put',
        taskId: 'parent',
        placement: { id: 'parentDay', kind: 'day', date: '2026-11-06' },
      },
    ],
    now,
  ).workspace;
  const groups = todoGroups(next.tasks, 'next3', '2026-11-04', true, false);
  assert.deepEqual(
    groups.groups[0].rows.map((r) => r.task.id),
    ['child'],
  );
  assert.deepEqual(
    groups.groups[2].rows.map((r) => r.task.id),
    ['parent'],
  );
  assert.equal(
    groups.undated.some((r) => r.task.id === 'parent'),
    false,
  );
});
