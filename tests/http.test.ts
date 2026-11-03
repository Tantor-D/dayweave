import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { buildApp, type AppOptions } from '../src/server/app.ts';
import { Store } from '../src/server/store.ts';

async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  options: Partial<AppOptions> = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'focus-http-'));
  const server = await buildApp({
    dataDir: join(root, 'data'),
    localDir: join(root, 'local'),
    ...options,
  });
  t.after(async () => {
    await server.app.close();
    await rm(root, { recursive: true, force: true });
  });
  const session = await server.app.inject('/api/session');
  const headers = { 'x-workbench-token': session.json().token };
  const harness = {
    authorization: `Bearer ${(await readFile(join(root, 'local', 'harness-token'), 'utf8')).trim()}`,
  };
  return { ...server, root, headers, harness };
}

test('HTTP protects local origins, credentials and user-only settings', async (t) => {
  const { app, headers, harness } = await fixture(t);
  assert.equal((await app.inject('/api/workspace')).statusCode, 401);
  assert.equal(
    (await app.inject({ url: '/api/session', headers: { host: 'evil.example' } })).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: '/api/session', headers: { origin: 'https://evil.example' } }))
      .statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: '/api/session', headers: { 'sec-fetch-site': 'cross-site' } }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/settings',
        headers: harness,
        payload: { approvalMode: 'auto_accept' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/preferences',
        headers: harness,
        payload: { days: 7 },
      })
    ).statusCode,
    403,
  );
  const settings = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers,
    payload: {
      apiKey: 'test-key-not-returned',
      baseUrl: 'http://127.0.0.1:12345/v1',
      model: 'mock',
    },
  });
  assert.equal(settings.statusCode, 200, settings.body);
  assert.equal(settings.json().hasApiKey, true);
  assert.ok(!settings.body.includes('test-key-not-returned'));
  const malicious = await app.inject({
    method: 'POST',
    url: '/api/preview',
    headers: harness,
    payload: { target: 'workspace', baseHash: null, source: 'user', operations: [] },
  });
  assert.equal(malicious.statusCode, 400);
  assert.equal(
    (await app.inject({ url: '/api/documents?target=../../secret', headers })).statusCode,
    400,
  );
});

