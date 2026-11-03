import { createContext, useContext, useState, useId } from 'react';
import type { Task, Workspace } from '../domain/types';
import { ancestors, taskPath, treeOrder } from '../domain/tree';
import s from './App.module.css';

export const InheritTagsContext = createContext(true);

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
  const listId = useId();
  const inherit = useContext(InheritTagsContext);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const parents = treeOrder(workspace.tasks).filter(
    (t) =>
      t.id !== taskId &&
      !t.archivedAt &&
      t.status !== 'done' &&
      !ancestors(t, workspace.tasks).some((a) => a.id === taskId || a.archivedAt),
  );
  const matches = parents.filter((t) =>
    taskPath(t, workspace.tasks).toLowerCase().includes(query.toLowerCase()),
  );
  const selected = workspace.tasks.find((t) => t.id === draft.parentId);
  const choose = (id: string | null) => {
    const parent = workspace.tasks.find((t) => t.id === id);
    onChange({
      ...draft,
      parentId: id,
      tagIds:
        inherit && parent && id !== draft.parentId
          ? [...new Set([...draft.tagIds, ...parent.tagIds])]
          : draft.tagIds,
    });
    setOpen(false);
    setQuery('');
    setActive(0);
  };
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
      <div
        className={s.parentPicker}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setOpen(false);
            setQuery('');
          }
        }}
      >
        <label>
          父任务
          <input
            role="combobox"
            aria-label="父任务"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && matches[active] ? listId + '-' + matches[active].id : undefined
            }
            value={open ? query : selected ? taskPath(selected, workspace.tasks) : ''}
            placeholder="输入名称检索未完成任务（留空可选根任务）"
            onFocus={() => {
              setOpen(true);
              setQuery('');
              setActive(0);
            }}
            onClick={() => {
              if (!open) {
                setOpen(true);
                setQuery('');
                setActive(0);
              }
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActive(Math.min(active + 1, matches.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(Math.max(0, active - 1));
              }
              if (e.key === 'Enter' && open) {
                e.preventDefault();
                if (matches[active]) choose(matches[active].id);
              }
              if (e.key === 'Escape' && open) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                setQuery('');
              }
            }}
          />
        </label>
        {open && (
          <div id={listId} role="listbox" aria-label="父任务候选" className={s.parentOptions}>
            <button
              type="button"
              role="option"
              aria-selected={!draft.parentId}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(null)}
            >
              无（根任务）
            </button>
            {matches.map((t, i) => (
              <button
                key={t.id}
                id={listId + '-' + t.id}
                type="button"
                role="option"
                aria-selected={draft.parentId === t.id}
                className={i === active ? s.active : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(t.id)}
              >
                {taskPath(t, workspace.tasks)}
              </button>
            ))}
            {!matches.length && <p className={s.hint}>没有匹配的未完成任务。</p>}
          </div>
        )}
        {selected?.status === 'done' && (
          <small>当前父任务已完成；可保留归属或选择其他未完成任务。</small>
        )}
      </div>
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
