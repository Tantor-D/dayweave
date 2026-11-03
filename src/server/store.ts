import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  preferencesSchema,
  previewSchema,
  settingsPatchSchema,
  targetSchema,
} from '../domain/schema.ts';
import {
  applyOperations,
  completionChanges,
  DomainError,
  emptyWorkspace,
  normalizeWorkspace,
  validDate,
  validateWorkspace,
} from '../domain/operations.ts';
import type {
  Change,
  Preferences,
  PreviewInput,
  Proposal,
  Snapshot,
  Source,
  Target,
  UserSettings,
  Workspace,
} from '../domain/types.ts';

export { DomainError } from '../domain/operations.ts';
export type Failpoint =
  'before_history' | 'after_prepared' | 'before_replace' | 'after_replace' | 'before_commit';
interface StoreOptions {
  dataDir: string;
  localDir: string;
  failpoint?: (point: Failpoint) => void | Promise<void>;
  now?: () => Date;
}
interface ModelConfig {
  approvalMode: UserSettings['approvalMode'];
  baseUrl: string;
  model: string;
  apiKey: string;
  toolSupport: UserSettings['toolSupport'];
}
const defaults: Preferences = {
  theme: 'glass-light',
  days: 3,
  orientation: 'vertical',
  panelWidth: 300,
  hiddenCategories: [],
  hiddenProjects: [],
  hiddenTasks: [],
  hiddenStatuses: [],
  showArchived: false,
};
const modelDefaults: ModelConfig = {
  approvalMode: 'require_confirmation',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKey: '',
  toolSupport: 'auto',
};
export const hashContent = (content: string | null): string | null =>
  content === null ? null : createHash('sha256').update(content, 'utf8').digest('hex');
export const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const coded = (code: string, message: string, statusCode = 400): never => {
  throw new DomainError(code, message, statusCode);
};
async function textFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
async function atomicWrite(path: string, content: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', mode);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, path);
    await chmod(path, mode);
    const directory = await open(dirname(path), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
  }
}

