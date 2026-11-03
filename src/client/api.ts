import type {
  Operation,
  PreviewInput,
  Proposal,
  Snapshot,
  Target,
  Workspace,
} from '../domain/types';
let token = '';
let session: Promise<void> | undefined;
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  retry = true,
): Promise<T> {
  if (!session)
    session = fetch('/api/session')
      .then(async (r) => {
        if (!r.ok) throw new Error('无法连接本地服务');
        token = (await r.json()).token;
      })
      .catch((e) => {
        session = undefined;
        throw e;
      });
  await session;
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      'x-workbench-token': token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && retry) {
    session = undefined;
    token = '';
    return api<T>(path, body, method, false);
  }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? `请求失败 (${response.status})`);
  return value as T;
}
export async function commit(
  snapshot: Snapshot,
  operations: Operation[],
  summary: string,
): Promise<Proposal> {
  const proposal = await api<Proposal>('/preview', {
    target: snapshot.target,
    baseHash: snapshot.hash,
    baseRevision: snapshot.revision,
    operations,
    summary,
  } satisfies PreviewInput);
  const result = await api<Proposal>(`/proposals/${proposal.id}/submit`, {
    requestId: crypto.randomUUID(),
  });
  if (result.status !== 'applied') throw new Error(result.error ?? `修改未保存：${result.status}`);
  return result;
}
export const readDocument = (target: Target) =>
  api<Snapshot<string>>(`/documents?target=${encodeURIComponent(target)}`);
export const readWorkspace = () => api<Snapshot<Workspace>>('/workspace');
