import type { Workspace, StatisticsPreferences } from './types.ts';

export const defaultStatistics: StatisticsPreferences = {
  range: 'last30',
  startDate: null,
  endDate: null,
  tagId: null,
  hiddenCharts: [],
};
const DAY = 86400000;
const MINUTE = 60000;
export const statisticsDate = (instant: number) =>
  new Date(instant + 8 * 3600000).toISOString().slice(0, 10);
export const dateStart = (date: string) => Date.parse(`${date}T00:00:00+08:00`);
export function validStatisticsDate(date: string): boolean {
  const ms = dateStart(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(ms) && statisticsDate(ms) === date;
}
export function statisticsRange(preferences: StatisticsPreferences, now: number) {
  const endDate = statisticsDate(now);
  const day = dateStart(endDate);
  if (preferences.range === 'custom' && preferences.startDate && preferences.endDate)
    return { startDate: preferences.startDate, endDate: preferences.endDate };
  const weekday = new Date(day + 8 * 3600000).getUTCDay();
  return {
    startDate:
      preferences.range === 'month'
        ? `${endDate.slice(0, 7)}-01`
        : statisticsDate(day - (preferences.range === 'week' ? (weekday + 6) % 7 : 29) * DAY),
    endDate,
  };
}
type Interval = [number, number];
function union(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
const duration = (intervals: Interval[]) => intervals.reduce((sum, [a, b]) => sum + b - a, 0);
const overlap = (intervals: Interval[], start: number, end: number) =>
  intervals.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, end) - Math.max(a, start)), 0);
export const ratio = (part: number, total: number) => (total ? part / total : null);
export interface StatisticsDetail {
  taskId: string;
  title: string;
  personal: boolean;
  tagIds: string[];
  intervals: Interval[];
}
export interface StatisticsDay {
  date: string;
  work: number;
  overtime: number;
  lunch: number;
  parallel: number;
  personal: number;
  total: number;
  selectedTag: number;
  first: number | null;
  last: number | null;
  parallelRatio: number | null;
  details: StatisticsDetail[];
}
export function calculateStatistics(
  workspace: Workspace,
  input: { startDate: string; endDate: string; tagId: string | null; now: number },
) {
  if (
    !validStatisticsDate(input.startDate) ||
    !validStatisticsDate(input.endDate) ||
    input.startDate > input.endDate ||
    !Number.isFinite(input.now)
  )
    throw new Error('统计日期范围无效');
  const start = dateStart(input.startDate);
  const end = Math.min(dateStart(input.endDate) + DAY, input.now);
  const personalId = workspace.tags.find((tag) => tag.name === '个人')?.id ?? null;
  const selectedTag = workspace.tags.find((tag) => tag.id === input.tagId) ?? null;
  const records = workspace.tasks
    .map((task) => ({
      task,
      intervals: union(
        task.placements.flatMap((p): Interval[] => {
          if (p.kind !== 'timed') return [];
          const a = Math.max(start, Date.parse(p.startAt)),
            b = Math.min(end, Date.parse(p.endAt));
          return a < b ? [[a, b]] : [];
        }),
      ),
    }))
    .filter((r) => r.intervals.length);
  const days: StatisticsDay[] = [];
  // Future dates are excluded from both charts and denominators.
  for (let day = start; day < end; day += DAY) {
    const details: StatisticsDetail[] = records.flatMap(({ task, intervals }) => {
      const clipped = intervals.flatMap(([a, b]): Interval[] => {
        const from = Math.max(a, day),
          to = Math.min(b, day + DAY);
        return from < to ? [[(from - day) / MINUTE, (to - day) / MINUTE]] : [];
      });
      return clipped.length
        ? [
            {
              taskId: task.id,
              title: task.title,
              personal: task.tagIds.includes(personalId ?? ''),
              tagIds: task.tagIds,
              intervals: clipped,
            },
          ]
        : [];
    });
    const workIntervals = details.filter((d) => !d.personal).flatMap((d) => d.intervals);
    const workUnion = union(workIntervals);
    const events = new Map<number, number>();
    for (const [a, b] of workIntervals) {
      events.set(a, (events.get(a) ?? 0) + 1);
      events.set(b, (events.get(b) ?? 0) - 1);
    }
    let count = 0,
      previous = 0,
      parallel = 0;
    for (const [minute, delta] of [...events].sort((a, b) => a[0] - b[0])) {
      if (count >= 2) parallel += minute - previous;
      count += delta;
      previous = minute;
    }
    const work = duration(workUnion);
    const first = workUnion.find(([, b]) => b > 360);
    days.push({
      date: statisticsDate(day),
      work,
      parallel,
      parallelRatio: ratio(parallel, work),
      overtime: overlap(workUnion, 0, 360) + overlap(workUnion, 1260, 1440),
      lunch: overlap(workUnion, 750, 840),
      personal: duration(union(details.filter((d) => d.personal).flatMap((d) => d.intervals))),
      total: duration(union(details.flatMap((d) => d.intervals))),
      selectedTag: duration(
        union(
          details
            .filter((d) => selectedTag && d.tagIds.includes(selectedTag.id))
            .flatMap((d) => d.intervals),
        ),
      ),
      first: first ? Math.max(360, first[0]) : null,
      last: workUnion.at(-1)?.[1] ?? null,
      details: details.sort(
        (a, b) => a.intervals[0][0] - b.intervals[0][0] || a.taskId.localeCompare(b.taskId),
      ),
    });
  }
  const sum = (
    key: 'work' | 'overtime' | 'lunch' | 'parallel' | 'personal' | 'total' | 'selectedTag',
  ) => days.reduce((s, d) => s + d[key], 0);
  const firsts = days.flatMap((d) => (d.first === null ? [] : [d.first]));
  const workDays = days.filter((d) => d.work > 0).length;
  const total = sum('total'),
    work = sum('work'),
    personal = sum('personal'),
    tagTime = sum('selectedTag');
  return {
    days,
    personalId,
    selectedTag,
    summary: {
      work,
      overtime: sum('overtime'),
      lunch: sum('lunch'),
      parallel: sum('parallel'),
      parallelRatio: ratio(sum('parallel'), work),
      total,
      personal,
      personalRatio: ratio(personal, total),
      personalDays: days.filter((d) => d.personal > 0).length,
      selectedTag: tagTime,
      selectedTagRatio: ratio(tagTime, total),
      selectedTagDays: days.filter((d) => d.selectedTag > 0).length,
      workDays,
      dailyWork: workDays ? work / workDays : null,
      first: firsts.length ? firsts.reduce((a, b) => a + b, 0) / firsts.length : null,
    },
    tags: workspace.tags
      .map((tag) => ({
        ...tag,
        minutes:
          duration(
            union(
              records
                .filter(({ task }) => task.tagIds.includes(tag.id))
                .flatMap((r) => r.intervals),
            ),
          ) / MINUTE,
      }))
      .sort((a, b) => b.minutes - a.minutes || a.order - b.order || a.id.localeCompare(b.id)),
  };
}
export type StatisticsResult = ReturnType<typeof calculateStatistics>;