/** One process owns the data directory; every mutation is serialized through this object. */
export class Store {
  readonly dataDir: string;
  readonly localDir: string;
  onChange?: () => void;
  private known = new Map<Target, string | null>();
  private readonlyReasons = new Map<Target, string>();
  private proposalMap = new Map<string, Proposal>();
  private requestMap: Record<string, string> = {};
  private changes: Change[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private token = randomUUID();
  private closed = false;
  private globalReadOnly?: string;
  private constructor(private options: StoreOptions) {
    this.dataDir = resolve(options.dataDir);
    this.localDir = resolve(options.localDir);
    if (this.localDir === this.dataDir || this.localDir.startsWith(this.dataDir + sep))
      coded('INVALID_LOCAL_DIR', '本机设置目录必须位于业务数据目录之外，以隔离模型密钥');
  }
  static async open(options: StoreOptions): Promise<Store> {
    const store = new Store(options);
    try {
      await store.initialize();
      return store;
    } catch (error) {
      await store.releaseLock();
      throw error;
    }
  }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) coded('STORE_CLOSED', '服务已经关闭', 503);
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  private targetPath(target: Target): string {
    const check = targetSchema.safeParse(target);
    if (!check.success) coded('VALIDATION_ERROR', '不允许的文档引用');
    if (target === 'workspace') return join(this.dataDir, 'workspace.json');
    if (target === 'long-term' || target === 'short-term')
      return join(this.dataDir, 'ai', `${target}.md`);
    if (target.startsWith('daily/') && !validDate(target.slice(6)))
      coded('VALIDATION_ERROR', '反思日期不存在');
    return join(this.dataDir, 'reflections', `${target}.md`);
  }
  private notify(): void {
    try {
      this.onChange?.();
    } catch {
      /* Observer failures cannot change a durable commit result. */
    }
  }
  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
  private get historyDir(): string {
    return join(this.dataDir, '.history', 'changes');
  }
  private get lockPath(): string {
    return join(this.dataDir, '.write.lock');
  }
  private async acquireLock(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const f = await open(this.lockPath, 'wx', 0o600);
        try {
          await f.writeFile(serialize({ pid: process.pid, token: this.token }));
          await f.sync();
        } finally {
          await f.close();
        }
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let lock: { pid: number; token: string };
        try {
          lock = JSON.parse((await textFile(this.lockPath))!);
        } catch {
          coded('DATA_LOCKED', '数据写入锁无法识别；确认没有其他实例后再处理 .write.lock', 409);
        }
        try {
          process.kill(lock!.pid, 0);
          coded('DATA_LOCKED', '数据目录已有运行中的服务；请复用或关闭该服务', 409);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
        // Only remove the exact stale lock inspected above.
        const current = await textFile(this.lockPath);
        if (current && JSON.parse(current).token === lock!.token) await rm(this.lockPath);
      }
    }
    coded('DATA_LOCKED', '无法取得数据目录写入锁', 409);
  }
  private async releaseLock(): Promise<void> {
    try {
      const raw = await textFile(this.lockPath);
      if (raw && JSON.parse(raw).token === this.token) await rm(this.lockPath);
    } catch {
      /* Preserve an unrecognized lock. */
    }
  }
  private async initialize(): Promise<void> {
    await this.acquireLock();
    await mkdir(this.localDir, { recursive: true, mode: 0o700 });
    await mkdir(this.historyDir, { recursive: true });
    const knownRaw = await textFile(join(this.localDir, 'known.json'));
    if (knownRaw) {
      try {
        const saved = JSON.parse(knownRaw);
        if (saved.dataDir !== this.dataDir)
          coded('LOCAL_DIR_IN_USE', '本机状态目录属于另一份数据，请为该数据指定独立 localDir', 409);
        for (const [target, content] of Object.entries(saved.targets)) {
          this.targetPath(target as Target);
          if (content !== null && typeof content !== 'string')
            throw new Error('invalid known snapshot');
          if (content !== null) this.validateContent(target as Target, content as string);
        }
        this.known = new Map(Object.entries(saved.targets) as [Target, string | null][]);
      } catch (error) {
        if (error instanceof DomainError) throw error;
        this.globalReadOnly = '本机有效快照损坏，原始文件未被覆盖；请从备份恢复 .local/known.json';
      }
    }
    for (const file of (await readdir(this.historyDir)).filter((f) => f.endsWith('.json')).sort()) {
      try {
        const change = JSON.parse((await textFile(join(this.historyDir, file)))!) as Change;
        this.targetPath(change.target);
        if (
          typeof change.after !== 'string' ||
          change.id !== file.slice(0, -5) ||
          (change.before !== null && typeof change.before !== 'string') ||
          hashContent(change.before) !== change.beforeHash ||
          hashContent(change.after) !== change.afterHash ||
          !['prepared', 'committed', 'aborted', 'uncertain'].includes(change.status) ||
          !['user', 'harness', 'web_ai', 'external'].includes(change.source) ||
          typeof change.requestId !== 'string' ||
          !Array.isArray(change.completionEvents) ||
          !Number.isFinite(Date.parse(change.createdAt))
        )
          throw new Error('invalid history');
        this.validateContent(change.target, change.after);
        this.changes.push(change);
      } catch {
        this.globalReadOnly = `历史记录 ${file} 无法读取，已停止写入并保留现场`;
      }
    }
    this.changes.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const change of this.changes) {
      if (change.status === 'prepared' || change.status === 'uncertain') {
        const disk = await textFile(this.targetPath(change.target));
        const hash = hashContent(disk);
        if (hash === change.afterHash) change.status = 'committed';
        else if (hash === change.beforeHash) change.status = 'aborted';
        else {
          change.status = 'uncertain';
          this.readonlyReasons.set(
            change.target,
            '未完成保存遇到未知磁盘内容，请检查外部差异后采纳或恢复',
          );
          if (!this.known.has(change.target)) this.known.set(change.target, change.before);
        }
        await this.saveChange(change);
      }
      if (change.status === 'committed') this.known.set(change.target, change.after);
    }
    const proposalDir = join(this.localDir, 'proposals');
    await mkdir(proposalDir, { recursive: true });
    for (const file of (await readdir(proposalDir)).filter((f) => f.endsWith('.json'))) {
      try {
        const p = JSON.parse((await textFile(join(proposalDir, file)))!) as Proposal;
        this.targetPath(p.target);
        if (p.id !== file.slice(0, -5)) throw new Error('invalid proposal');
        const change = this.changes.find((c) => c.proposalId === p.id && c.status === 'committed');
        if (change) {
          p.status = 'applied';
          p.changeId = change.id;
          p.after = change.after;
          delete p.error;
        }
        this.proposalMap.set(p.id, p);
      } catch {
        this.globalReadOnly = '本机提案记录损坏，已停止写入并保留原始文件';
      }
    }
    const requests = await textFile(join(this.localDir, 'requests.json'));
    if (requests) {
      try {
        this.requestMap = JSON.parse(requests);
      } catch {
        this.globalReadOnly = '请求去重记录损坏，已停止写入';
      }
    }
    for (const c of this.changes)
      if (c.proposalId && c.requestId) this.requestMap[c.requestId] = c.proposalId;
    const disk = await textFile(this.targetPath('workspace'));
    if (!this.known.has('workspace')) {
      if (disk === null) {
        const entries = await readdir(this.dataDir);
        const meaningful = entries.filter((e) => !['.write.lock', '.history'].includes(e));
        if (meaningful.length || this.changes.length || knownRaw) {
          this.known.set('workspace', null);
          this.readonlyReasons.set('workspace', '已有数据目录缺少 workspace.json；未自动初始化');
        } else {
          const initial = serialize(emptyWorkspace());
          await atomicWrite(this.targetPath('workspace'), initial);
          this.known.set('workspace', initial);
        }
      } else {
        try {
          validateWorkspace(JSON.parse(disk));
          this.known.set('workspace', disk);
        } catch (error) {
          this.known.set('workspace', null);
          this.readonlyReasons.set('workspace', `工作文件无法读取：${(error as Error).message}`);
        }
      }
    }
    for (const target of ['long-term', 'short-term'] as const)
      if (!this.known.has(target)) {
        const content = await textFile(this.targetPath(target));
        if (content === null && !this.globalReadOnly && !this.readonlyReasons.has('workspace'))
          await atomicWrite(this.targetPath(target), '');
        this.known.set(target, content ?? '');
      }
    if (!this.globalReadOnly) await this.saveKnown();
  }
  private async saveKnown(): Promise<void> {
    await atomicWrite(
      join(this.localDir, 'known.json'),
      serialize({ dataDir: this.dataDir, targets: Object.fromEntries(this.known) }),
    );
  }
  private async saveProposal(p: Proposal): Promise<void> {
    await atomicWrite(join(this.localDir, 'proposals', `${p.id}.json`), serialize(p));
    this.proposalMap.set(p.id, p);
  }
  private async saveChange(change: Change): Promise<void> {
    await atomicWrite(join(this.historyDir, `${change.id}.json`), serialize(change));
  }
  private validateContent(target: Target, content: string | null): void {
    if (target === 'workspace') {
      if (content === null) coded('VALIDATION_ERROR', '工作数据文件不能删除');
      validateWorkspace(JSON.parse(content!));
    } else if (content !== null && content.length > 2000000)
      coded('VALIDATION_ERROR', '文档超过 2 MB 限制');
  }
  async read(target: Target): Promise<Snapshot> {
    return this.exclusive(() => this.readNow(target));
  }
  private async readNow(target: Target): Promise<Snapshot> {
    const path = this.targetPath(target);
    const disk = await textFile(path);
    if (!this.known.has(target)) {
      this.validateContent(target, disk);
      this.known.set(target, disk);
      if (!this.globalReadOnly) await this.saveKnown();
    }
    const content = this.known.get(target) ?? null;
    const hash = hashContent(content);
    const diskHash = hashContent(disk);
    const data =
      target === 'workspace'
        ? (JSON.parse(content ?? serialize(emptyWorkspace())) as Workspace)
        : (content ?? '');
    const snapshot: Snapshot = {
      target,
      data,
      hash,
      ...(target === 'workspace' ? { revision: (data as Workspace).revision } : {}),
    };
    if (diskHash !== hash) {
      let valid = true,
        error: string | undefined;
      try {
        this.validateContent(target, disk);
      } catch (e) {
        valid = false;
        error = (e as Error).message;
      }
      snapshot.external = { hash: diskHash, content: disk, valid, ...(error ? { error } : {}) };
    }
    const readonly =
      this.globalReadOnly ??
      this.readonlyReasons.get(target) ??
      (target === 'workspace' && content === null
        ? '没有可信工作区快照，不能恢复为空数据；请先修复磁盘文件，再采纳有效内容'
        : undefined);
    if (readonly) snapshot.readOnly = readonly;
    return snapshot;
  }
  private assertWritable(snapshot: Snapshot): void {
    if (snapshot.readOnly) coded('READ_ONLY', snapshot.readOnly, 409);
    if (snapshot.external)
      coded('EXTERNAL_CHANGE', '检测到外部文件修改，请在网页采纳或恢复后重试', 409);
  }
  private assertBase(snapshot: Snapshot, hash: string | null, revision?: number): void {
    if (
      snapshot.hash !== hash ||
      (snapshot.target === 'workspace' && snapshot.revision !== revision)
    )
      coded('CONFLICT', '数据已变化，请重新读取并生成预览', 409);
  }
  async preview(input: PreviewInput, source: Source): Promise<Proposal> {
    return this.exclusive(async () => {
      const parsed = previewSchema.safeParse(input);
      if (!parsed.success) coded('VALIDATION_ERROR', parsed.error.message);
      const value = parsed.data! as PreviewInput;
      const current = await this.readNow(value.target);
      this.assertWritable(current);
      this.assertBase(current, value.baseHash, value.baseRevision);
      let after: string;
      if (value.target === 'workspace') {
        const result = applyOperations(current.data as Workspace, value.operations, this.now());
        result.workspace.revision++;
        after = serialize(result.workspace);
      } else {
        if (value.operations.length !== 1 || value.operations[0].type !== 'text.write')
          coded('VALIDATION_ERROR', '文本提案必须只包含一条 text.write');
        after = (value.operations[0] as { content: string }).content;
      }
      for (const id of value.dependsOn ?? [])
        if (!this.proposalMap.has(id)) coded('VALIDATION_ERROR', '依赖提案不存在');
      const proposal: Proposal = {
        id: randomUUID(),
        target: value.target,
        baseHash: value.baseHash,
        baseRevision: value.baseRevision,
        operations: value.operations,
        summary: value.summary ?? value.operations.map((op) => op.type).join(', '),
        source,
        before: this.known.get(value.target) ?? null,
        after,
        createdAt: this.now(),
        status: 'preview',
        dependsOn: value.dependsOn,
      };
      await this.saveProposal(proposal);
      this.notify();
      return structuredClone(proposal);
    });
  }
  async proposals(): Promise<Proposal[]> {
    return this.exclusive(async () =>
      [...this.proposalMap.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((p) => structuredClone(p)),
    );
  }
  async submit(id: string, requestId: string, source: Source, confirm = false): Promise<Proposal> {
    return this.exclusive(async () => {
      if (!requestId || requestId.length > 200)
        coded('VALIDATION_ERROR', '提交必须提供有效 requestId');
      const p = this.proposalMap.get(id);
      if (!p) coded('NOT_FOUND', '提案不存在', 404);
      const proposal = p!;
      if (this.requestMap[requestId] && this.requestMap[requestId] !== id)
        coded('CONFLICT', 'requestId 已用于另一条提案', 409);
      if (confirm && source !== 'user') coded('FORBIDDEN', '只有网页用户可以确认 AI 提案', 403);
      if (source !== 'user' && source !== proposal.source)
        coded('FORBIDDEN', '不能提交其他来源的提案', 403);
      this.requestMap[requestId] = id;
      await atomicWrite(join(this.localDir, 'requests.json'), serialize(this.requestMap));
      if (
        proposal.status === 'applied' ||
        proposal.status === 'rejected' ||
        proposal.status === 'conflict'
      )
        return structuredClone(proposal);
      try {
        const current = await this.readNow(proposal.target);
        this.assertWritable(current);
        this.assertBase(current, proposal.baseHash, proposal.baseRevision);
        const settings = await this.getModelConfig();
        if (
          proposal.source !== 'user' &&
          !confirm &&
          settings.approvalMode === 'require_confirmation'
        ) {
          proposal.status = 'pending_confirmation';
          delete proposal.error;
          await this.saveProposal(proposal);
          this.notify();
          return structuredClone(proposal);
        }
        if (
          (proposal.dependsOn ?? []).some(
            (dependency) => this.proposalMap.get(dependency)?.status !== 'applied',
          )
        ) {
          proposal.status = 'pending_confirmation';
          proposal.error = '前置提案尚未成功应用，完成前置提案后可以再次提交';
          await this.saveProposal(proposal);
          this.notify();
          return structuredClone(proposal);
        }
        this.validateContent(proposal.target, proposal.after);
        if (
          proposal.target === 'workspace' &&
          JSON.parse(proposal.after).revision !== (current.revision ?? 0) + 1
        )
          coded('CONFLICT', '提案版本不合法', 409);
        const approval =
          proposal.source === 'user' ? 'manual' : confirm ? 'web_confirmation' : 'auto_accept';
        const committedAt = this.now();
        // IDs and user-controlled content stay frozen. System timestamps describe execution, not preview.
        if (proposal.target === 'workspace' && !proposal.restoreOf) {
          const before = current.data as Workspace;
          const after = JSON.parse(proposal.after) as Workspace;
          const previous = new Map(before.tasks.map((task) => [task.id, task]));
          for (const task of after.tasks) {
            const old = previous.get(task.id);
            if (!old) task.createdAt = committedAt;
            if (!old || serialize(task) !== serialize(old)) task.updatedAt = committedAt;
            if (task.status === 'done' && old?.status !== 'done') task.completedAt = committedAt;
          }
          proposal.after = serialize(normalizeWorkspace(validateWorkspace(after)));
        }
        const completionEvents =
          proposal.target === 'workspace' && !proposal.restoreOf
            ? completionChanges(current.data as Workspace, JSON.parse(proposal.after))
            : [];
        const change = await this.commit(
          {
            target: proposal.target,
            before: proposal.before,
            after: proposal.after,
            source: proposal.source,
            approval,
            summary: proposal.summary,
            requestId,
            proposalId: proposal.id,
            restoreOf: proposal.restoreOf,
            completionEvents,
          },
          current.hash,
          committedAt,
        );
        proposal.status = 'applied';
        proposal.changeId = change.id;
        delete proposal.error;
        await this.saveProposal(proposal);
        this.notify();
        return structuredClone(proposal);
      } catch (error) {
        proposal.status =
          error instanceof DomainError &&
          ['CONFLICT', 'EXTERNAL_CHANGE', 'READ_ONLY'].includes(error.code)
            ? 'conflict'
            : 'failed';
        proposal.error = error instanceof Error ? error.message : '保存失败';
        await this.saveProposal(proposal);
        this.notify();
        return structuredClone(proposal);
      }
    });
  }
  private async commit(
    input: Pick<
      Change,
      | 'target'
      | 'before'
      | 'after'
      | 'source'
      | 'approval'
      | 'summary'
      | 'requestId'
      | 'completionEvents'
    > &
      Partial<Pick<Change, 'proposalId' | 'restoreOf'>>,
    expectedDiskHash: string | null,
    committedAt = this.now(),
  ): Promise<Change> {
    const change: Change = {
      ...input,
      id: `${committedAt.replace(/[:.]/g, '-')}_${randomUUID()}`,
      createdAt: committedAt,
      beforeHash: hashContent(input.before),
      afterHash: hashContent(input.after)!,
      status: 'prepared',
    };
    await this.options.failpoint?.('before_history');
    await this.saveChange(change);
    this.changes.push(change);
    try {
      await this.options.failpoint?.('after_prepared');
      const disk = await textFile(this.targetPath(input.target));
      if (hashContent(disk) !== expectedDiskHash) {
        change.status = 'aborted';
        await this.saveChange(change);
        coded('CONFLICT', '写入前文件再次变化，已停止保存', 409);
      }
      await this.options.failpoint?.('before_replace');
      await atomicWrite(this.targetPath(input.target), input.after);
      await this.options.failpoint?.('after_replace');
      await this.options.failpoint?.('before_commit');
      change.status = 'committed';
      await this.saveChange(change);
      this.known.set(input.target, input.after);
      await this.saveKnown();
    } catch (error) {
      if (change.status === 'aborted') throw error;
      change.status = 'prepared';
      this.readonlyReasons.set(input.target, '保存结果待恢复；请重启服务以核验目标文件和恢复记录');
      coded('SAVE_UNCERTAIN', `保存未能完成，请重启核验恢复记录：${(error as Error).message}`, 503);
    }
    return change;
  }
  async reject(id: string): Promise<Proposal> {
    return this.exclusive(async () => {
      const p = this.proposalMap.get(id);
      if (!p) coded('NOT_FOUND', '提案不存在', 404);
      if (p!.status === 'applied') coded('CONFLICT', '已应用的提案不能拒绝，请使用历史恢复', 409);
      p!.status = 'rejected';
      await this.saveProposal(p!);
      this.notify();
      return structuredClone(p!);
    });
  }
  async history(target?: Target): Promise<Change[]> {
    if (target) this.targetPath(target);
    return this.exclusive(async () =>
      this.changes
        .filter((c) => !target || c.target === target)
        .slice()
        .reverse()
        .map((c) => structuredClone(c)),
    );
  }
  async restore(
    changeId: string,
    side: 'before' | 'after',
    baseHash: string | null,
    source: Source,
  ): Promise<Proposal> {
    return this.exclusive(async () => {
      if (side !== 'before' && side !== 'after')
        coded('VALIDATION_ERROR', '恢复范围必须是 before 或 after');
      const change = this.changes.find((c) => c.id === changeId && c.status === 'committed');
      if (!change) coded('NOT_FOUND', '已提交的历史版本不存在', 404);
      const current = await this.readNow(change!.target);
      this.assertWritable(current);
      if (current.hash !== baseHash) coded('CONFLICT', '恢复基准已变化', 409);
      let after = change![side] ?? '';
      if (change!.target === 'workspace') {
        const w = normalizeWorkspace(validateWorkspace(JSON.parse(after)));
        w.revision = (current.revision ?? 0) + 1;
        after = serialize(w);
      }
      const p: Proposal = {
        id: randomUUID(),
        target: change!.target,
        baseHash,
        baseRevision: current.revision,
        operations: [],
        summary: `恢复${change!.target === 'workspace' ? '整个工作区快照' : '单篇文档'} · ${side === 'before' ? '修改前' : '修改后'}`,
        source,
        before: this.known.get(change!.target) ?? null,
        after,
        createdAt: this.now(),
        status: 'preview',
        restoreOf: changeId,
      };
      await this.saveProposal(p);
      this.notify();
      return structuredClone(p);
    });
  }
  async resolveExternal(
    target: Target,
    action: 'adopt' | 'restore',
    expectedHash: string | null,
  ): Promise<Snapshot> {
    return this.exclusive(async () => {
      if (this.globalReadOnly) coded('READ_ONLY', this.globalReadOnly, 409);
      if (action !== 'adopt' && action !== 'restore')
        coded('VALIDATION_ERROR', '未知外部修改处理方式');
      const current = await this.readNow(target);
      const disk = await textFile(this.targetPath(target));
      if (hashContent(disk) !== expectedHash)
        coded('CONFLICT', '外部文件再次变化，请重新检查差异', 409);
      if (!current.external && !this.readonlyReasons.has(target))
        coded('CONFLICT', '没有待处理的外部修改', 409);
      let after = action === 'adopt' ? disk : (this.known.get(target) ?? null);
      this.validateContent(target, after);
      if (target === 'workspace') {
        const w = normalizeWorkspace(validateWorkspace(JSON.parse(after!)));
        w.revision = Math.max(current.revision ?? 0, w.revision) + 1;
        after = serialize(w);
      } else after ??= '';
      await this.commit(
        {
          target,
          before: action === 'adopt' ? (this.known.get(target) ?? null) : disk,
          after: after!,
          source: 'external',
          approval: `external_${action}`,
          summary: action === 'adopt' ? '采纳外部编辑' : '恢复外部编辑前内容',
          requestId: randomUUID(),
          completionEvents: [],
        },
        expectedHash,
      );
      for (const c of this.changes)
        if (c.target === target && (c.status === 'uncertain' || c.status === 'prepared')) {
          c.status = 'aborted';
          await this.saveChange(c);
        }
      this.readonlyReasons.delete(target);
      this.notify();
      return this.readNow(target);
    });
  }
  async getPreferences(): Promise<Preferences> {
    const raw = await textFile(join(this.dataDir, 'preferences.json'));
    if (!raw) return structuredClone(defaults);
    try {
      return preferencesSchema.parse(JSON.parse(raw));
    } catch {
      return coded(
        'INVALID_PREFERENCES',
        'preferences.json 损坏；请保留备份并修复，未覆盖原文件',
        409,
      );
    }
  }
  async updatePreferences(patch: Partial<Preferences>): Promise<Preferences> {
    return this.exclusive(async () => {
      const parsed = preferencesSchema.partial().safeParse(patch);
      if (!parsed.success) coded('VALIDATION_ERROR', parsed.error.message);
      const preferences = preferencesSchema.parse({
        ...(await this.getPreferences()),
        ...parsed.data,
      });
      await atomicWrite(join(this.dataDir, 'preferences.json'), serialize(preferences));
      this.notify();
      return preferences;
    });
  }
  async getModelConfig(): Promise<ModelConfig> {
    const raw = await textFile(join(this.localDir, 'secrets.json'));
    if (!raw) return { ...modelDefaults };
    try {
      const value = settingsPatchSchema.parse(JSON.parse(raw));
      return { ...modelDefaults, ...value };
    } catch {
      return coded('INVALID_SETTINGS', '本机设置损坏；未覆盖 secrets.json', 409);
    }
  }
  async getSettings(): Promise<UserSettings> {
    const { apiKey, ...settings } = await this.getModelConfig();
    return { ...settings, hasApiKey: Boolean(apiKey) };
  }
  async updateSettings(
    patch: Partial<Omit<UserSettings, 'hasApiKey'>> & { apiKey?: string },
  ): Promise<UserSettings> {
    return this.exclusive(async () => {
      const parsed = settingsPatchSchema.safeParse(patch);
      if (!parsed.success) coded('VALIDATION_ERROR', parsed.error.message);
      const value = { ...(await this.getModelConfig()), ...parsed.data };
      if (value.baseUrl) {
        let url: URL;
        try {
          url = new URL(value.baseUrl);
        } catch {
          coded('VALIDATION_ERROR', '接口基础地址无效');
        }
        if (
          !['http:', 'https:'].includes(url!.protocol) ||
          url!.username ||
          url!.password ||
          url!.search ||
          url!.hash
        )
          coded('VALIDATION_ERROR', '接口地址必须是没有凭据、查询和片段的 HTTP(S) 地址');
      }
      await atomicWrite(join(this.localDir, 'secrets.json'), serialize(value));
      this.notify();
      return this.getSettings();
    });
  }
  async listDocuments(): Promise<{ target: Target; title: string }[]> {
    return this.exclusive(async () => {
      const result: { target: Target; title: string }[] = [];
      for (const kind of ['daily', 'notes'] as const) {
        let files: string[];
        try {
          files = await readdir(join(this.dataDir, 'reflections', kind));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        for (const file of files
          .filter((f) => f.endsWith('.md'))
          .sort()
          .reverse()) {
          const target = `${kind}/${file.slice(0, -3)}` as Target;
          try {
            const snapshot = await this.readNow(target);
            const line = (snapshot.data as string).split('\n').find((l) => l.trim());
            result.push({
              target,
              title: line?.replace(/^#+\s*/, '').slice(0, 120) || file.slice(0, -3),
            });
          } catch {
            /* Ignore files outside the documented logical naming convention. */
          }
        }
      }
      return result;
    });
  }
  async close(): Promise<void> {
    await this.queue;
    this.closed = true;
    await this.releaseLock();
  }
}