test('web manual edits, AI confirmation, policy changes and stale proposals share one workspace', async (t) => {
  const { app, headers, harness } = await fixture(t);
  const read = async () => (await app.inject({ url: '/api/workspace', headers })).json();
  const preview = async (auth: typeof headers | typeof harness, title: string) => {
    const snap = await read();
    const res = await app.inject({
      method: 'POST',
      url: '/api/preview',
      headers: auth,
      payload: {
        target: 'workspace',
        baseHash: snap.hash,
        baseRevision: snap.revision,
        operations: [{ type: 'task.create', title, categoryId: snap.data.categories[0].id }],
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json();
  };
  const proposal = await preview(harness, '工具任务');
  const pending = await app.inject({
    method: 'POST',
    url: `/api/proposals/${proposal.id}/submit`,
    headers: harness,
    payload: { requestId: 'tool-request' },
  });
  assert.equal(pending.json().status, 'pending_confirmation', pending.body);
  assert.equal((await read()).data.tasks.length, 0);
  const confirmed = await app.inject({
    method: 'POST',
    url: `/api/proposals/${proposal.id}/confirm`,
    headers,
    payload: { requestId: 'confirm-request' },
  });
  assert.equal(confirmed.json().status, 'applied', confirmed.body);
  assert.equal((await read()).data.tasks.length, 1);
  const stale = await preview(harness, '过期任务');
  const manual = await preview(headers, '手工任务');
  const applied = await app.inject({
    method: 'POST',
    url: `/api/proposals/${manual.id}/submit`,
    headers,
    payload: { requestId: 'manual-request' },
  });
  assert.equal(applied.json().status, 'applied', applied.body);
  const conflict = await app.inject({
    method: 'POST',
    url: `/api/proposals/${stale.id}/confirm`,
    headers,
    payload: { requestId: 'stale-confirm' },
  });
  assert.ok(conflict.statusCode === 409 || conflict.json().status === 'conflict', conflict.body);
  assert.deepEqual(
    (await read()).data.tasks.map((task: { title: string }) => task.title),
    ['工具任务', '手工任务'],
  );
  const automatic = await preview(harness, '自动任务');
  await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers,
    payload: { approvalMode: 'auto_accept' },
  });
  const result = await app.inject({
    method: 'POST',
    url: `/api/proposals/${automatic.id}/submit`,
    headers: harness,
    payload: { requestId: 'auto-request' },
  });
  assert.equal(result.json().status, 'applied', result.body);
  const repeat = await app.inject({
    method: 'POST',
    url: `/api/proposals/${automatic.id}/submit`,
    headers: harness,
    payload: { requestId: 'auto-request' },
  });
  assert.equal(repeat.json().changeId, result.json().changeId);
  const history = await app.inject({ url: '/api/history', headers });
  assert.equal(
    history.json().filter((c: { status: string }) => c.status === 'committed').length,
    3,
  );
  const schema = await app.inject({ url: '/api/schema', headers: harness });
  assert.equal(schema.statusCode, 200, schema.body);
  assert.ok(schema.json().workspace.properties);
});

test('review uses completion events even after reopening and restoration does not invent events', async (t) => {
  const { app, store, headers } = await fixture(t);
  let snap = await store.read('workspace');
  const initial = await store.preview(
    {
      target: 'workspace',
      baseHash: snap.hash,
      baseRevision: snap.revision,
      operations: [
        {
          type: 'task.create',
          id: 'review-task',
          title: 'Review',
          categoryId: (snap.data as { categories: { id: string }[] }).categories[0].id,
        },
      ],
    },
    'user',
  );
  await store.submit(initial.id, 'create', 'user');
  snap = await store.read('workspace');
  const done = await store.preview(
    {
      target: 'workspace',
      baseHash: snap.hash,
      baseRevision: snap.revision,
      operations: [{ type: 'task.update', id: 'review-task', patch: { status: 'done' } }],
    },
    'user',
  );
  const completed = await store.submit(done.id, 'done', 'user');
  snap = await store.read('workspace');
  const reopen = await store.preview(
    {
      target: 'workspace',
      baseHash: snap.hash,
      baseRevision: snap.revision,
      operations: [{ type: 'task.update', id: 'review-task', patch: { status: 'todo' } }],
    },
    'user',
  );
  await store.submit(reopen.id, 'reopen', 'user');
  snap = await store.read('workspace');
  const restoration = await store.restore(completed.changeId!, 'after', snap.hash, 'user');
  await store.submit(restoration.id, 'restore', 'user');
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const review = await app.inject({ url: `/api/review?date=${date}`, headers });
  assert.equal(review.statusCode, 200, review.body);
  assert.equal(review.json().completed.length, 1);
  assert.equal(review.json().planned.length, 0);
});

test('harness CLI uses the running service, parses stdin and returns a pending proposal', async (t) => {
  const { app, root, store } = await fixture(t);
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  async function cli(args: string[], input?: unknown) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolvePromise, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', resolve('src/harness/cli.ts'), ...args],
          {
            env: { ...process.env, WORKBENCH_URL: url, WORKBENCH_LOCAL_DIR: join(root, 'local') },
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        let stdout = '',
          stderr = '';
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
        child.stdin.end(input === undefined ? '' : JSON.stringify(input));
      },
    );
  }
  const read = await cli(['read', 'workspace']);
  assert.equal(read.code, 0, read.stderr);
  const snap = JSON.parse(read.stdout);
  const preview = await cli(['preview'], {
    target: 'workspace',
    baseHash: snap.hash,
    baseRevision: snap.revision,
    operations: [
      { type: 'task.create', title: 'CLI task', categoryId: snap.data.categories[0].id },
    ],
  });
  assert.equal(preview.code, 0, preview.stderr);
  const proposal = JSON.parse(preview.stdout);
  const submit = await cli(['submit'], { proposalId: proposal.id, requestId: 'cli-submit' });
  assert.equal(submit.code, 0, submit.stderr);
  assert.equal(JSON.parse(submit.stdout).status, 'pending_confirmation');
  assert.equal(((await store.read('workspace')).data as { tasks: unknown[] }).tasks.length, 0);
});

