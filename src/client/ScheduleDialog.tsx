import { TaskFields, emptyTaskDraft } from './TaskFields';
import { ancestors, taskPath, unfinishedTaskTree } from '../domain/tree';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarPlus, LoaderCircle, Search, X } from 'lucide-react';
import type { Operation, Placement, Workspace } from '../domain/types';
import { dateOf, localInput, localToUTC } from './time';
import { useAppearance } from './presentations/Appearance';

export function ScheduleDialog({
  workspace,
  placement,
  onSave,
  onClose,
}: {
  workspace: Workspace;
  placement: Placement;
  onSave: (operations: Operation[], reportError: (message: string) => void) => Promise<boolean>;
  onClose: () => void;
}) {
  const { controls: s } = useAppearance();
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [draft, setDraft] = useState(emptyTaskDraft);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [taskId, setTaskId] = useState('');
  const [date, setDate] = useState(
    placement.kind === 'day' ? placement.date : dateOf(placement.startAt),
  );
  const [startAt, setStartAt] = useState(
    placement.kind === 'timed' ? localInput(placement.startAt) : '',
  );
  const [endAt, setEndAt] = useState(placement.kind === 'timed' ? localInput(placement.endAt) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const available = unfinishedTaskTree(workspace.tasks);
  const matches = unfinishedTaskTree(workspace.tasks, query);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if ((mode === 'new' || taskId) && !draft.title.trim()) {
      setError('请填写任务名称。');
      return;
    }
    if (mode === 'existing' && !available.some((task) => task.id === taskId)) {
      setError('请选择要关联的任务。');
      return;
    }
    if (placement.kind === 'timed' && (!startAt || !endAt || endAt <= startAt)) {
      setError('结束时间需要晚于开始时间。');
      return;
    }
    const id = mode === 'new' ? crypto.randomUUID() : taskId;
    const operations: Operation[] = [];
    if (mode === 'new')
      operations.push({
        type: 'task.create',
        id,
        ...draft,
        title: draft.title.trim(),
      });
    if (mode === 'existing' && taskId)
      operations.push({
        type: 'task.update',
        id: taskId,
        patch: {
          title: draft.title.trim(),
          description: draft.description,
          parentId: draft.parentId,
          tagIds: draft.tagIds,
        },
      });
    operations.push({
      type: 'placement.put',
      taskId: id,
      placement:
        placement.kind === 'day'
          ? { ...placement, date }
          : { ...placement, startAt: localToUTC(startAt), endAt: localToUTC(endAt) },
    });
    setBusy(true);
    try {
      if (await onSave(operations, setError)) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className={`${s.modal} ${s.scheduleDialog}`}
      aria-labelledby="schedule-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className={s.modalHeader}>
        <div>
          <p className={s.dialogCaption}>
            {placement.kind === 'day' ? '仅安排日期' : '为专注留一段时间'}
          </p>
          <h2 id="schedule-title">添加安排</h2>
        </div>
        <button aria-label="关闭安排" disabled={busy} onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <form className={s.form} onSubmit={(event) => void submit(event)}>
        <div className={s.segmented} aria-label="安排方式">
          <button
            type="button"
            aria-pressed={mode === 'new'}
            className={mode === 'new' ? s.active : ''}
            onClick={() => {
              setMode('new');
              setDraft(emptyTaskDraft());
              setEditing(false);
            }}
          >
            新建任务
          </button>
          <button
            type="button"
            aria-pressed={mode === 'existing'}
            className={mode === 'existing' ? s.active : ''}
            onClick={() => {
              setMode('existing');
              const selected = available.find((t) => t.id === taskId);
              if (selected) setDraft(selected);
              else {
                setTaskId('');
                setDraft(emptyTaskDraft());
              }
              setEditing(false);
            }}
          >
            关联已有任务
          </button>
        </div>
        {mode === 'new' ? (
          <TaskFields workspace={workspace} draft={draft} onChange={setDraft} />
        ) : (
          <>
            <label>
              <span>
                <Search size={13} /> 搜索已有任务
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="输入任务名称或描述"
              />
            </label>
            <div className={s.taskChoices} role="group" aria-label="选择已有任务">
              {matches.length ? (
                matches.map((task) => (
                  <label
                    key={task.id}
                    className={s.taskChoice}
                    style={{ marginLeft: ancestors(task, available).length * 16 }}
                    title={taskPath(task, workspace.tasks)}
                  >
                    <input
                      type="radio"
                      name="existing-task"
                      checked={taskId === task.id}
                      onChange={() => {
                        setTaskId(task.id);
                        setDraft(task);
                        setEditing(true);
                      }}
                    />
                    <span>
                      {task.parentId && <span aria-hidden="true">↳ </span>}
                      {task.title}
                    </span>
                  </label>
                ))
              ) : (
                <p className={s.hint}>没有匹配的未完成任务。</p>
              )}
            </div>
            {taskId && (
              <button type="button" onClick={() => setEditing(!editing)}>
                {editing ? '收起任务设置' : '编辑任务设置'}
              </button>
            )}
            {editing && taskId && (
              <TaskFields workspace={workspace} draft={draft} taskId={taskId} onChange={setDraft} />
            )}
            <p className={s.hint}>
              {taskId
                ? `已选择：${available.find((task) => task.id === taskId)?.title}`
                : '为已有任务增加一次安排，保留原有安排。'}
            </p>
          </>
        )}
        {placement.kind === 'day' ? (
          <label>
            安排日期
            <input
              aria-label="安排日期"
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        ) : (
          <div className={s.formRow}>
            <label>
              开始时间
              <input
                aria-label="安排开始时间"
                type="datetime-local"
                required
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
              />
            </label>
            <label>
              结束时间
              <input
                aria-label="安排结束时间"
                type="datetime-local"
                required
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
              />
            </label>
          </div>
        )}
        <p className={s.hint}>
          {placement.kind === 'day'
            ? '只确定日期，具体时间可以之后再安排。'
            : 'Asia/Shanghai · 支持跨日，可与其他任务重叠。'}
        </p>
        {error && (
          <p role="alert" className={s.errorText}>
            {error}
          </p>
        )}
        <button className={s.primary} disabled={busy || (mode === 'existing' && !taskId)}>
          {busy ? <LoaderCircle size={16} className={s.spin} /> : <CalendarPlus size={16} />}
          {busy ? '正在保存…' : mode === 'new' ? '创建并安排' : '关联并安排'}
        </button>
      </form>
    </dialog>
  );
}
