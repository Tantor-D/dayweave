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
export function segmentsFor(tasks: Task[], date: string): Segment[] {
  const startOfDay = Date.parse(atMinute(date, 0));
  const result: Segment[] = [];
  for (const task of tasks)
    for (const placement of task.placements) {
      if (placement.kind !== 'timed') continue;
      const start = (Date.parse(placement.startAt) - startOfDay) / 60000;
      const end = (Date.parse(placement.endAt) - startOfDay) / 60000;
      if (start >= 1440 || end <= 0) continue;
      result.push({
        task,
        placement,
        date,
        start: Math.max(0, start),
        end: Math.min(1440, end),
        first: start >= 0,
        last: end <= 1440,
        lane: 0,
        lanes: 1,
      });
    }
  result.sort(
    (a, b) => a.start - b.start || b.end - a.end || a.placement.id.localeCompare(b.placement.id),
  );
  let group: Segment[] = [],
    ends: number[] = [],
    groupEnd = -1;
  const finish = () => {
    for (const segment of group) segment.lanes = ends.length;
    group = [];
    ends = [];
  };
  for (const segment of result) {
    if (segment.start >= groupEnd) {
      finish();
      groupEnd = -1;
    }
    let lane = ends.findIndex((end) => end <= segment.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = segment.end;
    segment.lane = lane;
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
