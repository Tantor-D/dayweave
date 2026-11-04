import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Workbench } from './application/useWorkbench';
import type { Snapshot, Workspace } from '../domain/types';
import { taskPath } from '../domain/tree';
import { moveTodoDate, todoGroups, todoParentOptions, type TodoRange, type TodoRow } from './todo';
import { today, weekday } from './time';
import s from './TodoList.module.css';

type Selection = TodoRow & { base: Snapshot<Workspace> };
export function TodoList({ workbench: w }: { workbench: Workbench }) {
  const [range, setRange] = useState<TodoRange>('today');
  const [parents, setParents] = useState(false),
    [completed, setCompleted] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(true),
    [undatedOpen, setUndatedOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Selection>(),
    [title, setTitle] = useState('');
  const [dragging, setDragging] = useState<Selection>();
  const dragRef = useRef<Selection | undefined>(undefined);
  const [hover, setHover] = useState('');
  const locked = w.busy || !!w.snapshot?.readOnly || !!w.snapshot?.external;
  useEffect(() => {
    w.setTodoEditing(!!editing || !!dragging);
    return () => w.setTodoEditing(false);
  }, [editing, dragging, w.setTodoEditing]);
  const cancelDrag = () => {
    dragRef.current = undefined;
    setDragging(undefined);
    setHover('');
  };
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDrag();
    };
    document.addEventListener('keydown', cancel);
    return () => document.removeEventListener('keydown', cancel);
  }, []);
  if (!w.workspace || !w.snapshot) return null;
  const tasks = w.workspace.tasks,
    baseDate = today();
  const { groups, overdue, undated } = todoGroups(
    tasks,
    range,
    baseDate,
    parents,
    completed,
    query,
  );
  const selection = (row: TodoRow): Selection => ({ ...row, base: w.snapshot! });
  const moveDate = async (item: Selection, date: string) => {
    if (!date || locked) return;
    try {
      const ops = moveTodoDate(item.task, item.date, date);
      if (ops.length) await w.save(ops, '调整待办分配日期', item.base);
    } catch (error) {
      w.notify((error as Error).message, true);
    }
  };
  const setParent = async (item: Selection, parentId: string | null) => {
    if (locked || parentId === item.task.parentId) return;
    if (
      parentId &&
      !todoParentOptions(item.task, item.base.data.tasks).some((t) => t.id === parentId)
    ) {
      w.notify('不能将任务归属到自身、后代或已归档任务。', true);
      return;
    }
    await w.save(
      [{ type: 'task.update', id: item.task.id, patch: { parentId } }],
      '调整待办任务归属',
      item.base,
    );
  };
  const target = (key: string, action: (item: Selection) => void) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragRef.current || locked) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setHover(key);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const item = dragRef.current;
      cancelDrag();
      if (item && !locked) action(item);
    },
  });
  const renderRow = (row: TodoRow) => {
    const task = row.task,
      key = `${task.id}:${row.date ?? 'undated'}`;
    const isEditing = editing?.task.id === task.id && editing.date === row.date;
    return (
      <div
        key={key}
        className={`${s.row} ${task.status === 'done' ? s.done : ''}`}
        data-todo-task={task.id}
        data-todo-date={row.date ?? ''}
      >
        <span
          className={s.grip}
          draggable={!locked && !editing}
          role="button"
          tabIndex={0}
          aria-label={`拖动 ${task.title}`}
          title="拖到日期分组改期，或拖到归属目标调整父任务"
          onDragStart={(e) => {
            const item = selection(row);
            dragRef.current = item;
            setDragging(item);
            e.dataTransfer.setData('text/plain', task.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={cancelDrag}
        >
          ⠿
        </span>
        <input
          type="checkbox"
          aria-label={`完成 ${task.title}`}
          checked={task.status === 'done'}
          disabled={locked || !!editing}
          onChange={() =>
            void w.save(
              [
                {
                  type: 'task.update',
                  id: task.id,
                  patch: { status: task.status === 'done' ? 'todo' : 'done' },
                },
              ],
              '更新待办完成状态',
              w.snapshot,
            )
          }
        />
        <div className={s.name}>
          {isEditing ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  title.trim() &&
                  editing &&
                  (await w.save(
                    [{ type: 'task.update', id: task.id, patch: { title: title.trim() } }],
                    '重命名待办任务',
                    editing.base,
                  ))
                )
                  setEditing(undefined);
              }}
            >
              <input
                autoFocus
                aria-label="任务新名称"
                value={title}
                disabled={locked}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(undefined);
                }}
              />
              <button disabled={locked || !title.trim()}>保存</button>
              <button type="button" disabled={w.busy} onClick={() => setEditing(undefined)}>
                取消
              </button>
            </form>
          ) : (
            <button
              className={s.title}
              disabled={locked || !!editing}
              onClick={() => {
                setEditing(selection(row));
                setTitle(task.title);
              }}
            >
              {task.title}
            </button>
          )}
          {task.parentId && (
            <small title={taskPath(task, tasks)}>
              {taskPath(task, tasks).split(' / ').slice(0, -1).join(' / ')}
            </small>
          )}
        </div>
        <input
          className={s.date}
          type="date"
          aria-label={`分配日期 ${task.title}`}
          value={row.date ?? ''}
          disabled={locked || !!editing}
          onChange={(e) => void moveDate(selection(row), e.target.value)}
        />
        <select
          aria-label={`父任务 ${task.title}`}
          value={task.parentId ?? ''}
          disabled={locked || !!editing}
          onChange={(e) => void setParent(selection(row), e.target.value || null)}
        >
          <option value="">一级任务</option>
          {todoParentOptions(task, tasks).map((t) => (
            <option key={t.id} value={t.id}>
              {taskPath(t, tasks)}
            </option>
          ))}
        </select>
        {
          <span
            className={`${s.parentTarget} ${hover === key ? s.hover : ''}`}
            {...target(key, (item) => void setParent(item, task.id))}
          >
            归属到此任务
          </span>
        }
      </div>
    );
  };
  return (
    <main className={s.page} aria-label="待办列表">
      <div className={s.heading}>
        <div>
          <h1>待办</h1>
          <p>按分配日期，专注每一天要做的事</p>
        </div>
        <button disabled={locked || !!editing} onClick={() => w.setNewTask(true)}>
          ＋ 新建任务
        </button>
      </div>
      <div className={s.toolbar}>
        <div className={s.presets}>
          {(
            [
              ['today', '今日'],
              ['next3', '3 日'],
              ['next7', '7 日'],
              ['week', '本周'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={range === value}
              disabled={!!editing}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={parents}
            disabled={!!editing}
            onChange={(e) => setParents(e.target.checked)}
          />
          显示父任务
        </label>
        <label>
          <input
            type="checkbox"
            checked={completed}
            disabled={!!editing}
            onChange={(e) => setCompleted(e.target.checked)}
          />
          显示已完成
        </label>
        <input
          type="search"
          aria-label="搜索待办"
          placeholder="搜索任务或所属路径"
          value={query}
          disabled={!!editing}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {
        <div
          className={`${s.rootTarget} ${hover === 'root' ? s.hover : ''}`}
          {...target('root', (item) => void setParent(item, null))}
        >
          拖到这里设为一级任务（保留分配日期）
        </div>
      }
      <section className={s.group}>
        <button
          className={s.groupTitle}
          aria-expanded={overdueOpen}
          onClick={() => setOverdueOpen(!overdueOpen)}
        >
          {overdueOpen ? '▾' : '▸'} 过期 <span>{overdue.length}</span>
        </button>
        {overdueOpen &&
          (overdue.length ? overdue.map(renderRow) : <p className={s.empty}>没有过期未完成事项</p>)}
      </section>
      {groups.map((group) => (
        <section
          key={group.date}
          data-todo-group={group.date}
          className={`${s.group} ${hover === group.date ? s.hover : ''}`}
          {...target(group.date, (item) => void moveDate(item, group.date))}
        >
          <h2>
            {group.date === baseDate ? '今天 · ' : ''}
            {group.date} {weekday(group.date)} <span>{group.rows.length}</span>
          </h2>
          {group.rows.map(renderRow)}
          <p className={s.empty}>
            {dragging ? '拖到此日期区域以修改分配日期' : group.rows.length ? '' : '暂无待办事项'}
          </p>
        </section>
      ))}
      <section className={s.group}>
        <button
          className={s.groupTitle}
          aria-expanded={undatedOpen}
          onClick={() => setUndatedOpen(!undatedOpen)}
        >
          {undatedOpen ? '▾' : '▸'} 未分配日期 <span>{undated.length}</span>
        </button>
        {undatedOpen &&
          (undated.length ? (
            undated.map(renderRow)
          ) : (
            <p className={s.empty}>没有未分配日期的事项</p>
          ))}
      </section>
    </main>
  );
}
