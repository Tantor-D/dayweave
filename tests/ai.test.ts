import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.ts';
import { buildContext } from '../src/server/context.ts';
import type { Target, Workspace } from '../src/domain/types.ts';
import { runCLI } from '../src/harness/cli.ts';

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'focus-context-'));
  const store = await Store.open({ dataDir: join(dir, 'data'), localDir: join(dir, 'local') });
  t.after(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store };
}
async function textWrite(store: Store, target: Target, content: string) {
  const snapshot = await store.read(target);
  const proposal = await store.preview(
    { target, baseHash: snapshot.hash, operations: [{ type: 'text.write', content }] },
    'user',
  );
  const saved = await store.submit(proposal.id, `request_${proposal.id}`, 'user');
  assert.equal(saved.status, 'applied');
}

test('context selects local dates across midnight and respects an explicitly empty task scope', async (t) => {
  const { store } = await fixture(t);
  const base = await store.read('workspace');
  const tagIds = [(base.data as Workspace).tags[0].id];
  const p = await store.preview(
    {
      target: 'workspace',
      baseHash: base.hash,
      baseRevision: base.revision,
      operations: [
        { type: 'task.create', id: 'night', title: '跨午夜', tagIds },
        {
          type: 'placement.put',
          taskId: 'night',
          placement: {
            id: 'night-time',
            kind: 'timed',
            startAt: '2026-11-03T23:45:00+08:00',
            endAt: '2026-11-04T00:15:00+08:00',
          },
        },
        { type: 'task.create', id: 'later', title: '后天', tagIds },
        {
          type: 'placement.put',
          taskId: 'later',
          placement: { id: 'later-date', kind: 'day', date: '2026-11-05' },
        },
      ],
    },
    'user',
  );
  await store.submit(p.id, 'setup', 'user');
  const context = await buildContext(store, { startDate: '2026-11-04', endDate: '2026-11-04' });
  assert.deepEqual(context.scope.taskIds, ['night']);
  assert.deepEqual((await buildContext(store, { taskIds: [] })).workspace.data.tasks, []);
  await assert.rejects(buildContext(store, { reflections: ['long-term'] }), /反思范围/);
  await assert.rejects(buildContext(store, { startDate: '2026-02-30' }), /日期无效/);
});

test('CLI refuses a remote token destination and explains how to start when local credentials are absent', async () => {
  const values: unknown[] = [];
  const io = { input: async () => '', output: (value: unknown) => values.push(value) };
  assert.equal(await runCLI(['read', '--url', 'https://example.com'], {}, io), 1);
  assert.match(JSON.stringify(values.at(-1)), /只连接本机/);
  assert.equal(
    await runCLI(['read', '--local-dir', '/nonexistent-focus-workbench-cli-test'], {}, io),
    1,
  );
  assert.match(JSON.stringify(values.at(-1)), /npm start/);
  assert.equal(await runCLI(['--help'], {}, io), 0);
  assert.equal(typeof values.at(-1), 'object');
});

test('context reloads backgrounds, only attaches requested reflections and blocks external edits', async (t) => {
  const { store, dir } = await fixture(t);
  await textWrite(store, 'long-term', '长期第一版');
  await textWrite(store, 'short-term', '短期第一版');
  await textWrite(store, 'daily/2026-11-03', '日记正文');
  const first = await buildContext(store, { reflections: ['daily/2026-11-03'] });
  assert.equal(first.reflections[0].data, '日记正文');
  await textWrite(store, 'long-term', '长期第二版');
  const second = await buildContext(store, {});
  assert.equal(second.longTerm.data, '长期第二版');
  assert.equal(second.shortTerm.data, '短期第一版');
  assert.deepEqual(second.reflections, []);
  await writeFile(join(dir, 'data/ai/long-term.md'), '未采纳修改');
  await assert.rejects(buildContext(store, {}), /外部修改/);
});
