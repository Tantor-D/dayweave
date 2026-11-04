import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/server/app.ts';
import { runCLI } from '../src/harness/cli.ts';
import type { Operation, Source, Target, Workspace } from '../src/domain/types.ts';

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'cli-workflow-'));
  const options = { dataDir: join(dir, 'data'), localDir: join(dir, 'local') };
  const { app, store } = await buildApp(options);
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const headers = {
    authorization: `Bearer ${(await readFile(join(options.localDir, 'harness-token'), 'utf8')).trim()}`,
  };
  const user = { 'x-workbench-token': (await app.inject('/api/session')).json().token };
  const post = (url: string, payload: unknown, auth = headers) =>
    app.inject({ method: 'POST', url, payload: payload as object, headers: auth });
  const preview = async (
    target: Target,
    operations: Operation[],
    source: Source = 'harness',
    dependsOn?: string[],
  ) => {
    const snap = await store.read(target);
    return store.preview(
      { target, baseHash: snap.hash, baseRevision: snap.revision, operations, dependsOn },
      source,
    );
  };
  const text = async (target: Target, content: string) => {
    const p = await preview(target, [{ type: 'text.write', content }], 'user');
    await store.submit(p.id, p.id, 'user');
  };
  return { app, store, dir, options, headers, user, post, preview, text };
}

test('CLI confirmation is scoped to harness proposals, durable, idempotent and ignores legacy secrets', async (t) => {
  const f = await fixture(t);
  const legacy = '{"approvalMode":"auto_accept","apiKey":"legacy-secret"}';
  await writeFile(join(f.options.localDir, 'secrets.json'), legacy);
  const p = await f.preview('workspace', [{ type: 'task.create', title: '确认后保存' }]);
  const pending = await f.post(`/api/proposals/${p.id}/submit`, { requestId: 'pending' });
  assert.equal(pending.json().status, 'pending_confirmation');
  assert.equal((await f.store.read('workspace')).revision, 0);
  // A corrupt old model file also cannot block business operations.
  await writeFile(join(f.options.localDir, 'secrets.json'), 'invalid-old-config');
  const saved = await f.post(`/api/proposals/${p.id}/confirm`, { requestId: 'confirmed' });
  assert.equal(saved.json().status, 'applied', saved.body);
  const retry = await f.post(`/api/proposals/${p.id}/confirm`, { requestId: 'confirmed' });
  assert.equal(retry.json().changeId, saved.json().changeId);
  assert.equal((await f.store.history()).length, 1);
  assert.equal((await f.store.history())[0].approval, 'cli_confirmation');
  assert.equal(
    await readFile(join(f.options.localDir, 'secrets.json'), 'utf8'),
    'invalid-old-config',
  );
  for (const source of ['user', 'web_ai', 'external'] as const) {
    const other = await f.preview('short-term', [{ type: 'text.write', content: source }], source);
    assert.equal(
      (await f.post(`/api/proposals/${other.id}/confirm`, { requestId: source })).statusCode,
      403,
    );
  }
  const detail = await f.app.inject({ url: `/api/proposals/${p.id}`, headers: f.headers });
  assert.equal(detail.json().status, 'applied');
  assert.equal(detail.json().after, saved.json().after);
  assert.equal(
    (await f.app.inject({ url: '/api/proposals/missing', headers: f.headers })).statusCode,
    404,
  );
});

test('CLI confirmation detects stale versions and rejects reused request IDs and rejected proposals', async (t) => {
  const f = await fixture(t);
  const stale = await f.preview('workspace', [{ type: 'task.create', title: '旧安排' }]);
  const current = await f.preview('workspace', [{ type: 'task.create', title: '新安排' }]);
  await f.store.submit(current.id, 'current', 'harness', true);
  assert.equal(
    (await f.post(`/api/proposals/${stale.id}/confirm`, { requestId: 'stale' })).json().status,
    'conflict',
  );
  assert.equal(((await f.store.read('workspace')).data as Workspace).tasks.length, 1);
  const fresh = await f.preview('short-term', [{ type: 'text.write', content: 'later' }]);
  assert.equal(
    (await f.post(`/api/proposals/${fresh.id}/confirm`, { requestId: 'current' })).statusCode,
    409,
  );
  await f.store.reject(fresh.id);
  assert.equal(
    (await f.post(`/api/proposals/${fresh.id}/confirm`, { requestId: 'reject' })).json().status,
    'rejected',
  );
  assert.equal((await f.store.read('short-term')).data, '');
});

test('dependent targets and partial failure preserve independent successful changes', async (t) => {
  const f = await fixture(t);
  const first = await f.preview('long-term', [{ type: 'text.write', content: '第一项' }]);
  const second = await f.preview(
    'short-term',
    [{ type: 'text.write', content: '第二项' }],
    'harness',
    [first.id],
  );
  const before = await f.store.submit(second.id, 'second', 'harness', true);
  assert.equal(before.status, 'pending_confirmation');
  assert.match(before.error!, /前置/);
  await f.store.submit(first.id, 'first', 'harness', true);
  await f.text('short-term', '其他修改');
  assert.equal((await f.store.submit(second.id, 'second', 'harness', true)).status, 'conflict');
  assert.equal((await f.store.read('long-term')).data, '第一项');
  assert.equal((await f.store.read('short-term')).data, '其他修改');
});

