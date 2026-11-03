import { TaskFields } from './TaskFields';
import { taskPath } from '../domain/tree';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Archive,
  Check,
  ChevronDown,
  FileText,
  History,
  LoaderCircle,
  Plus,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Change,
  ChatResult,
  Operation,
  Placement,
  Preferences,
  Proposal,
  Snapshot,
  Target,
  Task,
  UserSettings,
  Workspace,
} from '../domain/types';
import { api, commit, readDocument } from './api';
import { clockLabel, localInput, localToUTC, today, taskOnDay } from './time';
import s from './App.module.css';
export const statusLabels = { todo: '待办', in_progress: '进行中', done: '已完成' };
export type Save = (operations: Operation[], summary: string) => Promise<boolean>;
export type Notify = (message: string, error?: boolean) => void;
export interface PanelProps {
  workspace: Workspace;
  save: Save;
  refresh: () => Promise<void>;
  notify: Notify;
}
export function TaskDetail({
  task,
  workspace,
  save,
  notify,
}: {
  task: Task;
  workspace: Workspace;
  save: Save;
  notify: Notify;
}) {
  const [draft, setDraft] = useState(task);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(task), [task.id, task.updatedAt]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await save(
        [
          {
            type: 'task.update',
            id: task.id,
            patch: {
              title: draft.title,
              description: draft.description,
              status: draft.status,
              parentId: draft.parentId,
              tagIds: draft.tagIds,
            },
          },
        ],
        '更新任务详情',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.panelContent}>
      <h2>为当下留一点空间</h2>
      <form onSubmit={submit} className={s.form}>
        <TaskFields
          workspace={workspace}
          draft={draft}
          taskId={task.id}
          onChange={(fields) => setDraft({ ...draft, ...fields })}
        />
        <label>
          状态
          <select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as Task['status'] })}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className={s.primary} disabled={busy}>
          {busy ? <LoaderCircle className={s.spin} size={15} /> : <Check size={15} />}保存详情
        </button>
      </form>
      <div className={s.sectionHeading}>
        <h3>
          安排 <span>{task.placements.length}</span>
        </h3>
      </div>
      <p className={s.hint}>同一任务可安排多次。重叠由你决定。</p>
      {task.placements.map((p) => (
        <PlacementEditor key={p.id} placement={p} task={task} save={save} notify={notify} />
      ))}
      <PlacementEditor task={task} save={save} notify={notify} />
      <div className={s.sectionHeading}>
        <h3>任务管理</h3>
      </div>
      <div className={s.buttonRow}>
        <button
          onClick={() =>
            void save(
              [
                {
                  type: 'task.update',
                  id: task.id,
                  patch: { archivedAt: task.archivedAt ? null : new Date().toISOString() },
                },
              ],
              task.archivedAt ? '恢复任务' : '归档任务',
            )
          }
        >
          <Archive size={14} />
          {task.archivedAt ? '恢复任务' : '归档任务'}
        </button>
        <button
          aria-label="上移任务"
          onClick={() =>
            void save(
              [{ type: 'task.update', id: task.id, patch: { order: task.order - 1.5 } }],
              '调整任务排序',
            )
          }
        >
          <ArrowUp size={14} />
        </button>
        <button
          aria-label="下移任务"
          onClick={() =>
            void save(
              [{ type: 'task.update', id: task.id, patch: { order: task.order + 1.5 } }],
              '调整任务排序',
            )
          }
        >
          <ArrowDown size={14} />
        </button>
      </div>
      <p className={s.hint}>
        {task.createdAt === '1970-01-01T00:00:00.000Z'
          ? '创建时间未知（旧数据）'
          : '创建于 ' +
            new Date(task.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
      </p>
    </div>
  );
}
function PlacementEditor({
  placement,
  task,
  save,
  notify,
}: {
  placement?: Placement;
  task: Task;
  save: Save;
  notify: Notify;
}) {
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<'day' | 'timed'>(placement?.kind ?? 'day'),
    [date, setDate] = useState(placement?.kind === 'day' ? placement.date : today()),
    [start, setStart] = useState(
      placement?.kind === 'timed' ? localInput(placement.startAt) : `${today()}T09:00`,
    ),
    [end, setEnd] = useState(
      placement?.kind === 'timed' ? localInput(placement.endAt) : `${today()}T10:00`,
    ),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (placement) {
      setKind(placement.kind);
      if (placement.kind === 'day') setDate(placement.date);
      else {
        setStart(localInput(placement.startAt));
        setEnd(localInput(placement.endAt));
      }
    }
  }, [JSON.stringify(placement)]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p: Placement =
        kind === 'day'
          ? { id: placement?.id ?? crypto.randomUUID(), kind, date }
          : {
              id: placement?.id ?? crypto.randomUUID(),
              kind,
              startAt: localToUTC(start),
              endAt: localToUTC(end),
            };
      if (
        await save(
          [{ type: 'placement.put', taskId: task.id, placement: p }],
          placement ? '修改安排' : '添加安排',
        )
      )
        setOpen(false);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.placementEditor}>
      {placement ? (
        <div className={s.placementSummary}>
          <button onClick={() => setOpen(!open)}>
            <span>
              {placement.kind === 'day'
                ? `${placement.date} · 未定时`
                : `${localInput(placement.startAt).replace('T', ' ')} → ${localInput(placement.endAt).replace('T', ' ')}`}
            </span>
            <ChevronDown size={14} />
          </button>
          <button
            aria-label="删除这次安排"
            onClick={() =>
              void save(
                [{ type: 'placement.remove', taskId: task.id, id: placement.id }],
                '删除一次安排',
              )
            }
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <button className={s.addPlacement} onClick={() => setOpen(!open)}>
          <Plus size={15} />
          添加一次安排
        </button>
      )}
      {open && (
        <form onSubmit={submit} className={s.form}>
          <label>
            安排形式
            <select
              aria-label="安排形式"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'day' | 'timed')}
            >
              <option value="day">仅指定日期</option>
              <option value="timed">指定起止时间</option>
            </select>
          </label>
          {kind === 'day' ? (
            <label>
              日期
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          ) : (
            <>
              <label>
                开始
                <input
                  aria-label="开始时间"
                  type="datetime-local"
                  required
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                结束
                <input
                  aria-label="结束时间"
                  type="datetime-local"
                  required
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </>
          )}
          <button className={s.primary} disabled={busy}>
            保存安排
          </button>
        </form>
      )}
    </div>
  );
}
export function FilterPanel({
  workspace,
  preferences,
  update,
}: {
  workspace: Workspace;
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => void;
}) {
  const toggle = (key: 'hiddenTags' | 'hiddenTasks' | 'hiddenStatuses', id: string) =>
    update({
      [key]: (preferences[key] as string[]).includes(id)
        ? (preferences[key] as string[]).filter((v) => v !== id)
        : [...preferences[key], id],
    });
  return (
    <div className={s.panelContent}>
      <h2>只看此刻想看的</h2>
      <p className={s.hint}>筛选只改变显示。AI 的任务范围单独选择。</p>
      <button
        onClick={() =>
          update({
            hiddenTags: [],
            hiddenTasks: [],
            hiddenStatuses: [],
            showArchived: false,
          })
        }
      >
        <RotateCcw size={14} />
        清除全部筛选
      </button>
      {(
        [
          ['标签', 'hiddenTags', workspace.tags.map((x) => ({ id: x.id, title: x.name }))],
          [
            '任务',
            'hiddenTasks',
            workspace.tasks.map((t) => ({ id: t.id, title: taskPath(t, workspace.tasks) })),
          ],
          [
            '状态',
            'hiddenStatuses',
            Object.entries(statusLabels).map(([id, title]) => ({ id, title })),
          ],
        ] as const
      ).map(([title, key, items]) => (
        <section key={key}>
          <h3>{title}</h3>
          {items.map((item) => (
            <label className={s.checkRow} key={item.id}>
              <input
                type="checkbox"
                checked={!(preferences[key] as string[]).includes(item.id)}
                onChange={() => toggle(key, item.id)}
              />
              <span>{item.title}</span>
            </label>
          ))}
        </section>
      ))}
      <label className={s.checkRow}>
        <input
          type="checkbox"
          checked={preferences.showArchived}
          onChange={(e) => update({ showArchived: e.target.checked })}
        />
        包含已归档内容
      </label>
    </div>
  );
}
export function OrganizationPanel({ workspace, save }: PanelProps) {
  const [name, setName] = useState('');
  return (
    <div className={s.panelContent}>
      <h2>标签管理</h2>
      <p className={s.hint}>标签可多选，不分层级；名称不能包含 /。</p>
      <form
        className={s.form}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save([{ type: 'tag.create', name: name.trim() }], '创建标签')) setName('');
        }}
      >
        <label>
          标签名称
          <input
            aria-label="新标签名称"
            required
            pattern={'[^\\/]+'}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className={s.primary}>创建标签</button>
      </form>
      {workspace.tags.map((tag) => (
        <TagEditor key={tag.id + tag.name} tag={tag} save={save} />
      ))}
    </div>
  );
}
function TagEditor({ tag, save }: { tag: Workspace['tags'][number]; save: Save }) {
  const [name, setName] = useState(tag.name);
  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        void save([{ type: 'tag.update', id: tag.id, patch: { name: name.trim() } }], '更新标签');
      }}
    >
      <label>
        标签名称
        <input
          required
          pattern={'[^\\/]+'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className={s.buttonRow}>
        <button>保存标签</button>
        <button
          type="button"
          onClick={() =>
            void save(
              [
                {
                  type: 'tag.update',
                  id: tag.id,
                  patch: { archivedAt: tag.archivedAt ? null : new Date().toISOString() },
                },
              ],
              '更改标签归档状态',
            )
          }
        >
          {tag.archivedAt ? '恢复标签' : '归档标签'}
        </button>
      </div>
    </form>
  );
}
export function DocumentEditor({
  target,
  title,
  notify,
  onSaved,
}: {
  target: Target;
  title: string;
  notify: Notify;
  onSaved?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot<string>>(),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [remoteChanged, setRemoteChanged] = useState(false);
  const documentRef = useRef({ snapshot, dirty, busy });
  const loadSequence = useRef(0);
  documentRef.current = { snapshot, dirty, busy };
  const load = () => {
    const sequence = ++loadSequence.current;
    return readDocument(target)
      .then((v) => {
        if (sequence !== loadSequence.current) return;
        setSnapshot(v);
        setText(v.data);
        setDirty(false);
        setRemoteChanged(false);
      })
      .catch((e) => notify(e.message, true));
  };
  useEffect(() => {
    void load();
    const check = async () => {
      try {
        const current = await readDocument(target),
          state = documentRef.current;
        if (!state.snapshot || state.busy) return;
        if (state.dirty) {
          if (current.hash !== state.snapshot.hash) setRemoteChanged(true);
          setSnapshot((prev) =>
            prev ? { ...prev, external: current.external, readOnly: current.readOnly } : current,
          );
        } else {
          setSnapshot(current);
          setText(current.data);
          setRemoteChanged(false);
        }
      } catch {
        /* Connection state is displayed by the workbench. */
      }
    };
    const timer = setInterval(() => void check(), 4000);
    return () => {
      clearInterval(timer);
      loadSequence.current++;
    };
  }, [target]);
  const save = async () => {
    if (!snapshot) return;
    setBusy(true);
    try {
      await commit(snapshot, [{ type: 'text.write', content: text }], `更新${title}`);
      await load();
      notify('已保存');
      onSaved?.();
    } catch (e) {
      notify(
        (e as Error).message,
        true,
      ); /* Keep the original hash after a conflict; an explicit reload discards the draft. */
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={s.docEditor}>
      <h3>{title}</h3>
      {remoteChanged && (
        <p className={s.warning}>
          文件已有较新修改，草稿尚未保存。请先复制需保留的草稿，再点“重新载入”读取并重新编辑。
        </p>
      )}
      {snapshot?.external && <ExternalNotice snapshot={snapshot} reload={load} notify={notify} />}
      <textarea
        aria-label={title}
        disabled={!snapshot || busy}
        rows={target.startsWith('daily/') ? 8 : 7}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        placeholder={
          title === '长期背景'
            ? '角色、工作方式、持续关注的目标…'
            : title === '短期安排'
              ? '近期约束、本周重点、临时变化…'
              : '今天发生了什么？留下几句话就好。'
        }
      />
      <div className={s.docFooter}>
        <span>
          {dirty ? '尚未保存' : '本地 Markdown'} · {text.length} 字
        </span>
        <button disabled={busy} onClick={() => void load()} title="丢弃当前草稿并重新读取文件">
          重新载入
        </button>
        <button
          className={s.primary}
          disabled={
            !snapshot || busy || !!snapshot.external || !!snapshot.readOnly || remoteChanged
          }
          onClick={() => void save()}
        >
          {busy ? <LoaderCircle size={14} className={s.spin} /> : <Check size={14} />}保存
        </button>
      </div>
    </section>
  );
}
export function BackgroundPanel({ notify }: { notify: Notify }) {
  return (
    <div className={s.panelContent}>
      <h2>让 AI 了解你的节奏</h2>
      <p className={s.hint}>每次对话都会重新加载这两份背景。反思只在当次主动选择后读取。</p>
      <DocumentEditor target="long-term" title="长期背景" notify={notify} />
      <DocumentEditor target="short-term" title="短期安排" notify={notify} />
    </div>
  );
}
export function ReviewPanel({ notify, workspace }: { notify: Notify; workspace: Workspace }) {
  const [date, setDate] = useState(today()),
    [review, setReview] = useState<{
      planned: Task[];
      completed: { taskId: string; title: string; completedAt: string }[];
    }>(),
    [docs, setDocs] = useState<{ target: Target; title: string }[]>([]),
    [selected, setSelected] = useState<Target>(),
    [title, setTitle] = useState('');
  const loadDocs = () =>
    api<{ target: Target; title: string }[]>('/documents/list')
      .then(setDocs)
      .catch((e) => notify(e.message, true));
  useEffect(() => {
    void api<typeof review>(`/review?date=${date}`)
      .then(setReview)
      .catch((e) => notify(e.message, true));
    void loadDocs();
  }, [date, workspace.revision]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const target: Target = `notes/${crypto.randomUUID()}`;
    try {
      const doc = await readDocument(target);
      await commit(doc, [{ type: 'text.write', content: `# ${title}\n\n` }], `创建反思：${title}`);
      await loadDocs();
      setSelected(target);
      setTitle('');
    } catch (error) {
      notify((error as Error).message, true);
    }
  };
  return (
    <div className={s.panelContent}>
      <h2>每天，留一点回望</h2>
      <input
        aria-label="复盘日期"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <div className={s.reviewStats}>
        <div>
          <strong>{review?.planned.length ?? '—'}</strong>
          <span>当日安排</span>
        </div>
        <div>
          <strong>{review?.completed.length ?? '—'}</strong>
          <span>当日完成事件</span>
        </div>
      </div>
      <h3>计划与当前状态</h3>
      {review?.planned.length ? (
        review.planned.map((t) => (
          <div className={s.reviewItem} key={t.id}>
            <span>{t.title}</span>
            <small>{statusLabels[t.status]}</small>
          </div>
        ))
      ) : (
        <p className={s.hint}>这一天还没有安排。</p>
      )}
      <h3>当天完成过</h3>
      {review?.completed.length ? (
        review.completed.map((t, i) => (
          <div className={s.reviewItem} key={`${t.taskId}-${i}`}>
            <span>
              <Check size={13} />
              {t.title}
            </span>
            <small>{clockLabel(t.completedAt)}</small>
          </div>
        ))
      ) : (
        <p className={s.hint}>还没有完成记录。完成后重新打开任务，记录仍会保留。</p>
      )}
      <DocumentEditor key={date} target={`daily/${date}`} title="每日反思" notify={notify} />
      <h3>独立反思</h3>
      <form className={s.inlineForm} onSubmit={(e) => void create(e)}>
        <input
          aria-label="独立反思标题"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="为一次回望起个名字"
        />
        <button aria-label="新建独立反思">
          <Plus size={16} />
        </button>
      </form>
      <select
        aria-label="选择独立反思"
        value={selected ?? ''}
        onChange={(e) => setSelected((e.target.value || undefined) as Target | undefined)}
      >
        <option value="">选择一篇反思</option>
        {docs
          .filter((d) => d.target.startsWith('notes/'))
          .map((d) => (
            <option value={d.target} key={d.target}>
              {d.title}
            </option>
          ))}
      </select>
      {selected && (
        <DocumentEditor
          key={selected}
          target={selected}
          title="反思正文"
          notify={notify}
          onSaved={() => void loadDocs()}
        />
      )}
    </div>
  );
}
export function DiffViewer({ before, after }: { before: string | null; after: string }) {
  return (
    <div className={s.diff}>
      <details open>
        <summary>修改前</summary>
        <pre>{before ?? '（尚不存在）'}</pre>
      </details>
      <details open>
        <summary>修改后</summary>
        <pre>{after}</pre>
      </details>
    </div>
  );
}
export function ExternalNotice({
  snapshot,
  reload,
  notify,
}: {
  snapshot: Snapshot;
  reload: () => Promise<unknown>;
  notify: Notify;
}) {
  const [show, setShow] = useState(false);
  const external = snapshot.external;
  if (!external) return null;
  const resolve = async (action: 'adopt' | 'restore') => {
    try {
      await api('/external', { target: snapshot.target, action, expectedHash: external.hash });
      await reload();
      notify(action === 'adopt' ? '已采纳外部编辑并记录历史' : '已恢复最近有效内容');
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  return (
    <div className={s.externalNotice}>
      <b>发现文件在入口之外被修改</b>
      <p>
        {external.valid
          ? '请检查差异，再采纳或恢复。'
          : (external.error ?? '外部内容校验失败，当前有效状态已保留。')}
      </p>
      <div className={s.buttonRow}>
        <button onClick={() => setShow(!show)}>查看差异</button>
        <button disabled={!external.valid} onClick={() => void resolve('adopt')}>
          采纳外部编辑
        </button>
        <button onClick={() => void resolve('restore')}>恢复有效内容</button>
      </div>
      {show && (
        <DiffViewer
          before={
            typeof snapshot.data === 'string'
              ? snapshot.data
              : JSON.stringify(snapshot.data, null, 2)
          }
          after={external.content ?? '（文件已删除）'}
        />
      )}
    </div>
  );
}
export function HistoryPanel({
  notify,
  refresh,
}: {
  notify: Notify;
  refresh: () => Promise<void>;
}) {
  const [allChanges, setChanges] = useState<Change[]>([]),
    [target, setTarget] = useState(''),
    [selected, setSelected] = useState<Change>(),
    [preview, setPreview] = useState<Proposal>(),
    [busy, setBusy] = useState(false);
  const loadSequence = useRef(0);
  const changes = allChanges.filter((change) => !target || change.target === target);
  const load = () => {
    const sequence = ++loadSequence.current;
    return api<Change[]>('/history')
      .then((entries) => {
        if (sequence === loadSequence.current) setChanges(entries);
      })
      .catch((e) => notify(e.message, true));
  };
  useEffect(() => {
    void load();
  }, [target]);
  const restore = async (change: Change, side: 'before' | 'after') => {
    setBusy(true);
    try {
      const snap =
        change.target === 'workspace'
          ? await api<Snapshot>('/workspace')
          : await readDocument(change.target);
      setPreview(
        await api<Proposal>('/restore', { changeId: change.id, side, baseHash: snap.hash }),
      );
      setSelected(change);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await api<Proposal>(`/proposals/${preview.id}/submit`, {
        requestId: crypto.randomUUID(),
      });
      if (result.status !== 'applied') throw new Error(result.error ?? result.status);
      setPreview(undefined);
      await load();
      await refresh();
      notify('已恢复，并生成新的历史记录');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.panelContent}>
      <h2>修改历史</h2>
      <p className={s.hint}>
        恢复工作数据会影响整个任务树、标签和排期快照；恢复文档只影响该文档。恢复会保留旧历史。
      </p>
      <select
        aria-label="历史目标"
        disabled={busy}
        value={target}
        onChange={(e) => {
          setTarget(e.target.value);
          setSelected(undefined);
          setPreview(undefined);
        }}
      >
        <option value="">全部目标</option>
        {[...new Set(allChanges.map((c) => c.target))].map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      {changes.find((c) => c.status === 'committed') && (
        <button
          className={s.undo}
          disabled={busy}
          onClick={() =>
            void restore(
              changes.find((c) => c.status === 'committed')!,
              'before',
            )
          }
        >
          <RotateCcw size={14} />
          撤销最近一次修改
        </button>
      )}
      {changes.length === 0 && <p className={s.hint}>开始安排后，修改会留在这里。</p>}
      {changes.map((c) => (
        <div className={s.historyEntry} key={c.id}>
          <button
            className={s.historyTitle}
            onClick={() => {
              setSelected(selected?.id === c.id ? undefined : c);
              setPreview(undefined);
            }}
          >
            <History size={15} />
            <span>
              {c.summary}
              <small>
                {new Date(c.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} ·{' '}
                {c.source} · {c.approval}
              </small>
              <small>
                {c.target} · {c.status}
              </small>
            </span>
          </button>
          {selected?.id === c.id && (
            <>
              <DiffViewer before={c.before} after={c.after} />
              <div className={s.buttonRow}>
                <button
                  disabled={busy || c.status !== 'committed'}
                  onClick={() => void restore(c, 'before')}
                >
                  预览恢复到修改前
                </button>
                <button
                  disabled={busy || c.status !== 'committed'}
                  onClick={() => void restore(c, 'after')}
                >
                  预览恢复到此版本
                </button>
              </div>
            </>
          )}
        </div>
      ))}
      {preview && (
        <div className={s.restorePreview}>
          <h3>恢复预览 · {preview.target}</h3>
          <DiffViewer before={preview.before} after={preview.after} />
          <button disabled={busy} className={s.primary} onClick={() => void submit()}>
            确认恢复
          </button>
          <button onClick={() => setPreview(undefined)}>取消</button>
        </div>
      )}
    </div>
  );
}
export function SettingsPanel({ notify, onSettings }: { notify: Notify; onSettings: () => void }) {
  const [settings, setSettings] = useState<UserSettings>(),
    [apiKey, setKey] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<UserSettings>('/settings')
      .then(setSettings)
      .catch((e) => notify(e.message, true));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    try {
      setSettings(
        await api<UserSettings>(
          '/settings',
          {
            approvalMode: settings.approvalMode,
            baseUrl: settings.baseUrl,
            model: settings.model,
            toolSupport: settings.toolSupport,
            ...(apiKey ? { apiKey } : {}),
          },
          'PATCH',
        ),
      );
      setKey('');
      notify('设置已保存');
      onSettings();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  if (!settings) return <div className={s.panelContent}>正在读取设置…</div>;
  return (
    <div className={s.panelContent}>
      <h2>AI 与本机设置</h2>
      <form className={s.form} onSubmit={(e) => void submit(e)}>
        <label>
          AI 写入策略
          <select
            aria-label="AI 写入策略"
            value={settings.approvalMode}
            onChange={(e) =>
              setSettings({
                ...settings,
                approvalMode: e.target.value as UserSettings['approvalMode'],
              })
            }
          >
            <option value="require_confirmation">必须网页确认（默认）</option>
            <option value="auto_accept">自动接受</option>
          </select>
        </label>
        <p className={s.hint}>
          网页 AI
          与外部工具共用此策略。自动接受仍校验版本并保留可恢复历史；已有待确认提案不会批量执行。
        </p>
        <label>
          API 基础地址
          <input
            type="url"
            placeholder="https://api.example.com/v1"
            value={settings.baseUrl}
            onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
          />
        </label>
        <label>
          模型名
          <input
            placeholder="供应商提供的模型名称"
            value={settings.model}
            onChange={(e) => setSettings({ ...settings, model: e.target.value })}
          />
        </label>
        <label>
          API 密钥 <small>{settings.hasApiKey ? '已配置；留空保留' : '尚未配置'}</small>
          <input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(e) => setKey(e.target.value)}
            placeholder="仅保存在本机服务端"
          />
        </label>
        <label>
          结构化工具能力
          <select
            value={settings.toolSupport}
            onChange={(e) =>
              setSettings({
                ...settings,
                toolSupport: e.target.value as UserSettings['toolSupport'],
              })
            }
          >
            <option value="auto">自动探测</option>
            <option value="enabled">启用工具调用</option>
            <option value="disabled">仅文字聊天</option>
          </select>
        </label>
        <button className={s.primary} disabled={busy}>
          保存设置
        </button>
        <button
          type="button"
          onClick={() =>
            void api<UserSettings>('/settings', { apiKey: '' }, 'PATCH')
              .then((v) => {
                setSettings(v);
                notify('密钥已清除');
              })
              .catch((e) => notify(e.message, true))
          }
        >
          清除已存密钥
        </button>
      </form>
      <section className={s.infoBox}>
        <h3>你的文件，始终可读</h3>
        <p>
          任务与排期在 <code>data/workspace.json</code>，背景与反思为 Markdown。外部 AI 可通过
          harness 读取上下文、提交提案。
        </p>
        <code>npm run harness -- context</code>
        <p>模型请求会发送本次选定的上下文到配置接口。文件保存在本机，不代表模型推理也在本机。</p>
      </section>
    </div>
  );
}
export function ProposalsPanel({
  proposals,
  refresh,
  notify,
}: {
  proposals: Proposal[];
  refresh: () => Promise<void>;
  notify: Notify;
}) {
  const [open, setOpen] = useState<string>(),
    [busy, setBusy] = useState(false);
  const act = async (p: Proposal, action: 'confirm' | 'reject' | 'submit') => {
    setBusy(true);
    try {
      const result = await api<Proposal>(`/proposals/${p.id}/${action}`, {
        requestId: crypto.randomUUID(),
      });
      if (result.status === 'conflict' || result.status === 'failed')
        throw new Error(result.error ?? '数据已变化，请重新生成提案');
      await refresh();
      notify(
        result.status === 'applied'
          ? '变更已保存'
          : result.status === 'rejected'
            ? '已拒绝提案'
            : `提案状态：${result.status}`,
      );
    } catch (e) {
      notify((e as Error).message, true);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.panelContent}>
      <h2>变更提案</h2>
      <p className={s.hint}>
        确认前查看真实修改。已有变化的目标需重新生成预览。创建、更新和完成时间以实际提交时刻为准；恢复保留原时间。
      </p>
      {proposals.length === 0 && <p className={s.hint}>目前没有提案。</p>}
      {proposals.map((p) => (
        <div className={s.proposal} key={p.id}>
          <button
            className={s.historyTitle}
            onClick={() => setOpen(open === p.id ? undefined : p.id)}
          >
            <FileText size={16} />
            <span>
              {p.summary}
              <small>
                {p.source} · {p.target} · {p.status}
              </small>
            </span>
          </button>
          {p.error && <p className={s.errorText}>{p.error}</p>}
          {(open === p.id || p.status === 'pending_confirmation') && (
            <DiffViewer before={p.before} after={p.after} />
          )}
          <div className={s.buttonRow}>
            {p.status === 'pending_confirmation' && (
              <>
                <button
                  disabled={busy}
                  className={s.primary}
                  onClick={() => void act(p, 'confirm')}
                >
                  <Check size={14} />
                  确认修改
                </button>
                <button disabled={busy} onClick={() => void act(p, 'reject')}>
                  <X size={14} />
                  拒绝
                </button>
              </>
            )}
            {p.status === 'preview' && (
              <button disabled={busy} onClick={() => void act(p, 'submit')}>
                提交提案
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export function AiPanel({
  workspace,
  dates,
  notify,
  refresh,
  onProposals,
}: {
  workspace: Workspace;
  dates: string[];
  notify: Notify;
  refresh: () => Promise<void>;
  onProposals: () => void;
}) {
  const [settings, setSettings] = useState<UserSettings>(),
    [scope, setScope] = useState<'view' | 'all' | 'custom'>('view'),
    [selectedTasks, setTasks] = useState<string[]>([]),
    [docs, setDocs] = useState<{ target: Target; title: string }[]>([]),
    [reflections, setReflections] = useState<Target[]>([]),
    [message, setMessage] = useState(''),
    [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]),
    [conversationId, setConversation] = useState<string>(),
    [requestId, setRequest] = useState<string>(),
    [warning, setWarning] = useState('');
  useEffect(() => {
    void api<UserSettings>('/settings')
      .then(setSettings)
      .catch((e) => notify(e.message, true));
    void api<typeof docs>('/documents/list')
      .then(setDocs)
      .catch((e) => notify(e.message, true));
  }, []);
  const inView = workspace.tasks
    .filter((t) => !t.archivedAt && dates.some((date) => taskOnDay(t, date)))
    .map((t) => t.id);
  const ids =
    scope === 'all'
      ? workspace.tasks.map((t) => t.id)
      : scope === 'custom'
        ? selectedTasks
        : inView;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim() || requestId) return;
    const id = crypto.randomUUID(),
      text = message;
    setRequest(id);
    setMessages((v) => [...v, { role: 'user', text }]);
    setMessage('');
    try {
      const result = await api<ChatResult>('/chat', {
        message: text,
        conversationId,
        requestId: id,
        taskIds: ids,
        reflections,
        startDate: dates[0],
        endDate: dates[dates.length - 1],
      });
      setConversation(result.conversationId);
      setMessages((v) => [
        ...v,
        {
          role: 'assistant',
          text:
            result.text ||
            (result.proposals.length ? '已生成结构化变更，请查看提案。' : '模型没有返回文字。'),
        },
      ]);
      setWarning(
        result.warning ??
          (result.toolCapability === 'disabled'
            ? '此接口当前仅支持文字建议，结构化应用已禁用。'
            : ''),
      );
      if (result.proposals.length) {
        await refresh();
        notify(`生成 ${result.proposals.length} 条提案`);
      }
    } catch (e) {
      notify((e as Error).message, true);
      setMessages((v) => [
        ...v,
        { role: 'assistant', text: `请求未完成：${(e as Error).message}` },
      ]);
    } finally {
      setRequest(undefined);
    }
  };
  return (
    <div className={s.panelContent}>
      <h2>一起理清下一步</h2>
      <p className={s.hint}>
        {settings?.baseUrl || '尚未配置模型接口'}
        <br />
        长期背景、短期安排每次加载；反思由你选择。
      </p>
      <details className={s.contextPicker}>
        <summary>
          本次上下文 · {ids.length} 个任务 · {reflections.length} 篇反思
        </summary>
        <label>
          任务范围
          <select
            aria-label="AI 任务范围"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="view">当前日期范围关联任务</option>
            <option value="all">全部任务</option>
            <option value="custom">自选任务</option>
          </select>
        </label>
        {scope === 'custom' &&
          workspace.tasks.map((t) => (
            <label key={t.id} className={s.checkRow}>
              <input
                type="checkbox"
                checked={selectedTasks.includes(t.id)}
                onChange={(e) =>
                  setTasks((v) => (e.target.checked ? [...v, t.id] : v.filter((id) => id !== t.id)))
                }
              />
              {t.title}
            </label>
          ))}
        <p className={s.hint}>
          {ids.map((id) => workspace.tasks.find((t) => t.id === id)?.title).join('、') ||
            '尚无关联任务，可扩大范围。'}
        </p>
        <h3>仅本次选择的反思</h3>
        {docs
          .filter((d) => d.target.startsWith('daily/') || d.target.startsWith('notes/'))
          .map((d) => (
            <label key={d.target} className={s.checkRow}>
              <input
                type="checkbox"
                checked={reflections.includes(d.target)}
                onChange={(e) => {
                  setReflections((v) =>
                    e.target.checked ? [...v, d.target] : v.filter((t) => t !== d.target),
                  );
                  if (!e.target.checked && conversationId)
                    setWarning('当前会话已有的讨论可能包含该反思内容；可新建会话，避免继续携带。');
                }}
              />
              {d.title}
            </label>
          ))}
      </details>
      <div className={s.buttonRow}>
        <button
          onClick={() => {
            setConversation(undefined);
            setMessages([]);
            setWarning('');
          }}
          disabled={!!requestId}
        >
          <Plus size={14} />
          新建会话
        </button>
        <button onClick={onProposals}>查看变更提案</button>
      </div>
      {warning && <p className={s.warning}>{warning}</p>}
      <div className={s.messages}>
        {messages.length === 0 && (
          <div className={s.aiEmpty}>
            <span>✧</span>
            <h3>从一个小问题开始</h3>
            <p>
              “帮我看看今天的安排。”
              <br />
              “把这个任务拆成几个步骤。”
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`${s.message} ${m.role === 'user' ? s.userMessage : ''}`}>
            <small>{m.role === 'user' ? '你' : 'AI'}</small>
            <p>{m.text}</p>
          </div>
        ))}
        {requestId && (
          <p className={s.hint}>
            <LoaderCircle size={14} className={s.spin} />
            正在思考，可随时取消…
          </p>
        )}
      </div>
      <form className={s.chatForm} onSubmit={(e) => void send(e)}>
        <textarea
          aria-label="AI 消息"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="说说你想整理的事情…"
        />
        <div>
          {requestId ? (
            <button
              type="button"
              onClick={() =>
                void api('/chat/cancel', { requestId }).catch((e) => notify(e.message, true))
              }
            >
              <Square size={13} />
              取消请求
            </button>
          ) : (
            <button className={s.primary} disabled={!message.trim()}>
              <Send size={14} />
              发送
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
