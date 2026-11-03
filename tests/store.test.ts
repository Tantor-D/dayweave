import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, serialize, type Failpoint } from '../src/server/store.ts';
import { applyOperations, emptyWorkspace, validateWorkspace } from '../src/domain/operations.ts';
import type { Operation, Source, Target, Workspace } from '../src/domain/types.ts';

async function fixture(t: TestContext, failpoint?: (point: Failpoint) => void, now?: () => Date) {
  const root = await mkdtemp(join(tmpdir(), 'focus-store-'));
  const options = { dataDir: join(root, 'data'), localDir: join(root, 'local'), failpoint, now };
  let store = await Store.open(options);
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    root,
    options,
    restart: async () => {
      await store.close();
      store = await Store.open(options);
      return store;
    },
  };
}
async function proposal(
  store: Store,
  operations: Operation[],
  source: Source = 'user',
  target: Target = 'workspace',
) {
  const read = await store.read(target);
  return store.preview(
    { target, operations, baseHash: read.hash, baseRevision: read.revision },
    source,
  );
}
async function apply(
  store: Store,
  operations: Operation[],
  source: Source = 'user',
  target: Target = 'workspace',
) {
  const p = await proposal(store, operations, source, target);
  const result = await store.submit(p.id, randomUUID(), source);
  assert.equal(result.status, 'applied', result.error ?? '');
  return result;
}

