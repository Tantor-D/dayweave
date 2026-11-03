import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  CircleDot,
  Columns3,
  Filter,
  Folder,
  History,
  LayoutGrid,
  LoaderCircle,
  Moon,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import type { Operation, Preferences, Proposal, Snapshot, Task, Workspace } from '../domain/types';
import { api, commit, readWorkspace } from './api';
import { Timeline, useScheduleDrag } from './Timeline';
import {
  AiPanel,
  BackgroundPanel,
  ExternalNotice,
  FilterPanel,
  HistoryPanel,
  OrganizationPanel,
  ProposalsPanel,
  ReviewPanel,
  SettingsPanel,
  TaskDetail,
  priorityLabels,
} from './Panels';
import { addDays, atMinute, datesFrom, today } from './time';
import { themeStyle, ViewLayout, ThemeContext, ThemeCard } from './themes';
import s from './App.module.css';
const initialPreferences: Preferences = {
  theme: 'glass-light',
  days: 3,
  orientation: 'vertical',
  panelWidth: 282,
  hiddenCategories: [],
  hiddenProjects: [],
  hiddenTasks: [],
  hiddenStatuses: [],
  showArchived: false,
};
type Panel =
  | 'task'
  | 'ai'
  | 'background'
  | 'review'
  | 'history'
  | 'settings'
  | 'filters'
  | 'organization'
  | 'proposals';
