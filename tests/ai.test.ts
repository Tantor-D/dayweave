import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.js';
import { AIService, buildContext } from '../src/server/ai.js';
import type { ContextData, PreviewInput, Target, Workspace } from '../src/domain/types.js';
import { runCLI } from '../src/harness/cli.js';

type RequestBody = {
  messages: { role: string; content: string }[];
  tools?: unknown[];
  model: string;
};
type Responder = (body: RequestBody, response: ServerResponse) => void | Promise<void>;
async function fixture(t: TestContext, respond: Responder) {
  const dir = await mkdtemp(join(tmpdir(), 'focus-ai-test-'));
  const store = await Store.open({ dataDir: join(dir, 'data'), localDir: join(dir, 'local') });
  const requests: RequestBody[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer mock-test-key');
    const body = JSON.parse(raw) as RequestBody;
    requests.push(body);
    await respond(body, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await store.updateSettings({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: 'mock-model',
    apiKey: 'mock-test-key',
  });
  const ai = new AIService(store);
  t.after(async () => {
    ai.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, ai, requests };
}
function answer(response: ServerResponse, content = '建议已整理。') {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
}
function current(body: RequestBody): ContextData {
  return JSON.parse(body.messages[1].content.split('\n').slice(1).join('\n')) as ContextData;
}
function propose(response: ServerResponse, proposals: (PreviewInput & { key: string })[]) {
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'propose_changes', arguments: JSON.stringify({ proposals }) },
              },
            ],
          },
        },
      ],
    }),
  );
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

test('AI reloads both backgrounds each request; reflection attachments are explicit and never stored in message history', async (t) => {
  const { ai, store, requests } = await fixture(t, (_body, res) => answer(res));
  await textWrite(store, 'long-term', '长期背景第一版');
  await textWrite(store, 'short-term', '短期安排第一版');
  await textWrite(store, 'daily/2026-11-02', 'REFLECTION_SECRET_8341');
  const first = await ai.chat({
    requestId: 'one',
    message: '先给建议',
    taskIds: [],
    reflections: ['daily/2026-11-02'],
  });
  assert.match(JSON.stringify(requests[0]), /REFLECTION_SECRET_8341/);
  await textWrite(store, 'long-term', '长期背景第二版');
  await textWrite(store, 'short-term', '短期安排第二版');
  const second = await ai.chat({
    requestId: 'two',
    message: '继续',
    conversationId: first.conversationId,
    taskIds: [],
    reflections: [],
  });
  const sent = JSON.stringify(requests[1]);
  assert.match(sent, /长期背景第二版/);
  assert.match(sent, /短期安排第二版/);
  assert.doesNotMatch(sent, /长期背景第一版|短期安排第一版|REFLECTION_SECRET_8341/);
  assert.match(second.warning!, /新建对话/);
  await ai.chat({ requestId: 'three', message: '新对话', taskIds: [] });
  assert.equal(requests[2].messages.length, 3);
  assert.equal((await store.getSettings()).hasApiKey, true);
  assert.doesNotMatch(JSON.stringify(first), /mock-test-key/);
});

