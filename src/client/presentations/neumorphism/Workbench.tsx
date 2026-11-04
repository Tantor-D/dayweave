import { useState } from 'react';
import type { NeumorphismSettings } from '../../../domain/neumorphism';
import { neumorphismTokens } from './themes';
import { NeumorphismDrawer } from './NeumorphismDrawer';
import { TodoList } from '../../TodoList';
import { StatisticsDashboard } from '../../StatisticsDashboard';
import statisticsStyles from './Statistics.module.css';
import { TagPropagationDialog } from '../../TagPropagationDialog';
import { InheritTagsContext } from '../../TaskFields';
import { ancestors, taskPath, treeOrder } from '../../../domain/tree';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronDown,
  Circle,
  Columns3,
  Filter,
  Eye,
  EyeOff,
  Folder,
  History,
  ListTodo,
  Plus,
  Search,
  Settings,
  X,
} from 'lucide-react';
import type { Task } from '../../../domain/types';
import { Timeline } from '../../Timeline';
import { ScheduleDialog } from '../../ScheduleDialog';
import {
  BackgroundPanel,
  ExternalNotice,
  FilterPanel,
  HistoryPanel,
  OrganizationPanel,
  ProposalsPanel,
  ReviewPanel,
  SettingsPanel,
  TaskDetail,
} from '../../Panels';
import { addDays, today, type TaskDateFilter } from '../../time';
import { themeStyle, ThemeContext, ThemeCard } from '../../themes';
import s from './Workbench.module.css';
import type { Workbench } from '../../application/useWorkbench';
import { ThemePicker } from '../ThemePicker';
import { NewTaskDialog } from '../../NewTaskDialog';
const panelTitles: Record<string, string> = {
  task: '任务详情',
  background: 'AI 背景',
  review: '每日回望',
  history: '修改历史',
  settings: '设置',
  filters: '显示筛选',
  organization: '标签管理',
  proposals: '变更提案',
};
export function WorkbenchView({ workbench }: { workbench: Workbench }) {
  const [appearanceDraft, setAppearanceDraft] = useState<NeumorphismSettings | null>(null);
  const {
    view,
    setView,
    snapshot,
    preferences,
    proposals,
    date,
    setDate,
    panel,
    setPanel,
    selected,
    search,
    setSearch,
    dateFilter,
    setDateFilter,
    newTask,
    setNewTask,
    schedule,
    setSchedule,
    busy,
    connected,
    toast,
    setToast,
    bootError,
    tagConfirmation,
    setTagConfirmation,
    notify,
    refresh,
    save,
    updatePreferences,
    drag,
    start,
    canClick,
    select,
    togglePanel,
    workspace,
    dates,
    activeTask,
    filteredTasks,
    sidebarHits,
    sidebarTasks,
    filterCount,
    pending,
    loadExample,
  } = workbench;
  const taskRow = (task: Task) => (
    <div
      key={task.id}
      data-task-drop={task.id}
      style={{ marginLeft: Math.min(ancestors(task, workspace?.tasks ?? []).length, 8) * 14 }}
      title={[
        taskPath(task, workspace?.tasks ?? []),
        workspace?.tags
          .filter((tag) => task.tagIds.includes(tag.id))
          .map((tag) => tag.name)
          .join(' · '),
        task.archivedAt ? '已归档' : '',
      ]
        .filter(Boolean)
        .join('\n')}
      className={`${s.taskRow} ${!task.parentId ? s.rootTask : ''} ${selected === task.id && panel === 'task' ? s.selectedTask : ''} ${task.status === 'done' ? s.done : ''} ${drag?.parentTarget?.id === task.id ? s.parentDropTarget : ''} ${drag?.sortTarget?.id === task.id ? (drag.sortTarget.side === 'before' ? s.sortBefore : s.sortAfter) : ''}`}
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
          {task.status === 'done' ? <Check size={16} /> : <Circle size={16} />}
        </button>
        <div className={s.taskText}>
          <span>{task.title}</span>
        </div>
        <span className={s.taskGrip}>⠿</span>
      </ThemeCard>
    </div>
  );
  return (
    <ThemeContext.Provider value={preferences.theme}>
      <InheritTagsContext.Provider value={preferences.inheritParentTags}>
        <div
          className={s.app}
          style={{
            ...themeStyle(preferences.theme),
            ...neumorphismTokens(appearanceDraft ?? preferences.neumorphism),
          }}
          data-theme={preferences.theme}
        >
          <header
            className={`${s.header} ${view === 'statistics' ? statisticsStyles.statisticsHeader : ''}`}
          >
            <div className={s.brand}>
              <div className={s.brandMark}>
                <span />
              </div>
              <div>
                <strong>留白</strong>
                <span>MAKE TIME. DO YOUR THING.</span>
              </div>
            </div>
            <div className={s.topCenter}>
              <span className={s.liveDot} />
              {busy ? '正在保存…' : connected ? '一切就绪，专注当下' : '连接中断，正在重连'}
            </div>
            <nav className={s.headerActions}>
              <button
                disabled={workbench.todoEditing}
                aria-pressed={view === 'workbench'}
                className={view === 'workbench' ? s.active : ''}
                onClick={() => setView('workbench')}
              >
                <Columns3 size={16} />
                工作台
              </button>
              <button
                aria-pressed={view === 'todo'}
                className={view === 'todo' ? s.active : ''}
                onClick={() => setView('todo')}
              >
                <ListTodo size={16} />
                待办
              </button>
              <button
                disabled={workbench.todoEditing}
                aria-pressed={view === 'statistics'}
                className={view === 'statistics' ? s.active : ''}
                onClick={() => setView('statistics')}
              >
                <ChartColumn size={16} />
                统计
              </button>
              <button
                className={panel === 'background' ? s.active : ''}
                disabled={workbench.todoEditing}
                onClick={() => {
                  setView('workbench');
                  if (view !== 'workbench') setPanel('background');
                  else togglePanel('background');
                }}
              >
                <FileIcon />
                背景
              </button>
              <button
                className={panel === 'review' ? s.active : ''}
                disabled={workbench.todoEditing}
                onClick={() => {
                  setView('workbench');
                  if (view !== 'workbench') setPanel('review');
                  else togglePanel('review');
                }}
              >
                <CalendarDays size={16} />
                回望
              </button>
              <button
                aria-label="修改历史"
                title="修改历史"
                disabled={workbench.todoEditing}
                onClick={() => {
                  setView('workbench');
                  if (view !== 'workbench') setPanel('history');
                  else togglePanel('history');
                }}
              >
                <History size={17} />
              </button>
              <ThemePicker workbench={workbench} extraLocked={appearanceDraft !== null} />
              <NeumorphismDrawer
                workbench={workbench}
                draft={appearanceDraft}
                onDraft={setAppearanceDraft}
              />
              <button
                aria-label="设置"
                title="设置"
                disabled={workbench.todoEditing}
                onClick={() => {
                  setView('workbench');
                  if (view !== 'workbench') setPanel('settings');
                  else togglePanel('settings');
                }}
              >
                <Settings size={17} />
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
              {view === 'todo' && <TodoList workbench={workbench} />}
              {view === 'statistics' && (
                <StatisticsDashboard
                  onEditingChange={workbench.setStatisticsEditing}
                  workspace={workspace}
                  preferences={preferences.statistics}
                  update={(statistics) => updatePreferences({ statistics })}
                />
              )}
              <ViewLayout
                className={`${s.layout} ${view !== 'workbench' ? statisticsStyles.hiddenWorkbench : ''}`}
                panelWidth={300}
                sidebar={
                  <aside className={s.sidebar}>
                    <div className={s.sidebarHeading}>
                      <div>
                        <h1>
                          行动清单 <span>{sidebarHits.length}</span>
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
                      <select
                        aria-label="任务日期筛选"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value as TaskDateFilter)}
                      >
                        <option value="all">全部</option>
                        <option value="today">今天</option>
                        <option value="week">本周</option>
                        <option value="next3">未来三天</option>
                        <option value="next7">未来七天</option>
                      </select>
                      <button onClick={() => togglePanel('organization')}>
                        <Folder size={13} />
                        标签管理
                      </button>
                    </div>
                    <div className={s.taskListControls}>
                      <button
                        className={s.completedToggle}
                        aria-pressed={!preferences.hiddenStatuses.includes('done')}
                        onClick={() =>
                          void updatePreferences({
                            hiddenStatuses: preferences.hiddenStatuses.includes('done')
                              ? preferences.hiddenStatuses.filter((status) => status !== 'done')
                              : [...preferences.hiddenStatuses, 'done'],
                          })
                        }
                      >
                        {preferences.hiddenStatuses.includes('done')
                          ? '不显示已完成'
                          : '显示已完成'}
                      </button>
                      <div
                        data-root-drop="true"
                        aria-hidden={!(drag?.moved && !drag.original && drag.task.parentId)}
                        className={`${s.rootDropZone} ${drag?.rootTarget ? s.rootDropActive : ''}`}
                      >
                        设为一级任务
                      </div>
                    </div>
                    <div className={s.taskList} data-root-drop="true">
                      {sidebarHits.length === 0 ? (
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
                                  hiddenTags: [],
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
                        <>{treeOrder(sidebarTasks).map(taskRow)}</>
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
                board={
                  <section className={s.board}>
                    <div className={s.boardToolbar}>
                      <div className={s.dateTitle}>
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
                          aria-pressed={preferences.showUntimed}
                          onClick={() =>
                            void updatePreferences({ showUntimed: !preferences.showUntimed })
                          }
                        >
                          {preferences.showUntimed ? <EyeOff size={15} /> : <Eye size={15} />}
                          {preferences.showUntimed ? '隐藏未定时' : '显示未定时'}
                        </button>
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
                      allTasks={workspace.tasks}
                      tags={workspace.tags}
                      dayStart={preferences.dayStart}
                      dayEnd={preferences.dayEnd}
                      dates={dates}
                      orientation={preferences.orientation}
                      showUntimed={preferences.showUntimed}
                      onSelect={select}
                      onDrag={start}
                      preview={drag}
                      selectedId={selected}
                      onSchedule={(placement) => {
                        if (canClick() && snapshot) setSchedule({ placement, base: snapshot });
                      }}
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
                        <SettingsPanel
                          preferences={preferences}
                          updatePreferences={updatePreferences}
                        />
                      )}
                      {panel === 'proposals' && (
                        <ProposalsPanel proposals={proposals} refresh={refresh} notify={notify} />
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
          {schedule && (
            <ScheduleDialog
              workspace={schedule.base.data}
              placement={schedule.placement}
              onClose={() => setSchedule(undefined)}
              onSave={(operations, reportError) =>
                save(operations, '从时间轴添加安排', schedule.base, reportError)
              }
            />
          )}
          {tagConfirmation && (
            <TagPropagationDialog
              request={tagConfirmation}
              onAnswer={(answer) => {
                tagConfirmation.resolve(answer);
                setTagConfirmation(undefined);
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
      </InheritTagsContext.Provider>
    </ThemeContext.Provider>
  );
}
function FileIcon() {
  return <span style={{ fontSize: 17, lineHeight: 1 }}>≡</span>;
}

function ViewLayout({
  sidebar,
  board,
  detail,
  divider,
  panelWidth,
  className,
}: {
  sidebar: React.ReactNode;
  board: React.ReactNode;
  detail?: React.ReactNode;
  divider?: React.ReactNode;
  panelWidth: number;
  className?: string;
}) {
  return (
    <main
      className={className}
      style={{ '--panel-width': `${panelWidth}px` } as React.CSSProperties}
    >
      {sidebar}
      {divider}
      {board}
      {detail}
    </main>
  );
}
