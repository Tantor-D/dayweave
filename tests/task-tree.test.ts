import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyOperations, emptyWorkspace, validateWorkspace } from '../src/domain/operations.ts';
import { migrateWorkspace } from '../src/domain/migration.ts';
import { taskPath, treeOrder } from '../src/domain/tree.ts';
import { selectedRange, atMinute } from '../src/client/time.ts';
import { Store, serialize } from '../src/server/store.ts';
import type { Workspace } from '../src/domain/types.ts';

const now = '2026-11-03T01:00:00.000Z';
function legacy() {
  return {
    schemaVersion: 1,
    revision: 4,
    timezone: 'Asia/Shanghai',
    categories: [{ id: 'work', name: '工作/研发', order: 0, archivedAt: null }],
    projects: [
      {
        id: 'p',
        title: '大任务',
        description: '说明',
        categoryId: 'work',
        order: 0,
        archivedAt: null,
      },
    ],
    tasks: [
      {
        id: 'p',
        title: '同 ID 子任务',
        description: '保留原内容',
        status: 'done',
        priority: 'P1',
        projectId: 'p',
        categoryId: null,
        order: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        archivedAt: null,
        placements: [{ id: 'day', kind: 'day', date: '2026-11-03' }],
      },
    ],
  };
}
test('completion propagates down and up arbitrary task depth, reopening/new children reopen ancestors', () => {
  let w = applyOperations(
    emptyWorkspace(),
    [
      { type: 'task.create', id: 'a', title: 'A' },
      { type: 'task.create', id: 'b', title: 'B', parentId: 'a' },
      { type: 'task.create', id: 'c', title: 'C', parentId: 'b' },
      { type: 'task.create', id: 'd', title: 'D', parentId: 'a' },
    ],
    now,
  ).workspace;
  const completed = applyOperations(
    w,
    [{ type: 'task.update', id: 'a', patch: { status: 'done' } }],
    now,
  );
  assert.equal(completed.completionEvents.length, 4);
  assert.ok(completed.workspace.tasks.every((t) => t.status === 'done'));
  w = applyOperations(
    completed.workspace,
    [{ type: 'task.update', id: 'c', patch: { status: 'todo' } }],
    now,
  ).workspace;
  assert.deepEqual(
    w.tasks.map((t) => t.status),
    ['in_progress', 'in_progress', 'todo', 'done'],
  );
  const completedAgain = applyOperations(
    w,
    [{ type: 'task.update', id: 'c', patch: { status: 'done' } }],
    now,
  );
  assert.equal(completedAgain.completionEvents.length, 3);
  w = applyOperations(
    completedAgain.workspace,
    [{ type: 'task.create', id: 'e', title: 'E', parentId: 'b' }],
    now,
  ).workspace;
  assert.deepEqual(
    w.tasks.map((t) => t.status),
    ['in_progress', 'in_progress', 'done', 'done', 'todo'],
  );
  assert.equal(taskPath(w.tasks[4], w.tasks), 'A / B / E');
  assert.deepEqual(
    treeOrder(w.tasks).map((t) => t.id),
    ['a', 'b', 'c', 'e', 'd'],
  );
  assert.throws(
    () => applyOperations(w, [{ type: 'task.update', id: 'a', patch: { parentId: 'e' } }]),
    /后代/,
  );
  assert.throws(
    () =>
      validateWorkspace({
        ...w,
        tasks: w.tasks.map((t) => (t.id === 'a' ? { ...t, status: 'done', completedAt: now } : t)),
      }),
    /完成状态/,
  );
});
test('moving unfinished children reopens completed parents; tags are flat, unique and referenced', () => {
  let w = applyOperations(emptyWorkspace(), [
    { type: 'task.create', id: 'a', title: 'A' },
    { type: 'task.update', id: 'a', patch: { status: 'done' } },
    { type: 'task.create', id: 'b', title: 'B' },
    { type: 'task.update', id: 'b', patch: { parentId: 'a' } },
    { type: 'tag.create', id: 'custom', name: '工作' },
    { type: 'task.update', id: 'b', patch: { tagIds: ['P0', 'P4', 'custom'] } },
  ]).workspace;
  assert.equal(w.tasks[0].status, 'in_progress');
  assert.deepEqual(w.tasks[1].tagIds, ['P0', 'P4', 'custom']);
  for (const name of ['a/b', '/', '   ', '工作'])
    assert.throws(() => applyOperations(w, [{ type: 'tag.create', name }]));
  assert.throws(() =>
    applyOperations(w, [{ type: 'tag.update', id: 'custom', patch: { name: 'a/b' } }]),
  );
  assert.throws(() =>
    applyOperations(w, [{ type: 'task.update', id: 'b', patch: { tagIds: ['missing'] } }]),
  );
  assert.throws(() =>
    applyOperations(w, [{ type: 'task.update', id: 'b', patch: { tagIds: ['P0', 'P0'] } }]),
  );
  assert.throws(() => applyOperations(w, [{ type: 'project.create', title: 'old' } as never]));
});
test('legacy migration is deterministic, preserves placements, disambiguates IDs and normalizes label slashes', () => {
  const old = legacy();
  const w = migrateWorkspace(old);
  assert.deepEqual(w, migrateWorkspace(old));
  assert.equal(w.tasks[0].id, 'p');
  assert.notEqual(w.tasks[1].id, 'p');
  assert.equal(w.tasks[0].parentId, w.tasks[1].id);
  assert.equal(w.tasks[1].status, 'done');
  assert.deepEqual(w.tasks[0].placements, old.tasks[0].placements);
  assert.ok(w.tags.some((t) => t.name === '工作／研发'));
  assert.ok(w.tags.some((t) => t.name === 'P4'));
  assert.deepEqual(validateWorkspace(w), w);
  assert.equal('projects' in w, false);
  assert.equal('priority' in w.tasks[0], false);
  assert.throws(() =>
    migrateWorkspace({ ...old, tasks: [{ ...old.tasks[0], projectId: 'missing' }] }),
  );
});
test('startup backs up and commits migration, maps preferences, invalidates proposals, restores old history', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'focus-migrate-'));
  const options = { dataDir: join(root, 'data'), localDir: join(root, 'local') };
  await mkdir(options.dataDir);
  await mkdir(join(options.localDir, 'proposals'), { recursive: true });
  const raw = serialize(legacy());
  await writeFile(join(options.dataDir, 'workspace.json'), raw);
  await writeFile(
    join(options.localDir, 'proposals', 'old.json'),
    serialize({
      id: 'old',
      target: 'workspace',
      status: 'pending_confirmation',
      after: raw,
    }),
  );
  await writeFile(
    join(options.dataDir, 'preferences.json'),
    serialize({
      theme: 'glass-dark',
      days: 3,
      orientation: 'vertical',
      panelWidth: 300,
      hiddenCategories: ['work'],
      hiddenProjects: ['p'],
      hiddenTasks: [],
      hiddenStatuses: [],
      showArchived: false,
    }),
  );
  let store = await Store.open(options);
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  let snap = await store.read('workspace');
  const w = snap.data as Workspace;
  assert.equal(w.schemaVersion, 2);
  assert.equal(w.revision, 5);
  assert.equal(snap.readOnly, undefined);
  const history = await store.history('workspace');
  assert.equal(history.length, 1);
  assert.equal(history[0].before, raw);
  const backup = (await readdir(join(options.dataDir, '.history', 'changes'))).find((f) =>
    f.endsWith('.backup'),
  )!;
  assert.equal(await readFile(join(options.dataDir, '.history', 'changes', backup), 'utf8'), raw);
  const preferences = await store.getPreferences();
  assert.deepEqual(preferences.hiddenTasks, [w.tasks[1].id]);
  assert.deepEqual(preferences.hiddenTags, [w.tags.find((t) => t.name === '工作／研发')!.id]);
  const pending = JSON.parse(
    await readFile(join(options.localDir, 'proposals', 'old.json'), 'utf8'),
  );
  assert.equal(pending.status, 'conflict');
  const restored = await store.restore(history[0].id, 'before', snap.hash, 'user');
  assert.equal((await store.submit(restored.id, 'restore', 'user')).status, 'applied');
  await store.close();
  store = await Store.open(options);
  snap = await store.read('workspace');
  assert.equal((snap.data as Workspace).schemaVersion, 2);
  assert.equal((snap.data as Workspace).revision, 6);
  assert.equal(snap.readOnly, undefined);
});
test('migration interrupted after replacement recovers through the existing transaction journal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'focus-migrate-fail-'));
  const options = { dataDir: join(root, 'data'), localDir: join(root, 'local') };
  await mkdir(options.dataDir);
  await writeFile(join(options.dataDir, 'workspace.json'), serialize(legacy()));
  await assert.rejects(
    Store.open({
      ...options,
      failpoint: (point) => {
        if (point === 'after_replace') throw new Error('crash');
      },
    }),
  );
  const store = await Store.open(options);
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const snap = await store.read('workspace');
  assert.equal((snap.data as Workspace).schemaVersion, 2);
  assert.equal(snap.readOnly, undefined);
  assert.equal((await store.history())[0].status, 'committed');
});
test('range selection supports reverse, midnight boundaries and a minimum 15 minutes', () => {
  const a = atMinute('2026-11-03', 23 * 60),
    b = atMinute('2026-11-04', 60);
  assert.deepEqual(selectedRange(b, a, 'r'), { id: 'r', kind: 'timed', startAt: a, endAt: b });
  assert.equal(Date.parse(selectedRange(a, a, 'r').endAt) - Date.parse(a), 900000);
  assert.equal(
    selectedRange(atMinute('2026-11-03', 0), atMinute('2026-11-03', 1440), 'r').endAt,
    atMinute('2026-11-04', 0),
  );
});