// Input and domain invariants are independent of transport and presentation.
test('domain: tree defaults, completion, reopening and reference validation', () => {
  const created = applyOperations(emptyWorkspace(), [
    { type: 'task.create', id: 'root', title: '根任务' },
    { type: 'task.create', id: 'child', title: '子任务', parentId: 'root' },
  ]).workspace;
  assert.deepEqual(created.tasks[1].tagIds, []);
  assert.equal(created.tasks[1].parentId, 'root');
  const done = applyOperations(created, [
    { type: 'task.update', id: 'child', patch: { status: 'done' } },
  ]);
  assert.equal(done.completionEvents.length, 2);
  assert.ok(done.workspace.tasks.every((t) => t.status === 'done' && t.completedAt));
  const reopened = applyOperations(done.workspace, [
    { type: 'task.update', id: 'child', patch: { status: 'todo' } },
  ]).workspace;
  assert.equal(reopened.tasks[0].status, 'in_progress');
  assert.equal(reopened.tasks[1].completedAt, null);
  for (const patch of [
    { parentId: 'missing' },
    { parentId: 'child' },
    { tagIds: ['missing'] },
    { title: '  ' },
  ])
    assert.throws(() => applyOperations(created, [{ type: 'task.update', id: 'root', patch }]));
  assert.throws(() => applyOperations(created, [{ type: 'tag.create', name: '工作/生活' }]));
});
test('domain: untimed deduplication, conversion, unrestricted overlap and UTC normalization', () => {
  let w = applyOperations(emptyWorkspace(), [
    { type: 'task.create', id: 't', title: 'T' },
  ]).workspace;
  w = applyOperations(w, [
    {
      type: 'placement.put',
      taskId: 't',
      placement: { id: 'day', kind: 'day', date: '2026-11-03' },
    },
    {
      type: 'placement.put',
      taskId: 't',
      placement: { id: 'duplicate', kind: 'day', date: '2026-11-03' },
    },
  ]).workspace;
  assert.equal(w.tasks[0].placements.length, 1);
  assert.equal(w.tasks[0].placements[0].id, 'day');
  w = applyOperations(
    w,
    Array.from({ length: 5 }, (_, i): Operation => ({
      type: 'placement.put',
      taskId: 't',
      placement: {
        id: `block${i}`,
        kind: 'timed',
        startAt: '2026-11-03T23:45:00+08:00',
        endAt: '2026-11-04T00:30:00+08:00',
      },
    })),
  ).workspace;
  assert.equal(w.tasks[0].placements.length, 6);
  assert.equal((w.tasks[0].placements[1] as any).startAt, '2026-11-03T15:45:00.000Z');
  w = applyOperations(w, [
    {
      type: 'placement.put',
      taskId: 't',
      placement: { id: 'block0', kind: 'day', date: '2026-11-03' },
    },
  ]).workspace;
  assert.equal(w.tasks[0].placements.length, 5);
  assert.ok(!w.tasks[0].placements.some((p) => p.id === 'block0'));
  assert.throws(() =>
    applyOperations(w, [
      {
        type: 'placement.put',
        taskId: 't',
        placement: { id: 'bad', kind: 'day', date: '2026-02-30' },
      },
    ]),
  );
  assert.throws(() =>
    applyOperations(w, [
      {
        type: 'placement.put',
        taskId: 't',
        placement: {
          id: 'bad',
          kind: 'timed',
          startAt: '2026-11-03T12:00:00Z',
          endAt: '2026-11-03T11:00:00Z',
        },
      },
    ]),
  );
});
test('empty initialization, persistence, revision, real history and request-id binding', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.store.read('workspace')).revision, 0);
  const p = await proposal(f.store, [{ type: 'task.create', id: 'persist', title: '持久任务' }]);
  const requestId = randomUUID();
  const applied = await f.store.submit(p.id, requestId, 'user');
  assert.equal(applied.status, 'applied');
  assert.equal((await f.store.submit(p.id, requestId, 'user')).changeId, applied.changeId);
  const p2 = await proposal(f.store, [{ type: 'task.create', title: '另一个任务' }]);
  await assert.rejects(f.store.submit(p2.id, requestId, 'user'), /requestId/);
  const changed = (await f.store.history())[0];
  assert.equal(changed.status, 'committed');
  assert.equal(JSON.parse(changed.before!).tasks.length, 0);
  assert.equal(JSON.parse(changed.after).tasks.length, 1);
  await f.restart();
  assert.equal((await f.store.read('workspace')).revision, 1);
  assert.equal(((await f.store.read('workspace')).data as Workspace).tasks[0].title, '持久任务');
  assert.equal((await f.store.submit(p.id, requestId, 'user')).changeId, applied.changeId);
});
test('approval: defaults, persistent pending proposals, latest policy and conflict', async (t) => {
  const f = await fixture(t);
  const p = await proposal(f.store, [{ type: 'task.create', title: 'AI' }], 'harness');
  assert.equal(
    (await f.store.submit(p.id, randomUUID(), 'harness')).status,
    'pending_confirmation',
  );
  assert.equal((await f.store.read('workspace')).revision, 0);
  await f.restart();
  assert.equal((await f.store.proposals())[0].status, 'pending_confirmation');
  await assert.rejects(f.store.submit(p.id, randomUUID(), 'harness', true), /网页用户/);
  await f.store.updateSettings({ approvalMode: 'auto_accept' });
  assert.equal((await f.store.read('workspace')).revision, 0);
  assert.equal((await f.store.submit(p.id, randomUUID(), 'harness')).status, 'applied');
  assert.equal((await f.store.history())[0].approval, 'auto_accept');
  const conflict = await proposal(f.store, [{ type: 'task.create', title: '旧提案' }], 'web_ai');
  await apply(f.store, [{ type: 'task.create', title: '新任务' }]);
  assert.equal((await f.store.submit(conflict.id, randomUUID(), 'user', true)).status, 'conflict');
  assert.equal(((await f.store.read('workspace')).data as Workspace).tasks.length, 2);
});
test('approval: switching to confirmation after preview and manual confirmation source', async (t) => {
  const f = await fixture(t);
  await f.store.updateSettings({ approvalMode: 'auto_accept' });
  const p = await proposal(f.store, [{ type: 'task.create', title: 'AI' }], 'web_ai');
  await f.store.updateSettings({ approvalMode: 'require_confirmation' });
  assert.equal((await f.store.submit(p.id, randomUUID(), 'web_ai')).status, 'pending_confirmation');
  assert.equal((await f.store.submit(p.id, randomUUID(), 'user')).status, 'pending_confirmation');
  assert.equal((await f.store.submit(p.id, randomUUID(), 'user', true)).status, 'applied');
  assert.equal((await f.store.history())[0].approval, 'web_confirmation');
});
test('conflicting revisions and external content hashes never overwrite data', async (t) => {
  const f = await fixture(t);
  const a = await proposal(f.store, [{ type: 'task.create', title: 'A' }]);
  const b = await proposal(f.store, [{ type: 'task.create', title: 'B' }]);
  await f.store.submit(a.id, randomUUID(), 'user');
  assert.equal((await f.store.submit(b.id, randomUUID(), 'user')).status, 'conflict');
  const snapshot = await f.store.read('workspace');
  await assert.rejects(
    f.store.preview(
      {
        target: 'workspace',
        baseHash: snapshot.hash,
        baseRevision: 0,
        operations: [{ type: 'task.create', title: 'C' }],
      },
      'user',
    ),
    /数据已变化/,
  );
  const p = await proposal(f.store, [{ type: 'task.create', title: 'Do not save' }]);
  const path = join(f.options.dataDir, 'workspace.json');
  const raw = await readFile(path, 'utf8');
  await writeFile(path, `${raw}\n`);
  assert.equal((await f.store.submit(p.id, randomUUID(), 'user')).status, 'conflict');
  assert.equal(await readFile(path, 'utf8'), `${raw}\n`);
});
test('external edit adoption and restoration require exact latest hash and validation', async (t) => {
  const f = await fixture(t);
  await apply(f.store, [{ type: 'task.create', id: 't', title: 'Original' }]);
  const path = join(f.options.dataDir, 'workspace.json');
  const changed = JSON.parse(await readFile(path, 'utf8'));
  changed.tasks[0].title = 'External';
  await writeFile(path, serialize(changed));
  const snapshot = await f.store.read('workspace');
  assert.equal((snapshot.data as Workspace).tasks[0].title, 'Original');
  assert.equal(snapshot.external?.valid, true);
  await assert.rejects(f.store.resolveExternal('workspace', 'adopt', 'incorrect'), /再次变化/);
  const adopted = await f.store.resolveExternal('workspace', 'adopt', snapshot.external!.hash);
  assert.equal((adopted.data as Workspace).tasks[0].title, 'External');
  assert.equal(adopted.revision, 2);
  assert.equal((await f.store.history())[0].source, 'external');
  await writeFile(path, '{ broken');
  const invalid = await f.store.read('workspace');
  assert.equal(invalid.external?.valid, false);
  await assert.rejects(f.store.resolveExternal('workspace', 'adopt', invalid.external!.hash));
  const restored = await f.store.resolveExternal('workspace', 'restore', invalid.external!.hash);
  assert.equal((restored.data as Workspace).tasks[0].title, 'External');
  assert.equal(restored.revision, 3);
  assert.equal(restored.external, undefined);
});
test('restore creates a new full workspace revision without synthetic completion events', async (t) => {
  const f = await fixture(t);
  await apply(f.store, [{ type: 'task.create', id: 't', title: 'T' }]);
  const done = await apply(f.store, [{ type: 'task.update', id: 't', patch: { status: 'done' } }]);
  await apply(f.store, [{ type: 'task.update', id: 't', patch: { status: 'todo' } }]);
  const current = await f.store.read('workspace');
  const restore = await f.store.restore(done.changeId!, 'after', current.hash, 'user');
  assert.match(restore.summary, /整个工作区/);
  assert.equal((await f.store.submit(restore.id, randomUUID(), 'user')).status, 'applied');
  assert.equal((await f.store.read('workspace')).revision, 4);
  const history = await f.store.history();
  assert.equal(history.length, 4);
  assert.equal(history[0].completionEvents.length, 0);
  assert.equal(history[2].completionEvents.length, 1);
});
test('Markdown hash conflicts, single-document history, recovery and blank before creation', async (t) => {
  const f = await fixture(t);
  const create = await apply(
    f.store,
    [{ type: 'text.write', content: '# 独立反思\n内容' }],
    'user',
    'notes/note',
  );
  const initial = await f.store.read('notes/note');
  await apply(f.store, [{ type: 'text.write', content: '新版' }], 'user', 'notes/note');
  await assert.rejects(
    f.store.preview(
      {
        target: 'notes/note',
        baseHash: initial.hash,
        operations: [{ type: 'text.write', content: '过期' }],
      },
      'user',
    ),
    /数据已变化/,
  );
  const current = await f.store.read('notes/note');
  const p = await f.store.restore(create.changeId!, 'before', current.hash, 'user');
  await f.store.submit(p.id, randomUUID(), 'user');
  assert.equal((await f.store.read('notes/note')).data, '');
  assert.equal((await f.store.history('notes/note')).length, 3);
  assert.equal((await f.store.read('workspace')).revision, 0);
  await f.restart();
  assert.equal((await f.store.read('notes/note')).data, '');
});
test('document targets, schema-version and unknown operation rejection', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.store.read('notes/../../secrets' as Target));
  await assert.rejects(f.store.read('daily/2026-02-30'));
  const read = await f.store.read('workspace');
  await assert.rejects(
    f.store.preview(
      {
        target: 'workspace',
        baseHash: read.hash,
        baseRevision: 0,
        operations: [{ type: 'settings.update', approvalMode: 'auto_accept' } as any],
      },
      'harness',
    ),
  );
  const invalid = { ...emptyWorkspace(), schemaVersion: 9 };
  assert.throws(() => validateWorkspace(invalid));
});
test('secrets are outside data, permission restricted, masked and preferences durable', async (t) => {
  const f = await fixture(t);
  await f.store.updateSettings({ apiKey: 'simulated-secret', model: 'mock' });
  assert.equal((await f.store.getSettings()).hasApiKey, true);
  assert.ok(!JSON.stringify(await f.store.getSettings()).includes('simulated-secret'));
  assert.equal((await stat(join(f.options.localDir, 'secrets.json'))).mode & 0o777, 0o600);
  await f.store.updatePreferences({ theme: 'glass-dark', hiddenTags: ['personal'], days: 7 });
  await f.restart();
  assert.equal((await f.store.getPreferences()).theme, 'glass-dark');
  assert.deepEqual((await f.store.getPreferences()).hiddenTags, ['personal']);
});
test('exclusive lock rejects second process instance and releases on close', async (t) => {
  const f = await fixture(t);
  await assert.rejects(Store.open(f.options), /已有运行中的服务/);
  await f.restart();
  assert.equal((await f.store.read('workspace')).revision, 0);
});
test('existing corrupt and unsupported workspace start read-only without overwriting', async (t) => {
  for (const raw of ['{broken', serialize({ ...emptyWorkspace(), schemaVersion: 9 })]) {
    const root = await mkdtemp(join(tmpdir(), 'focus-corrupt-'));
    const dataDir = join(root, 'data');
    await mkdir(dataDir);
    await writeFile(join(dataDir, 'workspace.json'), raw);
    const store = await Store.open({ dataDir, localDir: join(root, 'local') });
    t.after(async () => {
      await store.close();
      await rm(root, { recursive: true, force: true });
    });
    assert.ok((await store.read('workspace')).readOnly);
    assert.equal(await readFile(join(dataDir, 'workspace.json'), 'utf8'), raw);
    await assert.rejects(proposal(store, [{ type: 'task.create', title: 'Unsafe' }]));
  }
});
test('history preparation failure never writes target', async (t) => {
  const f = await fixture(t, (point) => {
    if (point === 'before_history') throw new Error('simulated disk full');
  });
  const p = await proposal(f.store, [{ type: 'task.create', title: 'Must not persist' }]);
  assert.equal((await f.store.submit(p.id, randomUUID(), 'user')).status, 'failed');
  assert.equal((await f.store.read('workspace')).revision, 0);
  assert.equal((await f.store.history()).length, 0);
});
test('failure before replace recovers as aborted; after replace recovers as committed', async (t) => {
  for (const phase of ['after_prepared', 'after_replace'] as const) {
    let enabled = true;
    const f = await fixture(t, (point) => {
      if (enabled && point === phase) throw new Error('simulated interruption');
    });
    const p = await proposal(f.store, [{ type: 'task.create', title: phase }]);
    const id = randomUUID();
    assert.equal((await f.store.submit(p.id, id, 'user')).status, 'failed');
    enabled = false;
    await f.restart();
    assert.equal(
      (await f.store.history())[0].status,
      phase === 'after_prepared' ? 'aborted' : 'committed',
    );
    assert.equal((await f.store.read('workspace')).revision, phase === 'after_prepared' ? 0 : 1);
    if (phase === 'after_replace') {
      assert.equal((await f.store.submit(p.id, id, 'user')).status, 'applied');
      assert.equal((await f.store.history()).length, 1);
    }
  }
});
test('unknown disk hash during startup recovery preserves content until explicit resolution', async (t) => {
  let enabled = true;
  const f = await fixture(t, (point) => {
    if (enabled && point === 'after_prepared') throw new Error('interrupt');
  });
  const p = await proposal(f.store, [{ type: 'task.create', title: 'Pending' }]);
  await f.store.submit(p.id, randomUUID(), 'user');
  await f.store.close();
  const disk = { ...emptyWorkspace(), revision: 10 };
  const raw = serialize(disk);
  await writeFile(join(f.options.dataDir, 'workspace.json'), raw);
  enabled = false;
  await f.restart();
  const read = await f.store.read('workspace');
  assert.ok(read.readOnly);
  assert.equal((await f.store.history())[0].status, 'uncertain');
  assert.equal(await readFile(join(f.options.dataDir, 'workspace.json'), 'utf8'), raw);
  const adopted = await f.store.resolveExternal('workspace', 'adopt', read.external!.hash);
  assert.equal(adopted.revision, 11);
  assert.equal(adopted.readOnly, undefined);
  await f.restart();
  assert.equal((await f.store.read('workspace')).readOnly, undefined);
});
test('text proposals follow AI policy and cross-document dependency waits for success', async (t) => {
  const f = await fixture(t);
  const first = await proposal(
    f.store,
    [{ type: 'text.write', content: 'long' }],
    'harness',
    'long-term',
  );
  const short = await f.store.read('short-term');
  const next = await f.store.preview(
    {
      target: 'short-term',
      baseHash: short.hash,
      operations: [{ type: 'text.write', content: 'short' }],
      dependsOn: [first.id],
    },
    'harness',
  );
  assert.equal(
    (await f.store.submit(next.id, randomUUID(), 'harness')).status,
    'pending_confirmation',
  );
  assert.equal((await f.store.read('short-term')).data, '');
  await f.store.submit(first.id, randomUUID(), 'user', true);
  await f.store.updateSettings({ approvalMode: 'auto_accept' });
  assert.equal((await f.store.submit(next.id, randomUUID(), 'harness')).status, 'applied');
  assert.equal((await f.store.history('short-term'))[0].approval, 'auto_accept');
});
test('serial writes apply only one of two proposals from same base', async (t) => {
  const f = await fixture(t);
  const first = await proposal(f.store, [{ type: 'task.create', title: 'First' }]);
  const second = await proposal(f.store, [{ type: 'task.create', title: 'Second' }]);
  const results = await Promise.all([
    f.store.submit(first.id, randomUUID(), 'user'),
    f.store.submit(second.id, randomUUID(), 'user'),
  ]);
  assert.deepEqual(results.map((p) => p.status).sort(), ['applied', 'conflict']);
  assert.equal((await f.store.history()).length, 1);
});
test('task tree and tag archives preserve placements and references', async (t) => {
  const f = await fixture(t);
  await apply(f.store, [
    { type: 'task.create', id: 'p', title: '父任务' },
    { type: 'task.create', id: 't', title: '子任务', parentId: 'p', tagIds: ['P1'] },
    {
      type: 'placement.put',
      taskId: 't',
      placement: { id: 'day', kind: 'day', date: '2026-11-03' },
    },
  ]);
  await apply(f.store, [
    { type: 'task.update', id: 'p', patch: { archivedAt: new Date().toISOString() } },
    { type: 'tag.update', id: 'P1', patch: { archivedAt: new Date().toISOString() } },
  ]);
  const w = (await f.store.read('workspace')).data as Workspace;
  assert.equal(w.tasks[1].placements.length, 1);
  assert.equal(w.tasks[1].parentId, 'p');
  assert.deepEqual(w.tasks[1].tagIds, ['P1']);
  assert.ok(w.tags.find((t) => t.id === 'P1')!.archivedAt);
});
test('external edits made while service is stopped are detected from last committed snapshot', async (t) => {
  const f = await fixture(t);
  await apply(f.store, [{ type: 'text.write', content: 'known background' }], 'user', 'long-term');
  await f.store.close();
  await writeFile(join(f.options.dataDir, 'ai', 'long-term.md'), 'outside change');
  await f.restart();
  const read = await f.store.read('long-term');
  assert.equal(read.data, 'known background');
  assert.equal(read.external?.content, 'outside change');
  assert.equal(read.external?.valid, true);
});
test('failed target replacement blocks later writes until recovery', async (t) => {
  let enabled = true;
  const f = await fixture(t, (point) => {
    if (enabled && point === 'before_replace') throw new Error('cannot replace');
  });
  const p = await proposal(f.store, [{ type: 'task.create', title: 'Fail' }]);
  assert.equal((await f.store.submit(p.id, randomUUID(), 'user')).status, 'failed');
  assert.ok((await f.store.read('workspace')).readOnly);
  await assert.rejects(
    proposal(f.store, [{ type: 'task.create', title: 'Block' }]),
    /保存结果待恢复/,
  );
  enabled = false;
  await f.restart();
  assert.equal((await f.store.history())[0].status, 'aborted');
  await apply(f.store, [{ type: 'task.create', title: 'After recovery' }]);
  await f.restart();
  assert.equal((await f.store.read('workspace')).readOnly, undefined);
});
test('corrupt history hash makes service read-only and preserves workspace', async (t) => {
  const f = await fixture(t);
  const result = await apply(f.store, [{ type: 'task.create', title: 'Kept' }]);
  const path = join(f.options.dataDir, 'workspace.json');
  const raw = await readFile(path, 'utf8');
  await f.store.close();
  const historyPath = join(f.options.dataDir, '.history', 'changes', `${result.changeId}.json`);
  const history = JSON.parse(await readFile(historyPath, 'utf8'));
  history.after = serialize(emptyWorkspace());
  await writeFile(historyPath, serialize(history));
  await f.restart();
  assert.ok((await f.store.read('workspace')).readOnly);
  assert.equal(await readFile(path, 'utf8'), raw);
  await assert.rejects(proposal(f.store, [{ type: 'task.create', title: 'Blocked' }]));
});
test('proposal rejection persists and cannot be silently applied later', async (t) => {
  const f = await fixture(t);
  const p = await proposal(
    f.store,
    [{ type: 'text.write', content: 'rejected' }],
    'harness',
    'short-term',
  );
  await f.store.submit(p.id, randomUUID(), 'harness');
  await f.store.reject(p.id);
  await f.restart();
  await f.store.updateSettings({ approvalMode: 'auto_accept' });
  assert.equal((await f.store.submit(p.id, randomUUID(), 'harness')).status, 'rejected');
  assert.equal((await f.store.read('short-term')).data, '');
  assert.equal((await f.store.history()).length, 0);
});
test('delayed confirmation uses real submission time for completion and system timestamps', async (t) => {
  let clock = new Date('2026-11-03T15:50:00Z');
  const f = await fixture(t, undefined, () => clock);
  await apply(f.store, [{ type: 'task.create', id: 't', title: 'Late completion' }]);
  const pending = await proposal(
    f.store,
    [{ type: 'task.update', id: 't', patch: { status: 'done' } }],
    'web_ai',
  );
  await f.store.submit(pending.id, randomUUID(), 'web_ai');
  assert.equal(JSON.parse(pending.after).tasks[0].completedAt, '2026-11-03T15:50:00.000Z');
  clock = new Date('2026-11-03T16:10:00Z');
  assert.equal((await f.store.submit(pending.id, randomUUID(), 'user', true)).status, 'applied');
  const task = ((await f.store.read('workspace')).data as Workspace).tasks[0];
  assert.equal(task.completedAt, '2026-11-03T16:10:00.000Z');
  assert.equal(task.updatedAt, task.completedAt);
  assert.equal((await f.store.history())[0].completionEvents[0].completedAt, task.completedAt);
  await f.restart();
  assert.equal(
    ((await f.store.read('workspace')).data as Workspace).tasks[0].completedAt,
    task.completedAt,
  );
});
test('request IDs also bind when acknowledging an already applied proposal', async (t) => {
  const f = await fixture(t);
  const first = await apply(f.store, [{ type: 'task.create', title: 'One' }]);
  const acknowledgementId = randomUUID();
  await f.store.submit(first.id, acknowledgementId, 'user');
  const second = await proposal(f.store, [{ type: 'task.create', title: 'Two' }]);
  await assert.rejects(f.store.submit(second.id, acknowledgementId, 'user'), /requestId/);
});
test('untrusted initial workspace cannot be restored to synthetic empty data, including after restart', async (t) => {
  for (const raw of ['{broken', serialize({ ...emptyWorkspace(), schemaVersion: 9 })]) {
    const root = await mkdtemp(join(tmpdir(), 'focus-untrusted-'));
    const dataDir = join(root, 'data');
    await mkdir(dataDir);
    await writeFile(join(dataDir, 'workspace.json'), raw);
    let store = await Store.open({ dataDir, localDir: join(root, 'local') });
    t.after(async () => {
      await store.close();
      await rm(root, { recursive: true, force: true });
    });
    let snapshot = await store.read('workspace');
    assert.equal(snapshot.hash, null);
    await assert.rejects(
      store.resolveExternal('workspace', 'restore', snapshot.external!.hash),
      /不能删除/,
    );
    await store.close();
    store = await Store.open({ dataDir, localDir: join(root, 'local') });
    snapshot = await store.read('workspace');
    assert.ok(snapshot.readOnly);
    assert.equal(snapshot.hash, null);
    await assert.rejects(
      store.resolveExternal('workspace', 'restore', snapshot.external!.hash),
      /不能删除/,
    );
    assert.equal(await readFile(join(dataDir, 'workspace.json'), 'utf8'), raw);
    const repaired = emptyWorkspace();
    await writeFile(join(dataDir, 'workspace.json'), serialize(repaired));
    const fixed = await store.read('workspace');
    const adopted = await store.resolveExternal('workspace', 'adopt', fixed.external!.hash);
    assert.equal(adopted.revision, 1);
    assert.equal(adopted.readOnly, undefined);
  }
});
test('event observer failures cannot turn a durable successful commit into failure', async (t) => {
  const f = await fixture(t);
  f.store.onChange = () => {
    throw new Error('observer disconnected');
  };
  const result = await apply(f.store, [{ type: 'task.create', title: 'Saved' }]);
  assert.equal(result.status, 'applied');
  assert.equal((await f.store.history())[0].status, 'committed');
});
test('model secrets directory cannot be placed under business data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'focus-secret-boundary-'));
  try {
    await assert.rejects(
      Store.open({ dataDir: root, localDir: join(root, 'local') }),
      /业务数据目录之外/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('read-only inspection does not overwrite damaged runtime snapshot files', async (t) => {
  const f = await fixture(t);
  await apply(f.store, [{ type: 'task.create', title: 'Kept' }]);
  await f.store.close();
  const path = join(f.options.localDir, 'known.json');
  await writeFile(path, '{ damaged snapshot');
  await f.restart();
  assert.ok((await f.store.read('workspace')).readOnly);
  await f.store.read('daily/2026-11-03');
  assert.equal(await readFile(path, 'utf8'), '{ damaged snapshot');
});
