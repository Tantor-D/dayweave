import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyOperations, emptyWorkspace, validateWorkspace } from '../src/domain/operations.ts';
import { taskColor } from '../src/domain/tags.ts';
import {
  filterDates,
  segmentsFor,
  placementInWindow,
  atMinute,
  windowMinute,
  parseClock,
} from '../src/client/time.ts';
import { Store, serialize } from '../src/server/store.ts';
import type { Workspace, Operation } from '../src/domain/types.ts';
const now = '2026-11-03T01:00:00.000Z';
const run = (w: Workspace, ops: Operation[], inherit = true) =>
  applyOperations(w, ops, now, { inheritParentTags: inherit }).workspace;

test('copy inheritance only on create and reparent; children never change parent tags', () => {
  let w = run(emptyWorkspace(), [
    { type: 'task.create', id: 'a', title: 'A', tagIds: ['P0'] },
    { type: 'task.create', id: 'b', title: 'B', tagIds: ['P1'] },
    { type: 'task.create', id: 'c', title: 'C', parentId: 'a', tagIds: ['P2'] },
  ]);
  assert.deepEqual(w.tasks[2].tagIds, ['P2', 'P0']);
  w = run(w, [{ type: 'task.update', id: 'c', patch: { tagIds: ['P3'] } }]);
  assert.deepEqual(w.tasks[0].tagIds, ['P0']);
  assert.deepEqual(w.tasks[2].tagIds, ['P3']);
  w = run(w, [{ type: 'task.update', id: 'c', patch: { parentId: 'b' } }]);
  assert.deepEqual(w.tasks[2].tagIds, ['P3', 'P1']);
  w = run(
    w,
    [
      { type: 'task.create', id: 'd', title: 'D', parentId: 'a' },
      { type: 'task.update', id: 'c', patch: { parentId: 'a' } },
    ],
    false,
  );
  assert.deepEqual(w.tasks[3].tagIds, []);
  assert.deepEqual(w.tasks[2].tagIds, ['P3', 'P1']);
});
test('explicit propagation merges current labels and removes only deleted labels through all descendants', () => {
  let w = run(emptyWorkspace(), [
    { type: 'task.create', id: 'a', title: 'A', tagIds: ['P0'] },
    { type: 'task.create', id: 'b', title: 'B', parentId: 'a', tagIds: ['P1'] },
    { type: 'task.create', id: 'c', title: 'C', parentId: 'b', tagIds: ['P2'] },
  ]);
  const initial = structuredClone(w);
  w = run(w, [{ type: 'task.update', id: 'a', patch: { tagIds: ['P3'] } }]);
  assert.deepEqual(w.tasks[1].tagIds, initial.tasks[1].tagIds);
  w = run(initial, [
    { type: 'task.update', id: 'a', patch: { tagIds: ['P3'] }, propagateTags: true },
  ]);
  assert.deepEqual(new Set(w.tasks[1].tagIds), new Set(['P1', 'P3']));
  assert.deepEqual(new Set(w.tasks[2].tagIds), new Set(['P1', 'P2', 'P3']));
  w = run(w, [{ type: 'task.update', id: 'a', patch: { tagIds: [] }, propagateTags: true }]);
  assert.deepEqual(new Set(w.tasks[2].tagIds), new Set(['P1', 'P2']));
});
test('tag color priority and validation are deterministic; task status rejects in_progress', () => {
  let w = run(emptyWorkspace(), [
    { type: 'tag.update', id: 'P0', patch: { color: '#ff0000', colorPriority: 10 } },
    { type: 'tag.update', id: 'P1', patch: { color: '#00ff00', colorPriority: 1 } },
    { type: 'task.create', id: 'a', title: 'A', tagIds: ['P0', 'P1'] },
  ]);
  assert.equal(taskColor(w.tasks[0], w.tags), '#00ff00');
  w = run(w, [{ type: 'tag.update', id: 'P1', patch: { archivedAt: now } }]);
  assert.equal(taskColor(w.tasks[0], w.tags), '#ff0000');
  assert.throws(() => run(w, [{ type: 'tag.update', id: 'P0', patch: { color: 'red' } }]));
  assert.throws(() => run(w, [{ type: 'tag.update', id: 'P0', patch: { colorPriority: -1 } }]));
  assert.throws(() =>
    run(w, [{ type: 'task.update', id: 'a', patch: { status: 'in_progress' as never } }]),
  );
});
test('daily windows clip display, keep original placements and map mouse coordinates consistently', () => {
  let w = run(emptyWorkspace(), [{ type: 'task.create', id: 'a', title: 'A' }]);
  w = run(w, [
    {
      type: 'placement.put',
      taskId: 'a',
      placement: {
        id: 'p',
        kind: 'timed',
        startAt: atMinute('2026-11-03', 420),
        endAt: atMinute('2026-11-03', 1140),
      },
    },
  ]);
  const original = structuredClone(w);
  const seg = segmentsFor(w.tasks, '2026-11-03', 480, 1080)[0];
  assert.equal(seg.start, 480);
  assert.equal(seg.end, 1080);
  assert.equal(seg.first, false);
  assert.equal(seg.last, false);
  assert.deepEqual(w, original);
  assert.equal(segmentsFor(w.tasks, '2026-11-03', 1200, 1440).length, 0);
  const p = placementInWindow('2026-11-03', 0.5, 480, 1080);
  assert.equal(p.kind, 'timed');
  if (p.kind === 'timed') assert.equal(p.startAt, atMinute('2026-11-03', 780));
  assert.equal(windowMinute(1, 480, 1080, true), 1080);
  assert.equal(windowMinute(1, 480, 1080), 1065);
  assert.equal(parseClock('24:00'), 1440);
  assert.ok(Number.isNaN(parseClock('24:01')));
});
test('date shortcuts include today and honor Monday-to-Sunday weeks at month boundary', () => {
  assert.deepEqual(filterDates('next3', '2026-11-30'), ['2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(filterDates('week', '2026-11-01'), [
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
  ]);
  assert.equal(filterDates('next7', '2026-11-03').length, 7);
  assert.deepEqual(filterDates('all', '2026-11-03'), []);
});
test('v2 startup migration backs up old colors/states; preferences persist and control server inheritance', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'focus-v3-test-'));
  const options = { dataDir: join(root, 'data'), localDir: join(root, 'local') };
  await mkdir(options.dataDir);
  const v3 = run(emptyWorkspace(), [{ type: 'task.create', id: 'a', title: 'A', tagIds: ['P0'] }]);
  const old = {
    ...v3,
    schemaVersion: 2,
    tags: v3.tags.map(({ color, colorPriority, ...tag }) => tag),
    tasks: v3.tasks.map((task) => ({ ...task, status: 'in_progress' })),
  };
  const raw = serialize(old);
  await writeFile(join(options.dataDir, 'workspace.json'), raw);
  await writeFile(
    join(options.dataDir, 'preferences.json'),
    serialize({
      theme: 'glass-light',
      days: 3,
      orientation: 'horizontal',
      panelWidth: 300,
      hiddenTags: [],
      hiddenTasks: [],
      hiddenStatuses: ['in_progress'],
      showArchived: false,
    }),
  );
  const store = await Store.open(options);
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const snap = await store.read('workspace');
  assert.equal((snap.data as Workspace).schemaVersion, 3);
  assert.equal((snap.data as Workspace).tasks[0].status, 'todo');
  assert.equal((await store.history())[0].before, raw);
  const pref = await store.getPreferences();
  assert.equal(pref.showUntimed, false);
  await store.updatePreferences({ showUntimed: true });
  assert.equal((await store.getPreferences()).showUntimed, true);
  assert.equal(JSON.parse(await readFile(join(options.dataDir, 'preferences.json'), 'utf8')).showUntimed, true);
  assert.equal(pref.dayStart, 0);
  assert.equal(pref.dayEnd, 1440);
  assert.equal(pref.inheritParentTags, true);
  assert.deepEqual(pref.hiddenStatuses, ['todo']);
  await assert.rejects(store.updatePreferences({ dayStart: 1100, dayEnd: 1000 }));
  await store.updatePreferences({ dayStart: 480, dayEnd: 1080, inheritParentTags: false });
  const proposal = await store.preview(
    {
      target: 'workspace',
      baseHash: snap.hash,
      baseRevision: snap.revision,
      operations: [{ type: 'task.create', id: 'b', title: 'B', parentId: 'a' }],
    },
    'user',
  );
  assert.deepEqual(JSON.parse(proposal.after).tasks[1].tagIds, []);
  assert.equal(
    JSON.parse(await readFile(join(options.dataDir, 'preferences.json'), 'utf8')).dayEnd,
    1080,
  );
  assert.deepEqual(validateWorkspace(old), { ...(snap.data as Workspace), revision: old.revision });
});

