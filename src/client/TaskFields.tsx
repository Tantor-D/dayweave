import type { Task, Workspace } from '../domain/types';
import { ancestors, taskPath, treeOrder } from '../domain/tree';
import s from './App.module.css';

export type TaskDraft = Pick<Task, 'title' | 'description' | 'parentId' | 'tagIds'>;
export const emptyTaskDraft = (): TaskDraft => ({
  title: '',
  description: '',
  parentId: null,
  tagIds: [],
});
export function TaskFields({
  workspace,
  draft,
  onChange,
  taskId,
}: {
  workspace: Workspace;
  draft: TaskDraft;
  onChange: (value: TaskDraft) => void;
  taskId?: string;
}) {
  const parents = treeOrder(workspace.tasks).filter(
    (t) =>
      t.id !== taskId &&
      !t.archivedAt &&
      !ancestors(t, workspace.tasks).some((a) => a.id === taskId || a.archivedAt),
  );
  return (
    <>
      <label>
        任务名称
        <input
          aria-label="任务名称"
          required
          maxLength={1000}
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </label>
      <label>
        父任务
        <select
          aria-label="父任务"
          value={draft.parentId ?? ''}
          onChange={(e) => onChange({ ...draft, parentId: e.target.value || null })}
        >
          <option value="">无（根任务）</option>
          {draft.parentId && !parents.some((t) => t.id === draft.parentId) && (
            <option value={draft.parentId}>
              {workspace.tasks.find((t) => t.id === draft.parentId)?.title}（已归档）
            </option>
          )}
          {parents.map((t) => (
            <option key={t.id} value={t.id}>
              {taskPath(t, workspace.tasks)}
            </option>
          ))}
        </select>
      </label>
      <fieldset className={s.tagPicker}>
        <legend>标签（可多选）</legend>
        {workspace.tags
          .filter((t) => !t.archivedAt || draft.tagIds.includes(t.id))
          .map((tag) => (
            <label key={tag.id}>
              <input
                type="checkbox"
                checked={draft.tagIds.includes(tag.id)}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    tagIds: e.target.checked
                      ? [...draft.tagIds, tag.id]
                      : draft.tagIds.filter((id) => id !== tag.id),
                  })
                }
              />
              {tag.name}
              {tag.archivedAt ? '（已归档）' : ''}
            </label>
          ))}
      </fieldset>
      <label>
        说明
        <textarea
          aria-label="任务说明"
          rows={3}
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
        />
      </label>
    </>
  );
}
