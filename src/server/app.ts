import Fastify, { type FastifyRequest } from 'fastify';
import staticPlugin from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import { z } from 'zod';
import { Store } from './store.ts';
import { buildContext, contextSchema } from './context.ts';
import { documentQuerySchema, queryDocuments } from './documents.ts';
import { operationSchema, workspaceSchema, previewSchema, targetSchema } from '../domain/schema.ts';
import { validDate } from '../domain/operations.ts';
import type {
  Target,
  Source,
  ContextInput,
  Workspace,
  Snapshot,
  Task,
  PreviewInput,
} from '../domain/types.ts';

const localHost = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
const tokenEquals = (actual: string | undefined, expected: string) =>
  !!actual &&
  /^[a-f0-9]{64}$/.test(actual) &&
  actual.length === expected.length &&
  timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
const hashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .nullable();
const requestSchema = z.strictObject({ requestId: z.string().min(1).max(200) });

function httpError(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
export interface AppOptions {
  dataDir: string;
  localDir: string;
  staticDir?: string;
  watchIntervalMs?: number;
}

export async function buildApp(options: AppOptions) {
  const store = await Store.open({
    dataDir: resolve(options.dataDir),
    localDir: resolve(options.localDir),
  });
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const clients = new Set<ServerResponse>();
  let watcher: ReturnType<typeof setInterval> | undefined;
  app.addHook('preClose', async () => {
    for (const client of clients) client.end();
  });
  app.addHook('onClose', async () => {
    clearInterval(watcher);
    await store.close();
  });
  try {
    const browserToken = randomBytes(32).toString('hex');
    await mkdir(options.localDir, { recursive: true, mode: 0o700 });
    const tokenFile = resolve(options.localDir, 'harness-token');
    let harnessToken: string;
    try {
      harnessToken = (await readFile(tokenFile, 'utf8')).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      harnessToken = randomBytes(32).toString('hex');
      await writeFile(tokenFile, harnessToken + '\n', { mode: 0o600 });
    }
    if (!/^[a-f0-9]{64}$/.test(harnessToken))
      throw httpError('INVALID_CREDENTIAL', '本机工具凭据损坏，请保留现场并重新生成凭据', 500);
    await chmod(tokenFile, 0o600);
    const sources = new WeakMap<FastifyRequest, Source>();
    const source = (req: FastifyRequest) => sources.get(req) ?? 'harness';
    const userOnly = (req: FastifyRequest) => {
      if (source(req) !== 'user') throw httpError('FORBIDDEN', '此操作只能在网页中由用户执行', 403);
    };
    const watched = new Map<Target, string>();
    const broadcast = () => {
      for (const client of clients) client.write('event: change\ndata: {}\n\n');
    };
    store.onChange = broadcast;
    const read = async (target: Target) => {
      const snap = await store.read(target);
      watched.set(target, JSON.stringify([snap.hash, snap.external?.hash, snap.readOnly]));
      return snap;
    };
    let checking = false;
    watcher = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        for (const [target, old] of watched) {
          const snap = await store.read(target);
          const next = JSON.stringify([snap.hash, snap.external?.hash, snap.readOnly]);
          if (old !== next) {
            watched.set(target, next);
            broadcast();
          }
        }
      } catch {
        /* A subsequent explicit read returns the actionable error. */
      } finally {
        checking = false;
      }
    }, options.watchIntervalMs ?? 2000);
    watcher.unref();
    app.addHook('onRequest', async (req, reply) => {
      const hostHeader = req.headers.host ?? '';
      let host: URL;
      try {
        host = new URL(`http://${hostHeader}`);
      } catch {
        throw httpError('FORBIDDEN', '仅接受本机请求', 403);
      }
      if (!localHost(host.hostname)) throw httpError('FORBIDDEN', '仅接受本机 Host', 403);
      const origin = req.headers.origin;
      if (origin) {
        let parsed: URL;
        try {
          parsed = new URL(origin);
        } catch {
          throw httpError('FORBIDDEN', '来源无效', 403);
        }
        if (
          parsed.protocol !== 'http:' ||
          !localHost(parsed.hostname) ||
          ![host.port, '5173'].includes(parsed.port)
        )
          throw httpError('FORBIDDEN', '拒绝跨站请求', 403);
      }
      if (req.headers['sec-fetch-site'] === 'cross-site')
        throw httpError('FORBIDDEN', '拒绝跨站请求', 403);
      reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
      if (!req.url.startsWith('/api/')) return;
      reply.header('Cache-Control', 'no-store');
      if (req.method === 'GET' && req.url === '/api/session') {
        // This endpoint is protected by Host, Origin, Fetch Metadata and browser SOP.
        reply.header(
          'Set-Cookie',
          `workbench_session=${browserToken}; HttpOnly; SameSite=Strict; Path=/api`,
        );
        return;
      }
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ') && tokenEquals(auth.slice(7), harnessToken)) {
        sources.set(req, 'harness');
        return;
      }
      const token = req.headers['x-workbench-token'];
      if (typeof token === 'string' && tokenEquals(token, browserToken)) {
        sources.set(req, 'user');
        return;
      }
      const cookie = req.headers.cookie
        ?.split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith('workbench_session='))
        ?.slice('workbench_session='.length);
      if (req.method === 'GET' && req.url === '/api/events' && tokenEquals(cookie, browserToken)) {
        sources.set(req, 'user');
        return;
      }
      throw httpError('UNAUTHORIZED', '本机会话失效，请刷新网页；外部工具请检查本机凭据', 401);
    });
    app.setErrorHandler((error, _req, reply) => {
      if (error instanceof z.ZodError)
        return reply.code(400).send({
          error: {
            code: 'VALIDATION',
            message: error.issues
              .map((item) => `${item.path.join('.')}: ${item.message}`)
              .join('；'),
          },
        });
      const err = error as Error & { code?: string; statusCode?: number };
      const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
      return reply.code(status).send({
        error: {
          code: err.code ?? 'SAVE_FAILED',
          message: err.message || '操作未完成，原有内容已保留',
        },
      });
    });
    app.get('/api/session', async () => ({ token: browserToken }));
    app.get('/api/workspace', async () => read('workspace'));
    app.get('/api/documents/list', async () => store.listDocuments());
    app.post('/api/documents/query', async (req) =>
      queryDocuments(store, documentQuerySchema.parse(req.body)),
    );
    app.get('/api/documents', async (req) => {
      const target = targetSchema.parse((req.query as { target?: string }).target) as Target;
      if (target === 'workspace') throw httpError('VALIDATION', '请通过工作数据接口读取 workspace');
      return read(target);
    });
    app.get('/api/schema', async () => ({
      workspace: z.toJSONSchema(workspaceSchema, { target: 'draft-7' }),
      operation: z.toJSONSchema(operationSchema, { target: 'draft-7' }),
      preview: z.toJSONSchema(previewSchema, { target: 'draft-7' }),
    }));
    app.post('/api/preview', async (req) =>
      store.preview(previewSchema.parse(req.body) as PreviewInput, source(req)),
    );
    app.get('/api/proposals', async () => store.proposals());
    app.get<{ Params: { id: string } }>('/api/proposals/:id', async (req) => {
      const proposal = (await store.proposals()).find((p) => p.id === req.params.id);
      if (!proposal) throw httpError('NOT_FOUND', '提案不存在', 404);
      return proposal;
    });
    app.post<{ Params: { id: string } }>('/api/proposals/:id/submit', async (req) =>
      store.submit(req.params.id, requestSchema.parse(req.body).requestId, source(req)),
    );
    app.post<{ Params: { id: string } }>('/api/proposals/:id/confirm', async (req) => {
      return store.submit(
        req.params.id,
        requestSchema.parse(req.body).requestId,
        source(req),
        true,
      );
    });
    app.post<{ Params: { id: string } }>('/api/proposals/:id/reject', async (req) => {
      userOnly(req);
      return store.reject(req.params.id);
    });
    app.get('/api/history', async (req) => {
      const query = req.query as { target?: string; offset?: string; limit?: string };
      const entries = await store.history(
        query.target ? (targetSchema.parse(query.target) as Target) : undefined,
      );
      const offset = Math.max(0, Number(query.offset) || 0);
      const limit =
        query.limit === undefined
          ? entries.length
          : Math.max(1, Math.min(500, Number(query.limit) || 50));
      return entries.slice(offset, offset + limit);
    });
    app.post('/api/restore', async (req) => {
      const input = z
        .strictObject({
          changeId: z.string(),
          side: z.enum(['before', 'after']),
          baseHash: hashSchema,
        })
        .parse(req.body);
      return store.restore(input.changeId, input.side, input.baseHash, source(req));
    });
    app.post('/api/external', async (req) => {
      userOnly(req);
      const input = z
        .strictObject({
          target: targetSchema,
          action: z.enum(['adopt', 'restore']),
          expectedHash: hashSchema,
        })
        .parse(req.body);
      return store.resolveExternal(input.target as Target, input.action, input.expectedHash);
    });
    app.get('/api/preferences', async () => store.getPreferences());
    app.patch('/api/preferences', async (req) => {
      userOnly(req);
      return store.updatePreferences(req.body as never);
    });
    app.post('/api/context', async (req) =>
      buildContext(store, contextSchema.parse(req.body) as ContextInput),
    );
    app.get('/api/review', async (req) => {
      const date = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .parse((req.query as { date?: string }).date);
      if (!validDate(date)) throw httpError('VALIDATION', '复盘日期不存在');
      const snap = (await read('workspace')) as Snapshot<Workspace>;
      const start = Date.parse(`${date}T00:00:00+08:00`),
        end = start + 86400000;
      const planned: Task[] = snap.data.tasks.filter((task) =>
        task.placements.some((p) =>
          p.kind === 'day'
            ? p.date === date
            : Date.parse(p.startAt) < end && Date.parse(p.endAt) > start,
        ),
      );
      const completed = (await store.history('workspace'))
        .filter((c) => c.status === 'committed')
        .flatMap((c) => c.completionEvents.map((event) => ({ ...event, changeId: c.id })))
        .filter((event) => {
          const time = Date.parse(event.completedAt);
          return time >= start && time < end;
        });
      return { date, planned, completed };
    });
    app.get('/api/events', (req, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      reply.raw.write('event: ready\ndata: {}\n\n');
      clients.add(reply.raw);
      const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15000);
      req.raw.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(reply.raw);
      });
    });
    if (options.staticDir) {
      try {
        await access(resolve(options.staticDir, 'index.html'));
        await app.register(staticPlugin, { root: resolve(options.staticDir), prefix: '/' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        app.get('/', async (_req, reply) =>
          reply
            .code(503)
            .type('text/plain')
            .send('前端尚未构建。请运行 npm run build，再重新启动。'),
        );
      }
    }
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口或文件不存在' } }),
    );
    return { app, store };
  } catch (error) {
    await app.close();
    throw error;
  }
}
