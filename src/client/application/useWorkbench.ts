import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Operation,
  Placement,
  Preferences,
  Proposal,
  Snapshot,
  Workspace,
} from '../../domain/types';
import { defaultStatistics } from '../../domain/statistics';
import { ancestors, taskPath } from '../../domain/tree';
import type { TagConfirmation } from '../TagPropagationDialog';
import { readPreferences, savePreferences } from '../preferences';
import { api, commit, readWorkspace } from '../api';
import { useScheduleDrag } from '../scheduleDrag';
import { atMinute, datesFrom, today, matchesSidebarDate, type TaskDateFilter } from '../time';
const initialPreferences: Preferences = {
  statistics: structuredClone(defaultStatistics),
  theme: 'glass-light',
  days: 3,
  orientation: 'vertical',
  panelWidth: 282,
  hiddenTags: [],
  hiddenTasks: [],
  hiddenStatuses: [],
  showArchived: false,
  dayStart: 0,
  dayEnd: 1440,
  inheritParentTags: true,
};
type Panel =
  | 'task'
  | 'background'
  | 'review'
  | 'history'
  | 'settings'
  | 'filters'
  | 'organization'
  | 'proposals';
export function useWorkbench() {
  const [todoEditing, setTodoEditing] = useState(false);
  const [statisticsEditing, setStatisticsEditing] = useState(false);
  const [view, setView] = useState<'workbench' | 'statistics' | 'todo'>('workbench');
  const [snapshot, setSnapshot] = useState<Snapshot<Workspace>>(),
    [preferences, setPreferences] = useState(initialPreferences),
    [proposals, setProposals] = useState<Proposal[]>([]),
    [date, setDate] = useState(today()),
    [panel, setPanel] = useState<Panel>(),
    [selected, setSelected] = useState<string>(),
    [search, setSearch] = useState(''),
    [dateFilter, setDateFilter] = useState<TaskDateFilter>('all'),
    [newTask, setNewTask] = useState(false),
    [schedule, setSchedule] = useState<{ placement: Placement; base: Snapshot<Workspace> }>(),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(true),
    [toast, setToast] = useState<{ message: string; error: boolean }>(),
    [bootError, setBootError] = useState(''),
    [tagConfirmation, setTagConfirmation] = useState<TagConfirmation>();
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
    void readPreferences()
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
    async (
      operations: Operation[],
      summary: string,
      base?: Snapshot<Workspace>,
      reportError?: (message: string) => void,
    ) => {
      const snap = base ?? snapshotRef.current;
      if (!snap) return false;
      const prepared: Operation[] = [];
      for (const original of operations) {
        let op = original;
        if (
          op.type === 'task.update' &&
          op.patch.parentId &&
          preferencesRef.current.inheritParentTags
        ) {
          const change = op;
          const task = snap.data.tasks.find((t) => t.id === change.id);
          const parent = snap.data.tasks.find((t) => t.id === change.patch.parentId);
          if (task && parent && task.parentId !== parent.id)
            op = {
              ...op,
              patch: {
                ...op.patch,
                tagIds: [...new Set([...(op.patch.tagIds ?? task.tagIds), ...parent.tagIds])],
              },
            };
        }
        if (op.type === 'task.update' && op.patch.tagIds && op.propagateTags === undefined) {
          const task = snap.data.tasks.find((t) => t.id === op.id);
          const count = snap.data.tasks.filter((t) =>
            ancestors(t, snap.data.tasks).some((a) => a.id === op.id),
          ).length;
          if (
            task &&
            count &&
            (task.tagIds.some((id) => !op.patch.tagIds!.includes(id)) ||
              op.patch.tagIds.some((id) => !task.tagIds.includes(id)))
          ) {
            const names = (ids: string[]) =>
              ids.map((id) => snap.data.tags.find((t) => t.id === id)?.name ?? id);
            const answer = await new Promise<boolean | null>((resolve) =>
              setTagConfirmation({
                title: task.title,
                count,
                added: names(op.patch.tagIds!),
                removed: names(task.tagIds.filter((id) => !op.patch.tagIds!.includes(id))),
                resolve,
              }),
            );
            if (answer === null) return false;
            prepared.push({ ...op, propagateTags: answer });
            continue;
          }
        }
        prepared.push(op);
      }
      setBusy(true);
      try {
        await commit(snap, prepared, summary);
        await refresh();
        notify('已保存');
        return true;
      } catch (e) {
        reportError?.((e as Error).message);
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
    if (!patch.theme) setPreferences({ ...before, ...patch });
    try {
      setPreferences(await savePreferences(patch));
      return true;
    } catch (e) {
      setPreferences(before);
      notify((e as Error).message, true);
      return false;
    }
  };
  const { drag, start, canClick } = useScheduleDrag(
    (ops, summary) => save(ops, summary, snapshot),
    snapshot?.data.tasks ?? [],
  );
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
        const lineage = [task, ...ancestors(task, workspace.tasks)];
        return (
          (preferences.showArchived || lineage.every((t) => !t.archivedAt)) &&
          !lineage.some((t) => preferences.hiddenTasks.includes(t.id)) &&
          !task.tagIds.some((id) => preferences.hiddenTags.includes(id)) &&
          !preferences.hiddenStatuses.includes(task.status) &&
          (!search ||
            `${taskPath(task, workspace.tasks)} ${task.description}`
              .toLowerCase()
              .includes(search.toLowerCase()))
        );
      })
      .sort((a, b) => a.order - b.order) || [];
  const sidebarHits = filteredTasks.filter((task) => matchesSidebarDate(task, dateFilter));
  const sidebarIds = new Set(
    sidebarHits.flatMap((t) => [t.id, ...ancestors(t, workspace?.tasks ?? []).map((a) => a.id)]),
  );
  const sidebarTasks = workspace?.tasks.filter((t) => sidebarIds.has(t.id)) ?? [];
  const filterCount =
    preferences.hiddenTags.length +
    preferences.hiddenTasks.length +
    preferences.hiddenStatuses.length;
  const pending = proposals.filter((p) => p.status === 'pending_confirmation').length;
  const loadExample = async () => {
    if (!workspace) return;
    const rootId = crypto.randomUUID(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID();
    await save(
      [
        {
          type: 'task.create',
          id: rootId,
          title: '我的第一组任务',
          description: '这是一组可编辑、可归档的示例。',
        },
        {
          type: 'task.create',
          id: a,
          title: '为今天选一个重点',
          parentId: rootId,
          tagIds: workspace.tags.filter((t) => t.name === 'P1').map((t) => t.id),
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
  return {
    todoEditing,
    setTodoEditing,
    statisticsEditing,
    setStatisticsEditing,
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
  };
}
export type Workbench = ReturnType<typeof useWorkbench>;