test('auth rejects malformed tokens and cookie-only writes; harness cannot use browser-only actions', async (t) => {
  const { app, headers, harness } = await fixture(t);
  const malformed = await app.inject({
    url: '/api/workspace',
    headers: { 'x-workbench-token': 'é'.repeat(64) },
  });
  assert.equal(malformed.statusCode, 401, malformed.body);
  const session = await app.inject('/api/session');
  const cookie = String(session.headers['set-cookie']).split(';')[0];
  const cookieWrite = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers: { cookie },
    payload: { approvalMode: 'auto_accept' },
  });
  assert.equal(cookieWrite.statusCode, 401, cookieWrite.body);
  for (const url of [
    '/api/proposals/anything/confirm',
    '/api/proposals/anything/reject',
    '/api/external',
    '/api/chat',
    '/api/chat/cancel',
  ]) {
    const result = await app.inject({
      method: 'POST',
      url,
      headers: harness,
      payload: { requestId: 'attempt' },
    });
    assert.equal(result.statusCode, 403, `${url}: ${result.body}`);
  }
  const localOtherPort = await app.inject({
    url: '/api/session',
    headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:9999' },
  });
  assert.equal(localOtherPort.statusCode, 403);
  const invalidDate = await app.inject({ url: '/api/review?date=2026-02-30', headers });
  assert.equal(invalidDate.statusCode, 400, invalidDate.body);
  const longId = await app.inject({
    url: `/api/documents?target=notes/${'n'.repeat(120)}`,
    headers,
  });
  assert.equal(longId.statusCode, 200, longId.body);
});

test('build initialization failure releases its data directory lock without overwriting malformed credentials', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'focus-init-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { dataDir: join(root, 'data'), localDir: join(root, 'local') };
  await mkdir(options.localDir, { recursive: true });
  await writeFile(join(options.localDir, 'harness-token'), 'malformed-local-credential');
  await assert.rejects(buildApp(options), /凭据损坏/);
  assert.equal(
    await readFile(join(options.localDir, 'harness-token'), 'utf8'),
    'malformed-local-credential',
  );
  await assert.rejects(access(join(options.dataDir, '.write.lock')), { code: 'ENOENT' });
  const store = await Store.open(options);
  await store.close();
});

test('static build assets and API share one origin while data, credentials and source files are not served', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'focus-static-'));
  await mkdir(join(root, 'build/assets'), { recursive: true });
  await writeFile(
    join(root, 'build/index.html'),
    '<!doctype html><html><title>Local workbench</title><script src="/assets/app.js"></script></html>',
  );
  await writeFile(join(root, 'build/assets/app.js'), 'globalThis.workbenchReady=true;');
  const { app } = await buildApp({
    dataDir: join(root, 'data'),
    localDir: join(root, 'local'),
    staticDir: join(root, 'build'),
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const index = await app.inject('/');
  assert.equal(index.statusCode, 200);
  assert.match(index.body, /Local workbench/);
  assert.match(String(index.headers['content-type']), /text\/html/);
  assert.equal(index.headers['x-content-type-options'], 'nosniff');
  assert.equal((await app.inject('/assets/app.js')).statusCode, 200);
  const session = await app.inject('/api/session');
  assert.equal(session.statusCode, 200);
  assert.equal(session.headers['cache-control'], 'no-store');
  for (const path of [
    '/data/workspace.json',
    '/.local/secrets.json',
    '/src/server/app.ts',
    '/%2e%2e/local/harness-token',
  ]) {
    assert.equal((await app.inject(path)).statusCode, 404, path);
  }
  const snapshot = await app.inject({
    url: '/api/workspace',
    headers: { 'x-workbench-token': session.json().token },
  });
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.json().revision, 0);
});

