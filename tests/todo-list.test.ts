import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, emptyWorkspace } from '../src/domain/operations.ts';
import {
  dropTodoSubtree,
  moveTodoDate,
  todoGroups,
  todoParentOptions,
  todoTreeRows,
} from '../src/client/todo.ts';
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

test('tree overview restores every ancestor, shares branches and excludes unrelated siblings', () => {
  const w = applyOperations(
    fixture(),
    [
      { type: 'task.create', id: 'root', title: 'Root' },
      { type: 'task.update', id: 'parent', patch: { parentId: 'root' } },
      { type: 'task.create', id: 'sibling', title: 'Sibling', parentId: 'parent' },
    ],
    now,
  ).workspace;
  const hits = todoGroups(w.tasks, 'today', '2026-11-04', false, false, 'Child').groups[0].rows;
  const rows = todoTreeRows(hits, w.tasks);
  assert.deepEqual(
    rows.map((r) => [r.task.id, r.depth, r.contextOnly, r.date]),
    [
      ['root', 0, true, undefined],
      ['parent', 1, true, undefined],
      ['child', 2, false, '2026-11-04'],
    ],
  );
  const child = w.tasks.find((t) => t.id === 'child')!;
  const parent = w.tasks.find((t) => t.id === 'parent')!;
  const multi = todoTreeRows(
    [
      { task: child, date: '2026-11-02' },
      { task: child, date: '2026-11-03' },
      { task: parent, date: '2026-11-03' },
    ],
    w.tasks,
  );
  assert.deepEqual(
    multi.map((r) => r.task.id),
    ['root', 'parent', 'child', 'child'],
  );
  assert.equal(multi[1].contextOnly, false);
  assert.deepEqual(
    multi.filter((r) => r.task.id === 'child').map((r) => r.date),
    ['2026-11-02', '2026-11-03'],
  );
});

test('each date and undated group gets its own ancestor chain without synthetic dates', () => {
  const w = fixture();
  const groups = todoGroups(w.tasks, 'next3', '2026-11-04', false, false);
  for (const group of groups.groups.slice(0, 2)) {
    const rows = todoTreeRows(group.rows, w.tasks);
    assert.equal(rows[0].task.id, 'parent');
    assert.equal(rows[0].date, undefined);
    assert.equal(rows[0].contextOnly, true);
    assert.equal(rows[1].date, group.date);
  }
  const child = w.tasks.find((t) => t.id === 'child')!;
  child.placements = [];
  const undated = todoTreeRows(
    todoGroups(w.tasks, 'today', '2026-11-04', false, false).undated,
    w.tasks,
  );
  assert.equal(undated.find((r) => r.task.id === 'parent')!.contextOnly, true);
  assert.equal(undated.find((r) => r.task.id === 'child')!.contextOnly, false);
  assert.equal(undated.find((r) => r.task.id === 'child')!.depth, 1);
});

test('subtree cross-day drop changes only matching leaf dates and merges in one operation batch', () => {
  const w = applyOperations(
    fixture(),
    [
      {
        type: 'placement.put',
        taskId: 'parent',
        placement: { id: 'parentDay', kind: 'day', date: '2026-11-04' },
      },
      { type: 'task.create', id: 'grandchild', title: 'Grandchild', parentId: 'child' },
      {
        type: 'placement.put',
        taskId: 'grandchild',
        placement: { id: 'grandDay', kind: 'day', date: '2026-11-04' },
      },
      {
        type: 'placement.put',
        taskId: 'grandchild',
        placement: { id: 'grandFuture', kind: 'day', date: '2026-11-05' },
      },
      {
        type: 'placement.put',
        taskId: 'grandchild',
        placement: { id: 'grandOther', kind: 'day', date: '2026-11-08' },
      },
      {
        type: 'placement.put',
        taskId: 'grandchild',
        placement: { id: 'grandBar', kind: 'timed', startAt: now, endAt: '2026-11-04T03:00:00Z' },
      },
    ],
    now,
  ).workspace;
  const parent = w.tasks.find((t) => t.id === 'parent')!;
  const next = applyOperations(
    w,
    dropTodoSubtree(parent, w.tasks, ['2026-11-04'], '2026-11-05', 'timed'),
    now,
  ).workspace;
  assert.equal(next.tasks.find((t) => t.id === 'parent')!.parentId, 'timed');
  assert.equal(next.tasks.find((t) => t.id === 'child')!.parentId, 'parent');
  assert.equal(next.tasks.find((t) => t.id === 'grandchild')!.parentId, 'child');
  for (const id of ['parent', 'child', 'timed'])
    assert.deepEqual(
      next.tasks.find((t) => t.id === id)!.placements,
      w.tasks.find((t) => t.id === id)!.placements,
    );
  assert.deepEqual(
    next.tasks.find((t) => t.id === 'grandchild')!.placements,
    w.tasks.find((t) => t.id === 'grandchild')!.placements.filter((p) => p.id !== 'grandDay'),
  );
  assert.throws(() => dropTodoSubtree(parent, w.tasks, ['2026-11-04'], '2026-11-05', 'grandchild'));
});

test('context parent moves descendant leaf dates without assigning a date to itself; root keeps all dates', () => {
  const w = fixture(),
    parent = w.tasks.find((t) => t.id === 'parent')!;
  const next = applyOperations(
    w,
    dropTodoSubtree(parent, w.tasks, ['2026-11-03', '2026-11-04'], '2026-11-06'),
    now,
  ).workspace;
  assert.deepEqual(next.tasks.find((t) => t.id === 'parent')!.placements, []);
  const days = next.tasks
    .find((t) => t.id === 'child')!
    .placements.filter((p) => p.kind === 'day')
    .map((p) => p.date)
    .sort();
  assert.deepEqual(days, ['2026-11-05', '2026-11-06']);
  const child = w.tasks.find((t) => t.id === 'child')!;
  const rooted = applyOperations(
    w,
    dropTodoSubtree(child, w.tasks, ['2026-11-04'], undefined, null),
    now,
  ).workspace;
  assert.equal(rooted.tasks.find((t) => t.id === 'child')!.parentId, null);
  assert.deepEqual(rooted.tasks.find((t) => t.id === 'child')!.placements, child.placements);
  const undated = applyOperations(
    w,
    dropTodoSubtree(
      w.tasks.find((t) => t.id === 'timed')!,
      w.tasks,
      [],
      '2026-11-04',
      undefined,
      true,
    ),
    now,
  ).workspace;
  assert.equal(undated.tasks.find((t) => t.id === 'timed')!.placements.length, 2);
});
