import { minuteLabel, parseClock } from './time';
import { TaskFields } from './TaskFields';
import { taskPath } from '../domain/tree';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  GripVertical,
  MoreHorizontal,
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
  Trash2,
  X,
} from 'lucide-react';
import type {
  Change,
  Operation,
  Placement,
  Preferences,
  Proposal,
  Snapshot,
  Target,
  Task,
  Workspace,
} from '../domain/types';
import { api, commit, readDocument } from './api';
import { clockLabel, localInput, localToUTC, today } from './time';
import { useAppearance } from './presentations/Appearance';
export const statusLabels = { todo: '未完成', done: '已完成' };
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
  const { controls: s } = useAppearance();
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
  const { controls: s } = useAppearance();
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
  const { controls: s } = useAppearance();
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
  const { controls: s } = useAppearance();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#537fc5');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  const tags = [...workspace.tags].sort(
    (a, b) => a.colorPriority - b.colorPriority || a.order - b.order || a.id.localeCompare(b.id),
  );
  const persist: Save = async (ops, summary) => {
    setBusy(true);
    try {
      return await save(ops, summary);
    } finally {
      setBusy(false);
    }
  };
  const reorder = async (from: string, to: string) => {
    if (from === to || busy) return;
    const ordered = [...tags];
    const source = ordered.findIndex((t) => t.id === from);
    const target = ordered.findIndex((t) => t.id === to);
    if (source < 0 || target < 0) return;
    ordered.splice(target, 0, ordered.splice(source, 1)[0]);
    await persist(
      ordered.map((t, i) => ({
        type: 'tag.update',
        id: t.id,
        patch: { order: i, colorPriority: i },
      })),
      '调整标签颜色优先顺序',
    );
  };
  return (
    <div className={s.panelContent}>
      <h2>标签管理</h2>
      <p className={s.hint}>拖动左侧手柄排序，越靠上颜色越优先。名称不能包含 /。</p>
      <div className={s.tagList} aria-label="标签优先顺序">
        {tags.map((tag) => (
          <div
            key={tag.id}
            data-tag-row={tag.id}
            className={`${s.tagRow} ${over === tag.id ? s.tagDrop : ''}`}
            onDragOver={(e) => {
              if (dragging && !busy) {
                e.preventDefault();
                setOver(tag.id);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragging;
              setDragging(undefined);
              setOver(undefined);
              if (from) void reorder(from, tag.id);
            }}
          >
            <button
              className={s.tagHandle}
              aria-label={`拖动 ${tag.name} 排序`}
              disabled={busy}
              draggable={!busy}
              onDragStart={(e) => {
                setDragging(tag.id);
                e.dataTransfer.setData('text/plain', tag.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragging(undefined);
                setOver(undefined);
              }}
              onKeyDown={(e) => {
                const i = tags.findIndex((t) => t.id === tag.id);
                const next = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
                if (next >= 0 && next < tags.length) {
                  e.preventDefault();
                  void reorder(tag.id, tags[next].id);
                }
              }}
            >
              <GripVertical size={16} />
            </button>
            <TagEditor tag={tag} save={persist} busy={busy} />
          </div>
        ))}
      </div>
      <form
        className={s.tagCreate}
        onSubmit={async (e) => {
          e.preventDefault();
          const operations: Operation[] = tags.map((t, i) => ({
            type: 'tag.update',
            id: t.id,
            patch: { colorPriority: i, order: i },
          }));
          operations.push({
            type: 'tag.create',
            name: name.trim(),
            color,
            colorPriority: tags.length,
          });
          if (await persist(operations, '创建标签')) setName('');
        }}
      >
        <input
          className={s.tagColor}
          aria-label="新标签颜色"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          disabled={busy}
        />
        <input
          aria-label="新标签名称"
          placeholder="新标签名称"
          required
          pattern="[^/]+"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <button aria-label="创建标签" title="创建标签" disabled={busy || !name.trim()}>
          <Plus size={17} />
        </button>
      </form>
    </div>
  );
}
function TagEditor({
  tag,
  save,
  busy,
}: {
  tag: Workspace['tags'][number];
  save: Save;
  busy: boolean;
}) {
  const { controls: s } = useAppearance();
  const [name, setName] = useState(tag.name);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleting) deleteDialog.current?.showModal();
  }, [deleting]);
  useEffect(() => setName(tag.name), [tag.name]);
  const rename = async () => {
    if (name.trim() === tag.name) return;
    if (!name.trim() || name.includes('/')) {
      setName(tag.name);
      return;
    }
    if (
      !(await save(
        [{ type: 'tag.update', id: tag.id, patch: { name: name.trim() } }],
        '重命名标签',
      ))
    )
      setName(tag.name);
  };
  return (
    <>
      <input
        className={s.tagColor}
        type="color"
        aria-label={`${tag.name} 颜色`}
        value={tag.color}
        disabled={busy}
        onChange={(e) =>
          void save(
            [{ type: 'tag.update', id: tag.id, patch: { color: e.target.value } }],
            '更新标签颜色',
          )
        }
      />
      <input
        className={s.tagName}
        aria-label={`${tag.name} 名称`}
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void rename()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setName(tag.name);
        }}
      />
      {tag.archivedAt && <small className={s.hint}>已归档</small>}
      <div className={s.tagActions}>
        <button
          aria-label={`${tag.name} 更多操作`}
          aria-expanded={menu}
          disabled={busy}
          onClick={() => setMenu(!menu)}
        >
          <MoreHorizontal size={18} />
        </button>
        {menu && (
          <div
            className={s.tagMenu}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMenu(false);
            }}
          >
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  await save(
                    [
                      {
                        type: 'tag.update',
                        id: tag.id,
                        patch: { archivedAt: tag.archivedAt ? null : new Date().toISOString() },
                      },
                    ],
                    '更改标签归档状态',
                  )
                )
                  setMenu(false);
              }}
            >
              <Archive size={14} />
              {tag.archivedAt ? '恢复标签' : '归档标签'}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setMenu(false);
                setDeleting(true);
              }}
            >
              <Trash2 size={14} />
              删除标签
            </button>
          </div>
        )}
      </div>
      {deleting && (
        <dialog
          ref={deleteDialog}
          onCancel={() => setDeleting(false)}
          className={s.tagDelete}
          aria-label="删除标签确认"
        >
          <p>删除“{tag.name}”并从所有任务中移除该标签？任务本身会保留。</p>
          <div className={s.buttonRow}>
            <button disabled={busy} onClick={() => setDeleting(false)}>
              取消
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                if (await save([{ type: 'tag.remove', id: tag.id }], '删除标签及任务关联'))
                  setDeleting(false);
              }}
            >
              确认删除
            </button>
          </div>
        </dialog>
      )}
    </>
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
  const { controls: s } = useAppearance();
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
  const { controls: s } = useAppearance();
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
  const { controls: s } = useAppearance();
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
  const { controls: s } = useAppearance();
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
  const { controls: s } = useAppearance();
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
  const { controls: s } = useAppearance();
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
export function SettingsPanel({
  preferences,
  updatePreferences,
}: {
  preferences: Preferences;
  updatePreferences: (patch: Partial<Preferences>) => Promise<boolean>;
}) {
  const { controls: s } = useAppearance();
  return (
    <div className={s.panelContent}>
      <h2>工作台设置</h2>
      <WorkbenchSettings preferences={preferences} update={updatePreferences} />
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
  const { controls: s } = useAppearance();
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
function WorkbenchSettings({
  preferences,
  update,
}: {
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => Promise<boolean>;
}) {
  const { controls: s } = useAppearance();
  const [start, setStart] = useState(minuteLabel(preferences.dayStart));
  const [end, setEnd] = useState(minuteLabel(preferences.dayEnd));
  const [inherit, setInherit] = useState(preferences.inheritParentTags);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className={s.form}
      onSubmit={async (e) => {
        e.preventDefault();
        const dayStart = parseClock(start),
          dayEnd = parseClock(end);
        if (!Number.isFinite(dayStart) || !Number.isFinite(dayEnd) || dayStart >= dayEnd) {
          setError('请输入有效的 HH:MM，结束晚于开始，最晚 24:00。');
          return;
        }
        setError('');
        setBusy(true);
        try {
          if (!(await update({ dayStart, dayEnd, inheritParentTags: inherit })))
            setError('设置保存失败，请重试。');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        每天开始时间
        <input
          aria-label="每天开始时间"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
        />
      </label>
      <label>
        每天结束时间
        <input
          aria-label="每天结束时间"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          required
        />
      </label>
      <p className={s.hint}>仅调整时间轴显示与拖选范围，范围外排期保留。结束可填 24:00。</p>
      <label className={s.checkRow}>
        <input type="checkbox" checked={inherit} onChange={(e) => setInherit(e.target.checked)} />
        子任务复制继承父任务标签
      </label>
      <p className={s.hint}>
        新建或更换父任务时复制标签；后续可独立修改。父任务标签变更时另行询问是否同步后代。
      </p>
      {error && (
        <p role="alert" className={s.errorText}>
          {error}
        </p>
      )}
      <button className={s.primary} disabled={busy}>
        保存工作台设置
      </button>
    </form>
  );
}
