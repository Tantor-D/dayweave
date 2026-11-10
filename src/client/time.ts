import { ancestors, treeOrder } from '../domain/tree';
import type { Placement, Task } from '../domain/types';
export const MINUTES_PER_DAY = 1440;
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const dateOf = (iso: string) =>
  new Date(new Date(iso).getTime() + 8 * 3600000).toISOString().slice(0, 10);
export const localInput = (iso: string) =>
  new Date(new Date(iso).getTime() + 8 * 3600000).toISOString().slice(0, 16);
export const localToUTC = (value: string) => new Date(`${value}:00+08:00`).toISOString();
export const atMinute = (date: string, minute: number) =>
  new Date(new Date(`${date}T00:00:00+08:00`).getTime() + minute * 60000).toISOString();
export const addDays = (date: string, days: number) =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
export const datesFrom = (date: string, count: number) =>
  Array.from({ length: count }, (_, i) => addDays(date, i));
export const snap = (minute: number) => Math.max(0, Math.min(1425, Math.round(minute / 15) * 15));
export function placementAt(date: string, fraction?: number): Placement {
  if (fraction === undefined) return { id: crypto.randomUUID(), kind: 'day', date };
  const minute = snap(fraction * MINUTES_PER_DAY);
  return {
    id: crypto.randomUUID(),
    kind: 'timed',
    startAt: atMinute(date, minute),
    endAt: atMinute(date, minute + 60),
  };
}
export const clockLabel = (iso: string) => localInput(iso).slice(11);
export const weekday = (date: string) =>
  new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'Asia/Shanghai' }).format(
    new Date(`${date}T12:00:00+08:00`),
  );
export interface Segment {
  task: Task;
  placement: Extract<Placement, { kind: 'timed' }>;
  date: string;
  start: number;
  end: number;
  lane: number;
  lanes: number;
  first: boolean;
  last: boolean;
}
export function segmentsFor(tasks: Task[], date: string, dayStart = 0, dayEnd = 1440): Segment[] {
  const startOfDay = Date.parse(atMinute(date, 0));
  const result: Segment[] = [];
  for (const task of tasks)
    for (const placement of task.placements) {
      if (placement.kind !== 'timed') continue;
      const start = (Date.parse(placement.startAt) - startOfDay) / 60000;
      const end = (Date.parse(placement.endAt) - startOfDay) / 60000;
      if (start >= dayEnd || end <= dayStart) continue;
      result.push({
        task,
        placement,
        date,
        start: Math.max(dayStart, start),
        end: Math.min(dayEnd, end),
        first: start >= dayStart,
        last: end <= dayEnd,
        lane: 0,
        lanes: 1,
      });
    }
  result.sort(
    (a, b) => a.start - b.start || b.end - a.end || a.placement.id.localeCompare(b.placement.id),
  );
  let group: Segment[] = [];
  let groupEnd = -1;
  const finish = () => {
    const lanes: Segment[][] = [];
    // Start-time order lets each bar reuse a lane as soon as its last bar ends.
    for (const segment of group) {
      const lane = lanes.find((bars) => bars[bars.length - 1].end <= segment.start);
      if (lane) lane.push(segment);
      else lanes.push([segment]);
    }
    const rank = (a: Segment, b: Segment) =>
      a.task.order - b.task.order || a.task.id.localeCompare(b.task.id);
    // Keep task ordering as a lane preference without adding unnecessary lanes.
    const firstRanked = lanes.map((bars) => [...bars].sort(rank)[0]);
    const orderedLanes = lanes.map((bars, index) => ({ bars, first: firstRanked[index] }));
    orderedLanes.sort((a, b) => rank(a.first, b.first));
    for (const [lane, { bars }] of orderedLanes.entries())
      for (const segment of bars) {
        segment.lane = lane;
        segment.lanes = lanes.length;
      }
    group = [];
  };
  for (const segment of result) {
    if (segment.start >= groupEnd) finish();
    group.push(segment);
    groupEnd = Math.max(groupEnd, segment.end);
  }
  finish();
  return result;
}
export function taskOnDay(task: Task, date: string) {
  return task.placements.some((p) =>
    p.kind === 'day'
      ? p.date === date
      : dateOf(p.startAt) <= date && Date.parse(p.endAt) > Date.parse(atMinute(date, 0)),
  );
}

