import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Operation, Placement, Task } from '../domain/types';
import { ancestors } from '../domain/tree';
import { atMinute, windowMinute } from './time';
export type DragMode = 'move' | 'start' | 'end';
export interface DragStart {
  (event: ReactPointerEvent, task: Task, placement?: Placement, mode?: DragMode): void;
}
export interface DragState {
  task: Task;
  original?: Placement;
  mode: DragMode;
  x: number;
  y: number;
  moved: boolean;
  offset: number;
  preview?: Placement;
  parentTarget?: { id: string; title: string };
  rootTarget?: boolean;
  sortTarget?: { id: string; title: string; side: 'before' | 'after' };
}
export function useScheduleDrag(
  save: (ops: Operation[], summary: string) => Promise<unknown>,
  tasks: Task[] = [],
) {
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [drag, setDrag] = useState<DragState | null>(null);
  const latest = useRef<DragState | null>(null),
    suppressedUntil = useRef(0),
    saveRef = useRef(save),
    dragSaveRef = useRef(save);
  saveRef.current = save;
  const start: DragStart = (event, task, placement, mode = 'move') => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,select,textarea'))
      return;
    event.stopPropagation();
    const cell = (event.currentTarget as HTMLElement).closest(
      '[data-time-date]',
    ) as HTMLElement | null;
    let offset = 0;
    if (placement?.kind === 'timed' && cell && mode === 'move') {
      const rect = cell.getBoundingClientRect();
      const ratio =
        cell.dataset.axis === 'horizontal'
          ? (event.clientX - rect.left) / rect.width
          : (event.clientY - rect.top) / rect.height;
      offset =
        Date.parse(
          atMinute(
            cell.dataset.timeDate!,
            Number(cell.dataset.dayStart ?? 0) +
              ratio * (Number(cell.dataset.dayEnd ?? 1440) - Number(cell.dataset.dayStart ?? 0)),
          ),
        ) - Date.parse(placement.startAt);
    }
    const next = {
      task,
      original: placement,
      mode,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      offset,
    };
    dragSaveRef.current = saveRef.current;
    latest.current = next;
    setDrag(next);
  };
  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const previous = latest.current;
      if (!previous) return;
      if (!previous.moved && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 5)
        return;
      event.preventDefault();
      const el = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest(
          '[data-time-date],[data-day-date],[data-task-drop],[data-root-drop]',
        ) as HTMLElement | null;
      const rootTarget =
        !previous.original && !!previous.task.parentId && el?.dataset.rootDrop !== undefined;
      let preview: Placement | undefined;
      const target = tasksRef.current.find((t) => t.id === el?.dataset.taskDrop);
      const rect = el?.getBoundingClientRect();
      const position = rect ? (event.clientY - rect.top) / rect.height : 0.5;
      const sortTarget =
        !previous.original &&
        target &&
        target.id !== previous.task.id &&
        target.parentId === previous.task.parentId &&
        (position < 0.25 || position > 0.75)
          ? {
              id: target.id,
              title: target.title,
              side: position < 0.25 ? ('before' as const) : ('after' as const),
            }
          : undefined;
      const parentTarget =
        !sortTarget &&
        !previous.original &&
        target &&
        target.id !== previous.task.id &&
        !ancestors(target, tasksRef.current).some((t) => t.id === previous.task.id)
          ? { id: target.id, title: target.title }
          : undefined;
      if (el?.dataset.dayDate && previous.mode === 'move')
        preview = {
          id: previous.original?.id ?? crypto.randomUUID(),
          kind: 'day',
          date: el.dataset.dayDate,
        };
      if (el?.dataset.timeDate) {
        const rect = el.getBoundingClientRect();
        const ratio =
          el.dataset.axis === 'horizontal'
            ? (event.clientX - rect.left) / rect.width
            : (event.clientY - rect.top) / rect.height;
        const original = previous.original?.kind === 'timed' ? previous.original : undefined;
        const dayStart = Number(el.dataset.dayStart ?? 0),
          dayEnd = Number(el.dataset.dayEnd ?? 1440);
        const raw = atMinute(
          el.dataset.timeDate!,
          windowMinute(ratio, dayStart, dayEnd, previous.mode === 'end'),
        );
        if (previous.mode === 'start' && original)
          preview = {
            ...original,
            startAt: new Date(
              Math.min(Date.parse(raw), Date.parse(original.endAt) - 900000),
            ).toISOString(),
          };
        else if (previous.mode === 'end' && original)
          preview = {
            ...original,
            endAt: new Date(
              Math.max(Date.parse(raw), Date.parse(original.startAt) + 900000),
            ).toISOString(),
          };
        else {
          const shifted = Date.parse(raw) - previous.offset;
          const startAt = new Date(Math.round(shifted / 900000) * 900000).toISOString();
          preview = {
            id: previous.original?.id ?? crypto.randomUUID(),
            kind: 'timed',
            startAt,
            endAt: new Date(
              Date.parse(startAt) +
                (original
                  ? Date.parse(original.endAt) - Date.parse(original.startAt)
                  : Math.min(
                      3600000,
                      Date.parse(atMinute(el.dataset.timeDate!, dayEnd)) - Date.parse(startAt),
                    )),
            ).toISOString(),
          };
        }
      }
      const next = {
        ...previous,
        moved: true,
        x: event.clientX,
        y: event.clientY,
        preview,
        parentTarget,
        rootTarget,
        sortTarget,
      };
      latest.current = next;
      setDrag(next);
    };
    const stop = () => {
      const current = latest.current;
      latest.current = null;
      setDrag(null);
      if (current?.moved) {
        suppressedUntil.current = Date.now() + 350;
        if (current.rootTarget) {
          const order =
            Math.max(-1, ...tasksRef.current.filter((t) => !t.parentId).map((t) => t.order)) + 1;
          void dragSaveRef.current(
            [{ type: 'task.update', id: current.task.id, patch: { parentId: null, order } }],
            '设为一级任务',
          );
        } else if (current.sortTarget) {
          const siblings = tasksRef.current
            .filter((t) => t.parentId === current.task.parentId && t.id !== current.task.id)
            .sort((a, b) => a.order - b.order);
          const targetIndex = siblings.findIndex((t) => t.id === current.sortTarget!.id);
          if (targetIndex >= 0) {
            siblings.splice(
              targetIndex + (current.sortTarget.side === 'after' ? 1 : 0),
              0,
              current.task,
            );
            void dragSaveRef.current(
              siblings.map((t, order) => ({ type: 'task.update', id: t.id, patch: { order } })),
              '调整同级任务顺序',
            );
          }
        } else if (current.parentTarget)
          void dragSaveRef.current(
            [
              {
                type: 'task.update',
                id: current.task.id,
                patch: { parentId: current.parentTarget.id },
              },
            ],
            '调整父任务',
          );
        else if (current.preview)
          void dragSaveRef.current(
            [{ type: 'placement.put', taskId: current.task.id, placement: current.preview }],
            `安排「${current.task.title}」`,
          );
      }
    };
    const cancel = () => {
      latest.current = null;
      setDrag(null);
      suppressedUntil.current = Date.now() + 350;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      document.body.style.userSelect = '';
    };
  }, [!!drag]);
  return { drag, start, canClick: () => Date.now() > suppressedUntil.current };
}