test('diary search supports Chinese literal matches, pagination, date scope and bounded snippets', async (t) => {
  const f = await fixture(t);
  await f.text('daily/2026-11-03', '# 昨天\n睡眠改善 ' + '正文'.repeat(300));
  await f.text('daily/2026-11-04', '# 今天\n睡眠不足');
  await f.text('notes/review', '# 复盘\n睡眠和 WORK');
  await f.text('long-term', '睡眠背景不应被搜索');
  const query = (payload: unknown) => f.post('/api/documents/query', payload);
  const first = (await query({ query: '睡眠', limit: 1 })).json();
  assert.equal(first.total, 3);
  assert.equal(first.items[0].target, 'daily/2026-11-04');
  assert.equal(first.nextOffset, 1);
  const second = (await query({ query: '睡眠', offset: first.nextOffset, limit: 1 })).json();
  assert.equal(second.items[0].target, 'daily/2026-11-03');
  assert.ok(second.items[0].snippet.length <= 242);
  const last = (await query({ query: '睡眠', offset: 2, limit: 1 })).json();
  assert.equal(last.nextOffset, null);
  assert.equal(last.items[0].target, 'notes/review');
  const dates = (await query({ query: '睡眠', startDate: '2026-11-04' })).json();
  assert.equal(dates.total, 1);
  assert.equal((await query({ query: 'work' })).json().total, 1);
  assert.equal((await query({ query: '不存在' })).json().total, 0);
  assert.equal((await query({})).json().items[0].snippet, undefined);
  for (const body of [
    { startDate: '2026-02-30' },
    { startDate: '2026-11-04', endDate: '2026-11-03' },
    { kind: 'notes', startDate: '2026-11-04' },
    { query: '' },
    { limit: 101 },
    { offset: -1 },
    { path: '../../secrets.json' },
    { kind: '../.history' },
  ]) {
    assert.equal((await query(body)).statusCode, 400, JSON.stringify(body));
  }
  await writeFile(join(f.options.dataDir, 'reflections/daily/2026-11-04.md'), '外部未采纳正文');
  const blocked = (await query({ query: '睡眠' })).json();
  assert.equal(blocked.total, 2);
  assert.equal(blocked.unavailableCount, 1);
  assert.doesNotMatch(JSON.stringify(blocked), /外部未采纳/);
});

test('removed model and chat APIs are unavailable to both identities', async (t) => {
  const f = await fixture(t);
  for (const headers of [f.headers, f.user]) {
    for (const [method, url] of [
      ['GET', '/api/settings'],
      ['PATCH', '/api/settings'],
      ['POST', '/api/chat'],
      ['POST', '/api/chat/cancel'],
    ] as const) {
      const result = await f.app.inject({ method, url, headers });
      assert.equal(result.statusCode, 404, result.body);
    }
  }
});

test('CLI validates confirmation and reports unavailable local services', async (t) => {
  const f = await fixture(t);
  const outputs: unknown[] = [];
  const io = { input: async () => '', output: (value: unknown) => outputs.push(value) };
  const env = { WORKBENCH_LOCAL_DIR: f.options.localDir, WORKBENCH_URL: 'http://127.0.0.1:1' };
  assert.equal(await runCLI(['confirm', 'id'], env, io), 1);
  assert.match(JSON.stringify(outputs.at(-1)), /requestId/);
  assert.equal(await runCLI(['search'], env, io), 1);
  assert.match(JSON.stringify(outputs.at(-1)), /query/);
  assert.equal(await runCLI(['proposal', '../secret'], env, io), 1);
  assert.equal(await runCLI(['read'], env, io), 1);
  assert.match(JSON.stringify(outputs.at(-1)), /SERVICE_UNAVAILABLE/);
});

test('reflection references cannot follow symbolic links into secrets or history', async (t) => {
  const f = await fixture(t);
  await f.text('notes/normal', 'normal');
  const secret = join(f.options.localDir, 'secrets.json');
  await writeFile(secret, 'PRIVATE_SECRET');
  await symlink(secret, join(f.options.dataDir, 'reflections/notes/leak.md'));
  const read = await f.app.inject({ url: '/api/documents?target=notes/leak', headers: f.headers });
  assert.equal(read.statusCode, 400);
  assert.doesNotMatch(read.body, /PRIVATE_SECRET/);
  const search = await f.post('/api/documents/query', { query: 'PRIVATE' });
  assert.equal(search.json().total, 0);
  assert.doesNotMatch(search.body, /PRIVATE_SECRET/);
});