test('context selects local dates across midnight and respects an explicitly empty task scope', async (t) => {
  const { store } = await fixture(t, (_body, res) => answer(res));
  const base = await store.read('workspace');
  const categoryId = (base.data as Workspace).categories[0].id;
  const p = await store.preview(
    {
      target: 'workspace',
      baseHash: base.hash,
      baseRevision: base.revision,
      operations: [
        { type: 'task.create', id: 'night', title: '跨午夜', categoryId },
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
        { type: 'task.create', id: 'later', title: '后天', categoryId },
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

test('web AI proposals use default confirmation, persist dependencies, and apply through the same Store', async (t) => {
  const { ai, store } = await fixture(t, (body, res) => {
    const ctx = current(body);
    propose(res, [
      {
        key: 'task',
        target: 'workspace',
        baseHash: ctx.workspace.hash,
        baseRevision: ctx.workspace.revision,
        operations: [
          {
            type: 'task.create',
            id: 'ai-task',
            title: '网页 AI 任务',
            categoryId: ctx.workspace.data.categories[0].id,
          },
        ],
      },
      {
        key: 'reflection',
        target: 'notes/ai-summary',
        baseHash: null,
        dependsOn: ['task'],
        operations: [{ type: 'text.write', content: '# 计划\n已创建任务后记录。' }],
      },
    ]);
  });
  const result = await ai.chat({
    message: '创建任务和相关反思',
    requestId: 'pending',
    taskIds: [],
  });
  assert.equal(result.proposals.length, 2);
  assert.deepEqual(
    result.proposals.map((p) => p.status),
    ['pending_confirmation', 'pending_confirmation'],
  );
  assert.equal((await store.read('workspace')).revision, 0);
  assert.equal((await store.read('notes/ai-summary')).hash, null);
  assert.deepEqual(result.proposals[1].dependsOn, [result.proposals[0].id]);
  assert.equal(
    (await store.submit(result.proposals[0].id, 'confirm-task', 'user', true)).status,
    'applied',
  );
  assert.equal(
    (await store.submit(result.proposals[1].id, 'confirm-reflection', 'user', true)).status,
    'applied',
  );
  assert.ok(
    (await store.history()).every(
      (change) => change.source === 'web_ai' && change.approval === 'web_confirmation',
    ),
  );
});

test('auto-accepted workspace and document proposals retain history; repeating a chat request does not call model or write again', async (t) => {
  const { ai, store, requests } = await fixture(t, (body, res) => {
    const ctx = current(body);
    propose(res, [
      {
        key: 'task',
        target: 'workspace',
        baseHash: ctx.workspace.hash,
        baseRevision: ctx.workspace.revision,
        operations: [
          {
            type: 'task.create',
            title: '自动接受任务',
            categoryId: ctx.workspace.data.categories[0].id,
          },
        ],
      },
      {
        key: 'short',
        target: 'short-term',
        baseHash: ctx.shortTerm.hash,
        dependsOn: ['task'],
        operations: [{ type: 'text.write', content: '今天完成自动接受任务。' }],
      },
    ]);
  });
  await store.updateSettings({ approvalMode: 'auto_accept' });
  const input = { message: '安排工作', requestId: 'auto-request', taskIds: [] };
  const first = await ai.chat(input);
  assert.deepEqual(
    first.proposals.map((p) => p.status),
    ['applied', 'applied'],
  );
  assert.deepEqual(await ai.chat(input), first);
  assert.equal(requests.length, 1);
  assert.equal((await store.history()).length, 2);
  assert.ok((await store.history()).every((change) => change.approval === 'auto_accept'));
  await assert.rejects(ai.chat({ ...input, message: '另一个请求' }), /同一请求编号/);
});

test('tool capability rejection falls back to plain chat and never executes natural-language JSON', async (t) => {
  const { ai, store, requests } = await fixture(t, (body, res) => {
    if (body.tools) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: 'tools parameter is not supported' } }));
    } else answer(res, '建议：```json {"type":"task.create","title":"不执行"} ```');
  });
  const result = await ai.chat({ requestId: 'fallback', message: '帮我安排' });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].tools, undefined);
  assert.equal(result.toolCapability, 'disabled');
  assert.match(result.warning!, /禁用/);
  assert.deepEqual(
    (await store.read('workspace')).data &&
      ((await store.read('workspace')).data as Workspace).tasks,
    [],
  );
  await ai.chat({ requestId: 'fallback-next', message: '再建议' });
  assert.equal(requests.length, 3);
  assert.equal(requests[2].tools, undefined);
});