test('explicit propagation also handles labels gained by reparenting a subtree', () => {
  let w = run(emptyWorkspace(), [
    { type: 'task.create', id: 'a', title: 'A', tagIds: ['P0'] },
    { type: 'task.create', id: 'b', title: 'B' },
    { type: 'task.create', id: 'c', title: 'C', parentId: 'b', tagIds: ['P4'] },
  ]);
  w = run(w, [{ type: 'task.update', id: 'b', patch: { parentId: 'a' }, propagateTags: true }]);
  assert.deepEqual(w.tasks[1].tagIds, ['P0']);
  assert.deepEqual(new Set(w.tasks[2].tagIds), new Set(['P0', 'P4']));
});

test('removing a tag clears active and archived task references without removing tasks', () => {
  let w = run(emptyWorkspace(), [
    { type: 'task.create', id: 'root', title: 'Root', tagIds: ['P0', 'P1'] },
    { type: 'task.create', id: 'child', title: 'Child', parentId: 'root' },
    { type: 'task.update', id: 'child', patch: { archivedAt: now } },
  ]);
  w = run(w, [{ type: 'tag.remove', id: 'P0' }]);
  assert.equal(w.tasks.length, 2);
  assert.equal(
    w.tags.some((t) => t.id === 'P0'),
    false,
  );
  for (const t of w.tasks) assert.deepEqual(t.tagIds, ['P1']);
  validateWorkspace(w);
  assert.throws(() => run(w, [{ type: 'tag.remove', id: 'missing' }]));
});

