import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Workbench } from './application/useWorkbench';
import type { Snapshot, Workspace } from '../domain/types';
import { ancestors, taskPath } from '../domain/tree';
import {
  moveTodoDate,
  todoGroups,
  todoTreeRows,
  dropTodoSubtree,
  type TodoRange,
  type TodoTreeRow,
} from './todo';
import { today, weekday } from './time';
import s from './TodoList.module.css';

type Selection = TodoTreeRow & {
  base: Snapshot<Workspace>;
  rowKey: string;
  sourceDates: string[];
  fromUndated: boolean;
};
export function TodoList({ workbench: w }: { workbench: Workbench }) {
  const [range, setRange] = useState<TodoRange>('next3');
  const [parents, setParents] = useState(false),
    [completed, setCompleted] = useState(true);
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
  const selection = (row: TodoTreeRow, rowKey: string, groupKey: string): Selection => ({
    ...row,
    base: w.snapshot!,
    rowKey,
    sourceDates: row.date
      ? [row.date]
      : /^\d{4}-\d{2}-\d{2}$/.test(groupKey)
        ? [groupKey]
        : groupKey === 'overdue'
          ? overdue
              .filter(
                (hit) =>
                  hit.task.id === row.task.id ||
                  ancestors(hit.task, tasks).some((a) => a.id === row.task.id),
              )
              .map((hit) => hit.date!)
          : [],
    fromUndated: groupKey === 'undated',
  });
  const moveDate = async (item: Selection, date: string) => {
    if (!date || locked || item.contextOnly) return;
    try {
      const ops = moveTodoDate(item.task, item.date, date);
      if (ops.length) await w.save(ops, '调整待办分配日期', item.base);
    } catch (error) {
      w.notify((error as Error).message, true);
    }
  };
  const dropTask = async (item: Selection, targetDate?: string, parentId?: string | null) => {
    if (locked) return;
    try {
      const operations = dropTodoSubtree(
        item.task,
        item.base.data.tasks,
        item.sourceDates,
        targetDate,
        parentId,
        item.fromUndated,
      );
      if (operations.length) await w.save(operations, '移动待办子树与叶节点日期', item.base);
    } catch (error) {
      w.notify((error as Error).message, true);
    }
  };
  const target = (key: string, action: (item: Selection) => void, accepts = true) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragRef.current || locked || !accepts) return;
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
      if (item && !locked && accepts) action(item);
    },
  });
  const renderRow = (row: TodoTreeRow, groupKey: string) => {
    const task = row.task,
      key = `${groupKey}:${task.id}:${row.date ?? 'undated'}`;
    const isEditing = editing?.rowKey === key;
    return (
      <div
        key={key}
        className={`${s.row} ${row.depth === 0 ? s.rootRow : ''} ${task.status === 'done' ? s.done : ''} ${hover === key ? s.hover : ''}`}
        {...target(
          key,
          (item) =>
            void dropTask(
              item,
              row.date ?? (/^\d{4}-\d{2}-\d{2}$/.test(groupKey) ? groupKey : undefined),
              task.id,
            ),
        )}
        style={{ marginLeft: Math.min(row.depth, 8) * 18 }}
        title={taskPath(task, tasks)}
        data-todo-depth={row.depth}
        data-todo-context={row.contextOnly}
        data-todo-task={task.id}
        data-todo-date={row.date ?? ''}
      >
        <span
          className={s.grip}
          draggable={!locked && !editing}
          role="button"
          tabIndex={0}
          aria-label={`拖动 ${task.title}`}
          title="拖到任务行调整归属；跨日期时只移动子树中叶节点的对应日期"
          onDragStart={(e) => {
            const item = selection(row, key, groupKey);
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
                setEditing(selection(row, key, groupKey));
                setTitle(task.title);
              }}
            >
              {task.title}
            </button>
          )}
        </div>
        {row.contextOnly ? (
          <span className={s.contextLabel}>层级节点</span>
        ) : (
          <input
            className={s.date}
            type="date"
            aria-label={`分配日期 ${task.title}`}
            value={row.date ?? ''}
            disabled={locked || !!editing}
            onChange={(e) => void moveDate(selection(row, key, groupKey), e.target.value)}
          />
        )}
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
          包含父任务自身日期
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
          {...target('root', (item) => void dropTask(item, undefined, null))}
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
          (overdue.length ? (
            todoTreeRows(overdue, tasks).map((row) => renderRow(row, 'overdue'))
          ) : (
            <p className={s.empty}>没有过期未完成事项</p>
          ))}
      </section>
      {groups.map((group) => (
        <section
          key={group.date}
          data-todo-group={group.date}
          className={`${s.group} ${hover === group.date ? s.hover : ''}`}
          {...target(group.date, (item) => void dropTask(item, group.date))}
        >
          <h2>
            {group.date === baseDate ? '今天 · ' : ''}
            {group.date} {weekday(group.date)} <span>{group.rows.length}</span>
          </h2>
          {todoTreeRows(group.rows, tasks).map((row) => renderRow(row, group.date))}
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
            todoTreeRows(undated, tasks).map((row) => renderRow(row, 'undated'))
          ) : (
            <p className={s.empty}>没有未分配日期的事项</p>
          ))}
      </section>
    </main>
  );
}