test('invalid tool parameters, unselected existing reflections and stale model versions cannot write business data', async (t) => {
  let kind = 'invalid';
  const { ai, store } = await fixture(t, (body, res) => {
    const ctx = current(body);
    if (kind === 'invalid') {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    type: 'function',
                    function: {
                      name: 'propose_changes',
                      arguments: JSON.stringify({
                        proposals: [
                          {
                            key: 'bad',
                            target: 'workspace',
                            baseHash: ctx.workspace.hash,
                            baseRevision: 0,
                            operations: [{ type: 'settings.update', approvalMode: 'auto_accept' }],
                          },
                        ],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    } else if (kind === 'unselected')
      propose(res, [
        {
          key: 'doc',
          target: 'notes/private',
          baseHash: null,
          operations: [{ type: 'text.write', content: '覆盖尝试' }],
        },
      ]);
    else
      propose(res, [
        {
          key: 'old',
          target: 'workspace',
          baseHash: ctx.workspace.hash,
          baseRevision: 99,
          operations: [{ type: 'task.create', title: '过期' }],
        },
      ]);
  });
  await store.updateSettings({ approvalMode: 'auto_accept' });
  await textWrite(store, 'notes/private', '未选择的现有反思');
  await assert.rejects(ai.chat({ requestId: 'invalid', message: '修改' }), /无效工具参数/);
  kind = 'unselected';
  await assert.rejects(ai.chat({ requestId: 'unselected', message: '修改' }), /选择该篇反思/);
  kind = 'stale';
  await assert.rejects(ai.chat({ requestId: 'stale', message: '修改' }), /版本/);
  assert.equal((await store.read('workspace')).revision, 0);
  assert.equal((await store.read('notes/private')).data, '未选择的现有反思');
  assert.equal((await store.history()).length, 1);
});

test('model HTTP errors, malformed responses, timeout and cancellation leave original files unchanged', async (t) => {
  let mode = 'http';
  const { store } = await fixture(t, (_body, res) => {
    if (mode === 'http') {
      res.statusCode = 500;
      res.end('provider internal error');
    } else if (mode === 'json') res.end('not-json');
    else setTimeout(() => answer(res), 150);
  });
  const ai = new AIService(store, { timeoutMs: 5000 });
  await assert.rejects(ai.chat({ requestId: 'http', message: '请求' }), /HTTP 500/);
  mode = 'json';
  await assert.rejects(ai.chat({ requestId: 'json', message: '请求' }), /有效 JSON/);
  mode = 'slow';
  const shortTimeout = new AIService(store, { timeoutMs: 50 });
  await assert.rejects(shortTimeout.chat({ requestId: 'timeout', message: '请求' }), /超时/);
  const pending = ai.chat({ requestId: 'cancel', message: '请求' });
  setTimeout(() => ai.cancel('cancel'), 10);
  await assert.rejects(pending, /已取消/);
  assert.equal((await store.history()).length, 0);
  assert.equal((await store.read('workspace')).revision, 0);
});

test('context budget and external edits fail before sending provider requests', async (t) => {
  const { ai, store, requests, dir } = await fixture(t, (_body, res) => answer(res));
  await textWrite(store, 'long-term', '长期背景不可静默截断'.repeat(100));
  const shortBudget = new AIService(store, { contextCharLimit: 100 });
  await assert.rejects(shortBudget.chat({ message: '建议', requestId: 'budget' }), /预算/);
  assert.equal(requests.length, 0);
  await writeFile(join(dir, 'data/ai/short-term.md'), '外部修改');
  await assert.rejects(ai.chat({ message: '建议', requestId: 'external' }), /外部修改/);
  assert.equal(requests.length, 0);
});

test('a semantically invalid second target rejects prior previews without applying any target', async (t) => {
  const { ai, store } = await fixture(t, (body, res) => {
    const ctx = current(body);
    propose(res, [
      {
        key: 'background',
        target: 'short-term',
        baseHash: ctx.shortTerm.hash,
        operations: [{ type: 'text.write', content: '不应保存' }],
      },
      {
        key: 'bad-task',
        target: 'workspace',
        baseHash: ctx.workspace.hash,
        baseRevision: ctx.workspace.revision,
        operations: [{ type: 'task.update', id: 'missing-task', patch: { title: '不存在的任务' } }],
      },
    ]);
  });
  await store.updateSettings({ approvalMode: 'auto_accept' });
  await assert.rejects(ai.chat({ message: '多个修改', requestId: 'semantic-error' }));
  assert.equal((await store.read('short-term')).data, '');
  assert.equal((await store.read('workspace')).revision, 0);
  assert.equal((await store.history()).length, 0);
  assert.ok((await store.proposals()).every((proposal) => proposal.status === 'rejected'));
});

test('forced tool support reports incompatibility without fallback; disabled support sends no tools', async (t) => {
  const { ai, store, requests } = await fixture(t, (body, res) => {
    if (body.tools) {
      res.statusCode = 422;
      res.end('function tools unsupported');
    } else answer(res);
  });
  await store.updateSettings({ toolSupport: 'enabled' });
  await assert.rejects(ai.chat({ message: '修改', requestId: 'forced' }), /不支持结构化工具/);
  assert.equal(requests.length, 1);
  await store.updateSettings({ toolSupport: 'disabled' });
  const result = await ai.chat({ message: '给建议', requestId: 'disabled' });
  assert.equal(result.toolCapability, 'disabled');
  assert.equal(requests[1].tools, undefined);
  assert.equal((await store.history()).length, 0);
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
