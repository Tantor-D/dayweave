import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

class CLIError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const HELP = {
  name: 'focus-workbench harness',
  usage:
    'npm run --silent harness -- <command> [target|proposalId] [--file payload.json|-] [--url http://127.0.0.1:4310] [--local-dir .local]',
  commands: {
    read: '读取 workspace（默认）或 long-term / short-term / daily/YYYY-MM-DD / notes/id',
    context: 'stdin / --file: {startDate?,endDate?,taskIds?,reflections?}，每次包含最新两类背景',
    preview: 'stdin / --file: {target,baseHash,baseRevision?,operations,summary?,dependsOn?}',
    confirm: 'proposalId --request-id id：仅在用户确认已展示的具体差异后调用，记录 CLI 确认',
    proposals: '列出持久化提案',
    proposal: 'proposalId：读取提案真实前后差异及状态',
    documents: 'stdin / --file: {kind?,startDate?,endDate?,offset?,limit?}，分页列出反思',
    search: 'stdin / --file: {query,kind?,startDate?,endDate?,offset?,limit?}，关键词检索反思',
    submit: 'proposalId 或 stdin / --file: {proposalId,requestId}，显式 requestId 可安全重试',
    history: '可选 target，只读取历史，不默认加入 AI 上下文',
    restore: 'stdin / --file: {changeId,side:"before"|"after",baseHash}，生成恢复提案，仍需 submit',
    schema: '读取共享 JSON Schema',
  },
  approval:
    '本工具始终标识为外部 AI；普通提交返回 pending_confirmation；展示差异并取得聊天确认后使用 confirm，也可在网页确认。服务端信任 CLI 识别真人确认。',
};

type IO = { input: () => Promise<string>; output: (value: unknown) => void };
const defaultIO: IO = {
  input: async () => {
    if (process.stdin.isTTY) return '';
    let result = '';
    for await (const chunk of process.stdin) {
      result += chunk.toString();
      if (result.length > 2_000_000) throw new CLIError('INPUT_TOO_LARGE', '输入 JSON 超过 2 MB。');
    }
    return result;
  },
  output: (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`),
};

export async function runCLI(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  io: IO = defaultIO,
): Promise<number> {
  try {
    const positional: string[] = [];
    const flags: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--help' || arg === '-h') {
        io.output(HELP);
        return 0;
      }
      if (arg.startsWith('-')) {
        if (!['--file', '-f', '--url', '--local-dir', '--request-id'].includes(arg) || !args[i + 1])
          throw new CLIError('USAGE', `未知或缺少值的参数：${arg}`);
        flags[arg === '-f' ? '--file' : arg] = args[++i];
      } else positional.push(arg);
    }
    const [command, parameter] = positional;
    if (!command) {
      io.output(HELP);
      return 0;
    }
    if (!Object.keys(HELP.commands).includes(command) || positional.length > 2)
      throw new CLIError('USAGE', '命令无效，请运行 harness --help。');
    let url: URL;
    try {
      url = new URL(flags['--url'] ?? env.WORKBENCH_URL ?? 'http://127.0.0.1:4310');
    } catch {
      throw new CLIError('USAGE', '服务地址不是有效 URL。');
    }
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new CLIError(
        'USAGE',
        'harness 只连接本机 HTTP 服务根地址，例如 http://127.0.0.1:4310。',
      );
    }
    let token: string;
    try {
      token = (
        await readFile(
          resolve(flags['--local-dir'] ?? env.WORKBENCH_LOCAL_DIR ?? '.local', 'harness-token'),
          'utf8',
        )
      ).trim();
    } catch {
      throw new CLIError(
        'SERVICE_NOT_RUNNING',
        '未找到本机工具凭据。请先在项目目录运行 npm start；自定义本机目录时传入 --local-dir。',
      );
    }
    if (!token) throw new CLIError('SERVICE_NOT_RUNNING', '工具凭据为空，请重新启动工作台服务。');
    const needsBody = [
      'context',
      'preview',
      'submit',
      'confirm',
      'restore',
      'documents',
      'search',
    ].includes(command);
    let payload: Record<string, unknown> = {};
    if (needsBody) {
      const raw =
        flags['--file'] && flags['--file'] !== '-'
          ? await readFile(resolve(flags['--file']), 'utf8')
          : parameter && ['submit', 'confirm'].includes(command)
            ? ''
            : await io.input();
      if (raw.trim()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new CLIError('INVALID_JSON', '输入不是有效的 JSON 对象。');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new CLIError('INVALID_JSON', '输入必须是 JSON 对象。');
        payload = parsed as Record<string, unknown>;
      }
    }
    let path: string;
    let body: Record<string, unknown> | undefined;
    let method = 'GET';
    switch (command) {
      case 'documents':
      case 'search':
        if (command === 'search' && (typeof payload.query !== 'string' || !payload.query.trim()))
          throw new CLIError('USAGE', 'search 需要非空 query。');
        path = '/api/documents/query';
        method = 'POST';
        body = payload;
        break;
      case 'proposals':
        path = '/api/proposals';
        break;
      case 'proposal':
        if (!parameter || !/^[A-Za-z0-9_-]{1,120}$/.test(parameter))
          throw new CLIError('USAGE', 'proposal 需要有效 proposalId。');
        path = `/api/proposals/${encodeURIComponent(parameter)}`;
        break;
      case 'read':
        path =
          !parameter || parameter === 'workspace'
            ? '/api/workspace'
            : `/api/documents?target=${encodeURIComponent(parameter)}`;
        break;
      case 'schema':
        path = '/api/schema';
        break;
      case 'history':
        path = `/api/history${parameter ? `?target=${encodeURIComponent(parameter)}` : ''}`;
        break;
      case 'context':
        path = '/api/context';
        method = 'POST';
        body = payload;
        break;
      case 'preview':
        path = '/api/preview';
        method = 'POST';
        body = payload;
        break;
      case 'restore':
        path = '/api/restore';
        method = 'POST';
        body = payload;
        break;
      case 'confirm':
      case 'submit': {
        const proposalId = parameter ?? payload.proposalId;
        if (typeof proposalId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(proposalId))
          throw new CLIError('USAGE', `${command} 需要有效 proposalId。`);
        if (command === 'confirm' && !flags['--request-id'] && !payload.requestId)
          throw new CLIError('USAGE', 'confirm 必须提供 requestId，以便安全重试。');
        const requestId = flags['--request-id'] ?? payload.requestId ?? randomUUID();
        path = `/api/proposals/${encodeURIComponent(proposalId)}/${command}`;
        method = 'POST';
        body = { requestId };
        break;
      }
      default:
        throw new CLIError('USAGE', '未知命令。');
    }
    let response: Response;
    try {
      response = await fetch(new URL(path, url), {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new CLIError(
        'SERVICE_UNAVAILABLE',
        '无法连接本机工作台。请先运行 npm start，并核对 --url 端口；请求若曾超时，请用同一 requestId 重试。',
      );
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new CLIError('INVALID_RESPONSE', '服务未返回 JSON。请核对端口是否属于本工作台。');
    }
    io.output(result);
    if (!response.ok) return 1;
    if (
      result &&
      typeof result === 'object' &&
      'status' in result &&
      ['failed', 'conflict', 'rejected'].includes(String(result.status))
    )
      return 1;
    return 0;
  } catch (error) {
    io.output({
      error: {
        code: error instanceof CLIError ? error.code : 'CLI_ERROR',
        message: error instanceof Error ? error.message : '命令执行失败。',
      },
    });
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await runCLI(process.argv.slice(2));
}