test('migration leaves unadopted external legacy edits untouched', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'focus-migrate-external-'));
  const options = { dataDir: join(root, 'data'), localDir: join(root, 'local') };
  await mkdir(options.dataDir);
  await mkdir(options.localDir);
  const trusted = serialize(legacy());
  const outside = legacy();
  outside.tasks[0].title = '外部未采纳修改';
  const disk = serialize(outside);
  await writeFile(join(options.dataDir, 'workspace.json'), disk);
  await writeFile(
    join(options.localDir, 'known.json'),
    serialize({ dataDir: options.dataDir, targets: { workspace: trusted } }),
  );
  await writeFile(
    join(options.dataDir, 'preferences.json'),
    serialize({
      theme: 'glass-dark',
      days: 3,
      orientation: 'vertical',
      panelWidth: 300,
      hiddenCategories: ['work'],
      hiddenProjects: ['p'],
      hiddenTasks: [],
      hiddenStatuses: [],
      showArchived: false,
    }),
  );
  const store = await Store.open(options);
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const snap = await store.read('workspace');
  assert.ok(snap.external?.valid);
  assert.equal((snap.data as Workspace).tasks[0].title, '同 ID 子任务');
  assert.equal(await readFile(join(options.dataDir, 'workspace.json'), 'utf8'), disk);
  assert.equal((await store.history()).length, 0);
  const pref = await store.getPreferences();
  assert.deepEqual(pref.hiddenTasks, [(snap.data as Workspace).tasks[1].id]);
  assert.deepEqual(pref.hiddenTags, [
    (snap.data as Workspace).tags.find((t) => t.name === '工作／研发')!.id,
  ]);
});
