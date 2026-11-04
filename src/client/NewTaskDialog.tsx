import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, Plus, X } from 'lucide-react';
import type { Operation, Workspace } from '../domain/types';
import { TaskFields, emptyTaskDraft } from './TaskFields';
import { today } from './time';
import { useAppearance } from './presentations/Appearance';
export function NewTaskDialog({
  workspace,
  onCreate,
  onClose,
}: {
  workspace: Workspace;
  onCreate: (ops: Operation[]) => Promise<void>;
  onClose: () => void;
}) {
  const { controls: s } = useAppearance();
  const [draft, setDraft] = useState(emptyTaskDraft),
    [scheduledDate, setScheduledDate] = useState(today),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const taskId = crypto.randomUUID();
    try {
      await onCreate([
        {
          type: 'task.create',
          id: taskId,
          ...draft,
        },
        {
          type: 'placement.put',
          taskId,
          placement: { id: crypto.randomUUID(), kind: 'day', date: scheduledDate },
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
            <h2 id="new-task-title">新建任务</h2>
          </div>
          <button aria-label="关闭新建任务" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <form className={s.form} onSubmit={(e) => void submit(e)}>
          <TaskFields workspace={workspace} draft={draft} onChange={setDraft} />
          <label>
            安排日期
            <input
              type="date"
              aria-label="新任务安排日期"
              required
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </label>
          <p className={s.hint}>默认安排到今天，不指定起止时间。</p>
          <button className={s.primary} disabled={busy}>
            {busy ? <LoaderCircle className={s.spin} size={15} /> : <Plus size={15} />}创建任务
          </button>
        </form>
      </div>
    </div>
  );
}