test('missing build reports actionable startup page without hiding API availability', async (t) => {
  const { app, headers } = await fixture(t, {
    staticDir: join(tmpdir(), 'focus-nonexistent-build-for-test'),
  });
  const result = await app.inject('/');
  assert.equal(result.statusCode, 503);
  assert.match(result.body, /npm run build/);
  assert.equal((await app.inject({ url: '/api/workspace', headers })).statusCode, 200);
});

test('SSE delivers committed changes and external edits; reconnect reads authoritative snapshots and close releases active streams', async (t) => {
  const { app, root, headers, store } = await fixture(t, { watchIntervalMs: 20 });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const session = await fetch(`${url}/api/session`);
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  await session.arrayBuffer();
  const active: AbortController[] = [];
  t.after(async () => {
    for (const controller of active) controller.abort();
  });
  const stream = async () => {
    const controller = new AbortController();
    active.push(controller);
    const response = await fetch(`${url}/api/events`, {
      headers: { cookie },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const reader = response.body!.getReader();
    const nextEvent = async (name: string) => {
      let text = '';
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        while (!text.includes(`event: ${name}\n`)) {
          const next = await reader.read();
          assert.equal(next.done, false, `stream closed before ${name}`);
          text += new TextDecoder().decode(next.value);
        }
        return text;
      } finally {
        clearTimeout(timer);
      }
    };
    return { reader, nextEvent, controller };
  };
  await app.inject({ url: '/api/workspace', headers });
  const first = await stream();
  await first.nextEvent('ready');
  await store.updatePreferences({ days: 7 });
  const changed = await first.nextEvent('change');
  assert.doesNotMatch(changed, /token|apiKey|longTerm|reflections/);
  await first.reader.cancel();
  await store.updatePreferences({ theme: 'glass-dark' });
  const second = await stream();
  await second.nextEvent('ready');
  const preferences = await app.inject({ url: '/api/preferences', headers });
  assert.equal(preferences.json().days, 7);
  assert.equal(preferences.json().theme, 'glass-dark');
  const file = join(root, 'data/workspace.json');
  const external = JSON.parse(await readFile(file, 'utf8'));
  external.revision = 4;
  await writeFile(file, JSON.stringify(external));
  await second.nextEvent('change');
  const snapshot = await app.inject({ url: '/api/workspace', headers });
  assert.equal(snapshot.json().revision, 0);
  assert.equal(snapshot.json().external.valid, true);
  await app.close();
  assert.equal((await second.reader.read()).done, true);
  await assert.rejects(access(join(root, 'data/.write.lock')), { code: 'ENOENT' });
});

test('production entrypoint fails clearly on an occupied port and releases its write lock', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'focus-port-failure-'));
  const blocker = createServer((_req, res) => res.end('unrelated local service'));
  await new Promise<void>((resolvePromise) => blocker.listen(0, '127.0.0.1', resolvePromise));
  const address = blocker.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    await new Promise<void>((resolvePromise, reject) =>
      blocker.close((error) => (error ? reject(error) : resolvePromise())),
    );
    await rm(root, { recursive: true, force: true });
  });
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      resolve('src/server/main.ts'),
      '--port',
      String(address.port),
      '--data-dir',
      join(root, 'data'),
      '--local-dir',
      join(root, 'local'),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('entrypoint did not exit after port failure'));
    }, 5000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolvePromise(exitCode);
    });
  });
  assert.equal(code, 1, stderr);
  assert.match(stderr, /已被占用/);
  assert.doesNotMatch(stdout, /http:\/\//);
  await assert.rejects(access(join(root, 'data/.write.lock')), { code: 'ENOENT' });
  const store = await Store.open({ dataDir: join(root, 'data'), localDir: join(root, 'local') });
  assert.equal((await store.read('workspace')).revision, 0);
  await store.close();
});