export function selectedRange(
  anchor: string,
  endpoint: string,
  id: string,
): Extract<Placement, { kind: 'timed' }> {
  const a = Date.parse(anchor),
    b = Date.parse(endpoint);
  return {
    id,
    kind: 'timed',
    startAt: new Date(Math.min(a, b)).toISOString(),
    endAt: new Date(Math.max(a, b) + (a === b ? 15 * 60000 : 0)).toISOString(),
  };
}

export type TaskDateFilter = 'all' | 'today' | 'week' | 'next3' | 'next7';
export function filterDates(filter: TaskDateFilter, base = today()): string[] {
  if (filter === 'all') return [];
  if (filter === 'week') {
    const day = new Date(base + 'T12:00:00+08:00').getUTCDay();
    return datesFrom(addDays(base, -((day + 6) % 7)), 7);
  }
  return datesFrom(base, filter === 'next3' ? 3 : filter === 'next7' ? 7 : 1);
}
export const minuteLabel = (minute: number) =>
  String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
export function parseClock(value: string): number {
  if (value === '24:00') return 1440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
export function windowMinute(
  fraction: number,
  start: number,
  end: number,
  allowEnd = false,
): number {
  const raw = Math.round((start + Math.max(0, Math.min(1, fraction)) * (end - start)) / 15) * 15;
  return Math.max(
    start,
    Math.min(allowEnd ? end : Math.max(start, end - Math.min(15, end - start)), raw),
  );
}
export function placementInWindow(
  date: string,
  fraction: number,
  start: number,
  end: number,
): Placement {
  const minute = windowMinute(fraction, start, end);
  return {
    id: crypto.randomUUID(),
    kind: 'timed',
    startAt: atMinute(date, minute),
    endAt: atMinute(date, Math.min(end, minute + 60)),
  };
}

/** Sidebar overdue status uses the latest scheduled end, not an earlier superseded placement. */
export function isOverdueTask(task: Task, base = today()): boolean {
  const midnight = Date.parse(atMinute(base, 0));
  return (
    task.status === 'todo' &&
    task.placements.length > 0 &&
    task.placements.every((p) =>
      p.kind === 'day' ? p.date < base : Date.parse(p.endAt) <= midnight,
    )
  );
}
export function matchesSidebarDate(task: Task, filter: TaskDateFilter, base = today()): boolean {
  return (
    filter === 'all' ||
    isOverdueTask(task, base) ||
    filterDates(filter, base).some((date) => taskOnDay(task, date))
  );
}

/** Ancestors without an arrangement that day are context only, never synthetic placements. */
export function dayTaskRows(
  tasks: Task[],
  allTasks: Task[],
  date: string,
  expanded: ReadonlySet<string>,
) {
  const placements = new Map(
    tasks.flatMap((task) => {
      const placement = task.placements.find((p) => p.kind === 'day' && p.date === date);
      return placement ? [[task.id, placement] as const] : [];
    }),
  );
  const ids = new Set(
    tasks
      .filter((task) => placements.has(task.id))
      .flatMap((task) => [task.id, ...ancestors(task, allTasks).map((parent) => parent.id)]),
  );
  const included = allTasks.filter((task) => ids.has(task.id));
  const parents = new Set(included.map((task) => task.parentId));
  return treeOrder(included).flatMap((task) => {
    const lineage = ancestors(task, included);
    return lineage.every((parent) => expanded.has(parent.id))
      ? [
          {
            task,
            placement: placements.get(task.id),
            depth: lineage.length,
            hasChildren: parents.has(task.id),
          },
        ]
      : [];
  });
}