const panelTitles: Record<Panel, string> = {
  task: '任务详情',
  ai: 'AI 协作',
  background: 'AI 背景',
  review: '每日回望',
  history: '修改历史',
  settings: '设置',
  filters: '显示筛选',
  organization: '项目与分类',
  proposals: '变更提案',
};
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot<Workspace>>(),
    [preferences, setPreferences] = useState(initialPreferences),
    [proposals, setProposals] = useState<Proposal[]>([]),
    [date, setDate] = useState(today()),
    [panel, setPanel] = useState<Panel>(),
    [selected, setSelected] = useState<string>(),
    [search, setSearch] = useState(''),
    [newTask, setNewTask] = useState(false),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(true),
    [toast, setToast] = useState<{ message: string; error: boolean }>(),
    [bootError, setBootError] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    snapshotRef = useRef(snapshot),
    preferencesRef = useRef(preferences);
  snapshotRef.current = snapshot;
  preferencesRef.current = preferences;
  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), error ? 10000 : 3500);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const [work, props] = await Promise.all([readWorkspace(), api<Proposal[]>('/proposals')]);
      setSnapshot(work);
      setProposals(props);
      setConnected(true);
      setBootError('');
    } catch (e) {
      setConnected(false);
      if (!snapshotRef.current) setBootError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    let events: EventSource | undefined;
    const openEvents = () => {
      if (cancelled) return;
      events?.close();
      events = new EventSource('/api/events');
      events.onmessage = () => void refresh();
      events.addEventListener('change', () => void refresh());
      events.onopen = () => {
        setConnected(true);
        void refresh();
      };
      events.onerror = () => setConnected(false);
    };
    const sync = async () => {
      await refresh();
      if (!cancelled && (!events || events.readyState === EventSource.CLOSED)) openEvents();
    };
    void sync();
    void api<Preferences>('/preferences')
      .then(setPreferences)
      .catch((e) => notify(e.message, true));
    const interval = setInterval(() => void sync(), 5000);
    return () => {
      cancelled = true;
      events?.close();
      clearInterval(interval);
      clearTimeout(toastTimer.current);
    };
  }, [refresh, notify]);
  const save = useCallback(
    async (operations: Operation[], summary: string, base?: Snapshot<Workspace>) => {
      const snap = base ?? snapshotRef.current;
      if (!snap) return false;
      setBusy(true);
      try {
        await commit(snap, operations, summary);
        await refresh();
        notify('已保存');
        return true;
      } catch (e) {
        notify((e as Error).message, true);
        await refresh();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh, notify],
  );
  const updatePreferences = async (patch: Partial<Preferences>) => {
    const before = preferencesRef.current;
    setPreferences({ ...before, ...patch });
    try {
      setPreferences(await api<Preferences>('/preferences', patch, 'PATCH'));
    } catch (e) {
      setPreferences(before);
      notify((e as Error).message, true);
    }
  };
  const { drag, start, canClick } = useScheduleDrag((ops, summary) => save(ops, summary, snapshot));
  const select = (id: string) => {
    if (canClick()) {
      setSelected(id);
      setPanel('task');
    }
  };
  const togglePanel = (next: Panel) => setPanel((current) => (current === next ? undefined : next));
  const workspace = snapshot?.data,
    dates = datesFrom(date, preferences.days),
    activeTask = workspace?.tasks.find((t) => t.id === selected);
  const filteredTasks =
    workspace?.tasks
      .filter((task) => {
        const project = workspace.projects.find((p) => p.id === task.projectId),
          category = project?.categoryId ?? task.categoryId;
        return (
          (preferences.showArchived ||
            (!task.archivedAt &&
              !project?.archivedAt &&
              !workspace.categories.find((c) => c.id === category)?.archivedAt)) &&
          !preferences.hiddenTasks.includes(task.id) &&
          !preferences.hiddenProjects.includes(task.projectId ?? '') &&
          !preferences.hiddenCategories.includes(category ?? '') &&
          !preferences.hiddenStatuses.includes(task.status) &&
          (!search ||
            `${task.title} ${task.description}`.toLowerCase().includes(search.toLowerCase()))
        );
      })
      .sort((a, b) => a.order - b.order) || [];
  const filterCount =
    preferences.hiddenCategories.length +
    preferences.hiddenProjects.length +
    preferences.hiddenTasks.length +
    preferences.hiddenStatuses.length;
  const pending = proposals.filter((p) => p.status === 'pending_confirmation').length;
  const resize = (event: React.PointerEvent) => {
    event.preventDefault();
    const initialX = event.clientX,
      width = preferences.panelWidth;
    let next = width;
    const move = (e: PointerEvent) => {
      next = Math.max(220, Math.min(480, width + e.clientX - initialX));
      setPreferences((p) => ({ ...p, panelWidth: next }));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      void updatePreferences({ panelWidth: next });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };
  const loadExample = async () => {
    if (!workspace) return;
    const categoryId = workspace.categories.find((c) => !c.archivedAt)?.id;
    if (!categoryId) return;
    const projectId = crypto.randomUUID(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID();
    await save(
      [
        {
          type: 'project.create',
          id: projectId,
          title: '我的第一个项目',
          categoryId,
          description: '这是一组可编辑、可归档的示例。',
        },
        {
          type: 'task.create',
          id: a,
          title: '为今天选一个重点',
          projectId,
          priority: 'P1',
          description: '把任务拖入时间轴，给专注留一段时间。',
        },
        {
          type: 'placement.put',
          taskId: a,
          placement: {
            id: crypto.randomUUID(),
            kind: 'timed',
            startAt: atMinute(date, 540),
            endAt: atMinute(date, 600),
          },
        },
        {
          type: 'task.create',
          id: b,
          title: '散步，让思绪透透气',
          categoryId: workspace.categories[1]?.id ?? categoryId,
        },
        {
          type: 'placement.put',
          taskId: b,
          placement: { id: crypto.randomUUID(), kind: 'day', date },
        },
      ],
      '载入可编辑示例',
    );
  };
  const taskRow = (task: Task) => (
    <div
      key={task.id}
      className={`${s.taskRow} ${selected === task.id && panel === 'task' ? s.selectedTask : ''} ${task.status === 'done' ? s.done : ''}`}
      onPointerDown={(e) => start(e, task)}
      onClick={() => select(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') select(task.id);
      }}
      tabIndex={0}
      role="button"
      aria-label={`任务 ${task.title}`}
    >
      <ThemeCard task={task}>
        <button
          className={s.statusButton}
          aria-label={task.status === 'done' ? `重新打开 ${task.title}` : `完成 ${task.title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void save(
              [
                {
                  type: 'task.update',
                  id: task.id,
                  patch: { status: task.status === 'done' ? 'todo' : 'done' },
                },
              ],
              task.status === 'done' ? '重新打开任务' : '完成任务',
            );
          }}
        >
          {task.status === 'done' ? (
            <Check size={16} />
          ) : task.status === 'in_progress' ? (
            <CircleDot size={16} />
          ) : (
            <Circle size={16} />
          )}
        </button>
        <div className={s.taskText}>
          <span>{task.title}</span>
          <small>
            <i className={`${s.priorityDot} ${s[task.priority]}`} />
            {task.priority}
            {task.placements.length > 0 && (
              <>
                <span>·</span>
                <CalendarDays size={11} />
                {task.placements.length} 次安排
              </>
            )}
            {task.archivedAt && ' · 已归档'}
          </small>
        </div>
        <span className={s.taskGrip}>⠿</span>
      </ThemeCard>
    </div>
  );
  return (
    <ThemeContext.Provider value={preferences.theme}>
      <div className={s.app} style={themeStyle(preferences.theme)} data-theme={preferences.theme}>
        <header className={s.header}>
          <div className={s.brand}>
            <div className={s.brandMark}>
              <span />
            </div>
            <div>
              <strong>留白</strong>
              <span>FOCUS WORKBENCH</span>
            </div>
            <span className={s.version}>v0.1</span>
          </div>
          <div className={s.topCenter}>
            <span className={s.liveDot} />
            {busy ? '正在保存…' : connected ? '一切就绪，专注当下' : '连接中断，正在重连'}
          </div>
          <nav className={s.headerActions}>
            <button
              className={panel === 'background' ? s.active : ''}
              onClick={() => togglePanel('background')}
            >
              <FileIcon />
              背景
            </button>
            <button
              className={panel === 'review' ? s.active : ''}
              onClick={() => togglePanel('review')}
            >
              <CalendarDays size={16} />
              回望
            </button>
            <button aria-label="修改历史" title="修改历史" onClick={() => togglePanel('history')}>
              <History size={17} />
            </button>
            <button
              aria-label="切换深浅主题"
              title="切换深浅主题"
              onClick={() =>
                void updatePreferences({
                  theme: preferences.theme === 'glass-light' ? 'glass-dark' : 'glass-light',
                })
              }
            >
              {preferences.theme === 'glass-light' ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <button aria-label="设置" title="设置" onClick={() => togglePanel('settings')}>
              <Settings size={17} />
            </button>
            <button className={s.aiButton} onClick={() => togglePanel('ai')}>
              <Sparkles size={15} />
              AI 协作
            </button>
          </nav>
        </header>
        {!workspace ? (
          <div className={s.loading}>
            <div className={s.brandMark}>
              <span />
            </div>
            <h2>{bootError ? '暂时无法打开工作台' : '正在为专注腾出空间…'}</h2>
            <p>{bootError || '连接本机文件服务'}</p>
            {bootError && <button onClick={() => void refresh()}>重新连接</button>}
          </div>
        ) : (
          <>
            {snapshot?.readOnly && <div className={s.globalWarning}>{snapshot.readOnly}</div>}
            {snapshot?.external && (
              <ExternalNotice snapshot={snapshot} reload={refresh} notify={notify} />
            )}
            <ViewLayout
              className={s.layout}
              panelWidth={preferences.panelWidth}
              sidebar={
                <aside className={s.sidebar}>
                  <div className={s.sidebarHeading}>
                    <div>
                      <div className={s.eyebrow}>A PLACE FOR EVERYTHING</div>
                      <h1>
                        我的任务 <span>{filteredTasks.length}</span>
                      </h1>
                    </div>
                    <button
                      className={s.roundAdd}
                      aria-label="新建任务"
                      title="新建任务"
                      onClick={() => setNewTask(true)}
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                  <label className={s.search}>
                    <Search size={15} />
                    <input
                      aria-label="搜索任务"
                      placeholder="找一件事情…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button aria-label="清除搜索" onClick={() => setSearch('')}>
                        <X size={13} />
                      </button>
                    )}
                  </label>
                  <div className={s.sidebarTabs}>
                    <span>所有事项</span>
                    <button onClick={() => togglePanel('organization')}>
                      <Folder size={13} />
                      项目与分类
                    </button>
                  </div>
                  <div className={s.taskList}>
                    {filteredTasks.length === 0 ? (
                      <div className={s.emptyTasks}>
                        <div className={s.emptyIllustration}>
                          <div />
                          <div />
                          <div />
                        </div>
                        <h3>
                          {workspace.tasks.length ? '当前视图很安静' : '把脑中的事，先放下来'}
                        </h3>
                        <p>
                          {workspace.tasks.length
                            ? '试试清除筛选或搜索。'
                            : '从一个小任务开始，\n为今天留出专注的空间。'}
                        </p>
                        <button className={s.primary} onClick={() => setNewTask(true)}>
                          <Plus size={15} />
                          新建任务
                        </button>
                        {!workspace.tasks.length && (
                          <button className={s.textButton} onClick={() => void loadExample()}>
                            先体验一组示例
                          </button>
                        )}
                        {!!filterCount && (
                          <button
                            onClick={() =>
                              void updatePreferences({
                                hiddenCategories: [],
                                hiddenProjects: [],
                                hiddenTasks: [],
                                hiddenStatuses: [],
                              })
                            }
                          >
                            清除筛选
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        {filteredTasks.some((t) => !t.projectId) && (
                          <section className={s.taskGroup}>
                            <h3>
                              <LayoutGrid size={13} />
                              独立任务
                              <span>{filteredTasks.filter((t) => !t.projectId).length}</span>
                            </h3>
                            {filteredTasks.filter((t) => !t.projectId).map(taskRow)}
                          </section>
                        )}
                        {workspace.projects
                          .slice()
                          .sort((a, b) => a.order - b.order)
                          .filter((p) => filteredTasks.some((t) => t.projectId === p.id))
                          .map((p) => (
                            <section className={s.taskGroup} key={p.id}>
                              <h3>
                                <Folder size={13} />
                                {p.title}
                                <span>
                                  {filteredTasks.filter((t) => t.projectId === p.id).length}
                                </span>
                              </h3>
                              {filteredTasks.filter((t) => t.projectId === p.id).map(taskRow)}
                            </section>
                          ))}
                      </>
                    )}
                  </div>
                  <div className={s.sidebarFoot}>
                    <span>拖动任务，安排一个时刻</span>
                    <button
                      onClick={() => togglePanel('proposals')}
                      className={pending ? s.pendingButton : ''}
                    >
                      <span className={s.liveDot} />
                      {pending ? `${pending} 条待确认` : '变更提案'}
                    </button>
                  </div>
                </aside>
              }
              divider={
                <div
                  className={s.divider}
                  role="separator"
                  aria-label="调整任务面板宽度"
                  aria-orientation="vertical"
                  tabIndex={0}
                  onPointerDown={resize}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
                      void updatePreferences({
                        panelWidth: Math.max(
                          220,
                          Math.min(
                            480,
                            preferences.panelWidth + (e.key === 'ArrowRight' ? 20 : -20),
                          ),
                        ),
                      });
                  }}
                />
              }
              board={
                <section className={s.board}>
                  <div className={s.boardToolbar}>
                    <div className={s.dateTitle}>
                      <div className={s.eyebrow}>MAKE TIME FOR WHAT MATTERS</div>
                      <h2>
                        {Number(date.slice(5, 7))}月<span>{date.slice(0, 4)}</span>
                        <label className={s.datePicker} title="选择起始日期">
                          <ChevronDown size={17} />
                          <input
                            aria-label="看板起始日期"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                          />
                        </label>
                      </h2>
                    </div>
                    <div className={s.dateNavigation}>
                      <button
                        aria-label="上一组日期"
                        onClick={() => setDate(addDays(date, -preferences.days))}
                      >
                        <ArrowLeft size={16} />
                      </button>
                      <button onClick={() => setDate(today())}>今天</button>
                      <button
                        aria-label="下一组日期"
                        onClick={() => setDate(addDays(date, preferences.days))}
                      >
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                  <div className={s.viewToolbar}>
                    <div className={s.segmented}>
                      {([1, 3, 7] as const).map((days) => (
                        <button
                          key={days}
                          className={preferences.days === days ? s.active : ''}
                          onClick={() => void updatePreferences({ days })}
                        >
                          {days === 1 ? '单日' : `${days} 日`}
                        </button>
                      ))}
                    </div>
                    <div className={s.viewActions}>
                      <button
                        aria-label="切换时间轴方向"
                        onClick={() =>
                          void updatePreferences({
                            orientation:
                              preferences.orientation === 'vertical' ? 'horizontal' : 'vertical',
                          })
                        }
                      >
                        <Columns3
                          size={15}
                          style={{
                            transform:
                              preferences.orientation === 'horizontal' ? 'rotate(90deg)' : '',
                          }}
                        />
                        {preferences.orientation === 'vertical' ? '纵向' : '横向'}
                      </button>
                      <button
                        className={filterCount ? s.active : ''}
                        onClick={() => togglePanel('filters')}
                      >
                        <Filter size={14} />
                        筛选{filterCount > 0 && <span className={s.badge}>{filterCount}</span>}
                      </button>
                    </div>
                  </div>
                  <Timeline
                    tasks={filteredTasks}
                    dates={dates}
                    orientation={preferences.orientation}
                    onSelect={select}
                    onDrag={start}
                    preview={drag}
                    selectedId={selected}
                  />
                </section>
              }
              detail={
                panel && (
                  <aside className={s.detail}>
                    <div className={s.detailHeader}>
                      <span>{panelTitles[panel]}</span>
                      <button aria-label="收起详情面板" onClick={() => setPanel(undefined)}>
                        <X size={18} />
                      </button>
                    </div>
                    {panel === 'task' &&
                      (activeTask ? (
                        <TaskDetail
                          key={activeTask.id}
                          task={activeTask}
                          workspace={workspace}
                          save={save}
                          notify={notify}
                        />
                      ) : (
                        <div className={s.panelContent}>选择一个任务，看看它的下一步。</div>
                      ))}
                    {panel === 'filters' && (
                      <FilterPanel
                        workspace={workspace}
                        preferences={preferences}
                        update={(patch) => void updatePreferences(patch)}
                      />
                    )}
                    {panel === 'organization' && (
                      <OrganizationPanel
                        workspace={workspace}
                        save={save}
                        refresh={refresh}
                        notify={notify}
                      />
                    )}
                    {panel === 'background' && <BackgroundPanel notify={notify} />}
                    {panel === 'review' && <ReviewPanel notify={notify} workspace={workspace} />}
                    {panel === 'history' && <HistoryPanel notify={notify} refresh={refresh} />}
                    {panel === 'settings' && (
                      <SettingsPanel notify={notify} onSettings={() => void refresh()} />
                    )}
                    {panel === 'proposals' && (
                      <ProposalsPanel proposals={proposals} refresh={refresh} notify={notify} />
                    )}
                    {panel === 'ai' && (
                      <AiPanel
                        workspace={workspace}
                        dates={dates}
                        notify={notify}
                        refresh={refresh}
                        onProposals={() => setPanel('proposals')}
                      />
                    )}
                  </aside>
                )
              }
            />
          </>
        )}
        {newTask && workspace && (
          <NewTaskDialog
            workspace={workspace}
            onClose={() => setNewTask(false)}
            onCreate={async (ops) => {
              if (await save(ops, '创建任务')) setNewTask(false);
            }}
          />
        )}
        {toast && (
          <div role="status" className={`${s.toast} ${toast.error ? s.errorToast : ''}`}>
            {toast.error ? <Circle size={17} /> : <Check size={17} />}
            <span>{toast.message}</span>
            <button aria-label="关闭提示" onClick={() => setToast(undefined)}>
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </ThemeContext.Provider>
  );
}
function FileIcon() {
  return <span style={{ fontSize: 17, lineHeight: 1 }}>≡</span>;
}
function NewTaskDialog({
  workspace,
  onCreate,
  onClose,
}: {
  workspace: Workspace;
  onCreate: (ops: Operation[]) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(''),
    [priority, setPriority] = useState<Task['priority']>('P2'),
    [projectId, setProject] = useState(''),
    [categoryId, setCategory] = useState(workspace.categories.find((c) => !c.archivedAt)?.id ?? ''),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onCreate([
        {
          type: 'task.create',
          title,
          priority,
          projectId: projectId || null,
          categoryId: projectId ? null : categoryId,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onClose]);
  return (
    <div
      className={s.modalBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="new-task-title" className={s.modal}>
        <div className={s.modalHeader}>
          <div>
            <div className={s.eyebrow}>ONE THING AT A TIME</div>
            <h2 id="new-task-title">新建任务</h2>
          </div>
          <button aria-label="关闭新建任务" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <form className={s.form} onSubmit={(e) => void submit(e)}>
          <label>
            想完成什么？
            <input
              autoFocus
              required
              aria-label="新任务名称"
              placeholder="用一句话写下这件事"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className={s.formRow}>
            <label>
              优先级
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Task['priority'])}
              >
                {Object.entries(priorityLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              项目
              <select value={projectId} onChange={(e) => setProject(e.target.value)}>
                <option value="">独立任务</option>
                {workspace.projects
                  .filter((p) => !p.archivedAt)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {!projectId && (
            <label>
              分类
              <select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
                {workspace.categories
                  .filter((c) => !c.archivedAt)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <p className={s.hint}>不必立刻安排时间，先把事情放下来。</p>
          <button className={s.primary} disabled={busy}>
            {busy ? <LoaderCircle className={s.spin} size={15} /> : <Plus size={15} />}创建任务
          </button>
        </form>
      </div>
    </div>
  );
}