test('moving unfinished task into completed branch reopens all ancestors', () => {
  let w = run(emptyWorkspace(), [
    { type: 'task.create', id: 'root', title: 'Root' },
    { type: 'task.create', id: 'parent', title: 'Parent', parentId: 'root' },
    { type: 'task.update', id: 'root', patch: { status: 'done' } },
    { type: 'task.create', id: 'moving', title: 'Moving' },
  ]);
  w = run(w, [{ type: 'task.update', id: 'moving', patch: { parentId: 'parent' } }]);
  for (const t of w.tasks) {
    assert.equal(t.status, 'todo');
    assert.equal(t.completedAt, null);
  }
});

test('promoting a branch to root preserves its tags, placements and descendants', () => {
  let w = run(emptyWorkspace(), [
    { type: 'task.create', id: 'root', title: 'Root' },
    { type: 'task.create', id: 'branch', title: 'Branch', parentId: 'root', tagIds: ['P1'] },
    { type: 'task.create', id: 'leaf', title: 'Leaf', parentId: 'branch' },
    {
      type: 'placement.put',
      taskId: 'branch',
      placement: { id: 'day', kind: 'day', date: '2026-11-03' },
    },
  ]);
  const branch = structuredClone(w.tasks.find((t) => t.id === 'branch')!);
  const leaf = structuredClone(w.tasks.find((t) => t.id === 'leaf')!);
  w = run(w, [{ type: 'task.update', id: 'branch', patch: { parentId: null, order: 10 } }]);
  const promoted = w.tasks.find((t) => t.id === 'branch')!;
  assert.equal(promoted.parentId, null);
  assert.deepEqual(promoted.tagIds, branch.tagIds);
  assert.deepEqual(promoted.placements, branch.placements);
  assert.deepEqual(
    w.tasks.find((t) => t.id === 'leaf'),
    leaf,
  );
});
