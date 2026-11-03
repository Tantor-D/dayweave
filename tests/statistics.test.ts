import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  calculateStatistics,
  defaultStatistics,
  statisticsRange,
  validStatisticsDate,
} from '../src/domain/statistics.ts';
import { emptyWorkspace } from '../src/domain/operations.ts';
import type { Task, Workspace } from '../src/domain/types.ts';
import { Store } from '../src/server/store.ts';

const instant = (date: string, clock: string) => `${date}T${clock}:00+08:00`;
const date = '2026-11-02';
function task(id: string, ranges: [string, string][], patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    status: 'todo',
    parentId: null,
    tagIds: [],
    order: 0,
    createdAt: instant(date, '00:00'),
    updatedAt: instant(date, '00:00'),
    completedAt: null,
    archivedAt: null,
    placements: ranges.map(([startAt, endAt], i) => ({
      id: `${id}-${i}`,
      kind: 'timed',
      startAt,
      endAt,
    })),
    ...patch,
  };
}
const localTask = (id: string, ranges: [string, string][], patch: Partial<Task> = {}) =>
  task(
    id,
    ranges.map(([a, b]) => [instant(date, a), instant(date, b)]),
    patch,
  );
function workspace(tasks: Task[]): Workspace {
  return {
    ...emptyWorkspace(),
    tasks,
    tags: [
      {
        id: 'personal',
        name: '个人',
        color: '#70a892',
        colorPriority: 0,
        order: 0,
        archivedAt: null,
      },
      { id: 'study', name: '研究', color: '#4167cd', colorPriority: 1, order: 1, archivedAt: null },
    ],
  };
}
const analyze = (w: Workspace, extra = {}) =>
  calculateStatistics(w, {
    startDate: date,
    endDate: date,
    now: Date.parse('2026-11-04T00:00:00+08:00'),
    tagId: 'study',
    ...extra,
  });

test('statistics: overlapping work uses union; same-task overlaps merge before counting distinct tasks', () => {
  const one = localTask('a', [
    ['09:00', '10:00'],
    ['09:30', '10:30'],
    ['09:00', '10:00'],
  ]);
  assert.equal(analyze(workspace([one])).summary.work, 90);
  assert.equal(analyze(workspace([one])).summary.parallel, 0);
  const both = analyze(workspace([one, localTask('b', [['09:00', '10:30']], { parentId: 'a' })]));
  assert.equal(both.summary.work, 90);
  assert.equal(both.summary.parallel, 90);
  assert.equal(both.summary.parallelRatio, 1);
  assert.deepEqual(both.days[0].details[0].intervals, [[540, 630]]);
  const hour = analyze(
    workspace([localTask('a', [['09:00', '10:00']]), localTask('b', [['09:00', '10:00']])]),
  );
  assert.equal(hour.summary.work, 60);
  assert.equal(hour.summary.parallelRatio, 1);
});

test('statistics: touching boundaries do not count as parallel; three concurrent tasks still count elapsed time once', () => {
  const result = analyze(
    workspace([
      localTask('a', [['09:00', '10:00']]),
      localTask('b', [['10:00', '11:00']]),
      localTask('c', [['09:30', '10:30']]),
      localTask('d', [['09:45', '10:15']]),
    ]),
  );
  assert.equal(result.summary.work, 120);
  assert.equal(result.summary.parallel, 60);
  assert.equal(
    analyze(workspace([localTask('a', [['09:00', '10:00']]), localTask('b', [['10:00', '11:00']])]))
      .summary.parallel,
    0,
  );
});

test('statistics: personal and multi-tag records overlap independently, archived and unfinished records remain included', () => {
  const w = workspace([
    localTask('work', [['09:00', '11:00']], {
      tagIds: ['study'],
      archivedAt: instant(date, '23:00'),
    }),
    localTask('private', [['10:00', '12:00']], { tagIds: ['personal', 'study'], status: 'done' }),
    localTask('private2', [['10:30', '11:30']], { tagIds: ['personal'] }),
    localTask('day', [], { placements: [{ id: 'day', kind: 'day', date }] }),
  ]);
  w.tags[0].archivedAt = instant(date, '23:00');
  const r = analyze(w);
  assert.equal(r.summary.work, 120);
  assert.equal(r.summary.personal, 120);
  assert.equal(r.summary.total, 180);
  assert.equal(r.summary.selectedTag, 180);
  assert.equal(r.summary.parallel, 0);
  assert.equal(r.summary.personalRatio, 2 / 3);
  assert.equal(r.tags.find((t) => t.id === 'study')!.minutes, 180);
  assert.equal(r.days[0].details.length, 3);
});

test('statistics: overtime crosses midnight, month and year; clips to inclusive selected dates', () => {
  for (const [from, to] of [
    ['2026-11-02', '2026-11-03'],
    ['2026-10-31', '2026-11-01'],
    ['2026-12-31', '2027-01-01'],
  ]) {
    const w = workspace([task('night', [[instant(from, '22:00'), instant(to, '02:00')]])]);
    const r = analyze(w, {
      startDate: from,
      endDate: to,
      now: Date.parse(instant('2027-02-01', '00:00')),
    });
    assert.equal(r.summary.overtime, 240);
    assert.deepEqual(
      r.days.map((d) => d.overtime),
      [120, 120],
    );
    assert.equal(r.days[1].first, null);
    assert.equal(r.summary.first, 1320);
    assert.equal(
      analyze(w, { startDate: to, endDate: to, now: Date.parse(instant('2027-02-01', '00:00')) })
        .summary.work,
      120,
    );
  }
});

test('statistics: 06:00, 12:30, 14:00 and 21:00 windows partition work correctly', () => {
  const r = analyze(
    workspace([
      localTask('a', [
        ['05:00', '07:00'],
        ['12:00', '15:00'],
        ['20:00', '22:00'],
      ]),
    ]),
  );
  assert.equal(r.summary.work, 420);
  assert.equal(r.summary.overtime, 120);
  assert.equal(r.summary.lunch, 90);
  assert.equal(r.summary.first, 360);
  assert.equal(r.days[0].last, 1320);
  const edge = analyze(
    workspace([
      localTask('a', [
        ['06:00', '12:30'],
        ['14:00', '21:00'],
      ]),
    ]),
  );
  assert.equal(edge.summary.overtime, 0);
  assert.equal(edge.summary.lunch, 0);
});

test('statistics: now truncation excludes future dates and empty days do not dilute mean first or daily work', () => {
  const r = analyze(
    workspace([
      localTask('a', [
        ['09:00', '12:00'],
        ['14:00', '15:00'],
      ]),
    ]),
    {
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      now: Date.parse(instant(date, '10:00')),
    },
  );
  assert.equal(r.summary.work, 60);
  assert.equal(r.days.length, 2);
  assert.equal(r.summary.workDays, 1);
  assert.equal(r.summary.dailyWork, 60);
  assert.equal(r.summary.first, 540);
  assert.equal(r.days[1].last, 600);
  assert.equal(analyze(workspace([])).summary.parallelRatio, null);
  assert.equal(analyze(workspace([])).summary.personalRatio, null);
  assert.equal(analyze(workspace([])).summary.first, null);
  assert.equal(
    analyze(workspace([]), { startDate: '2027-01-01', endDate: '2027-01-02' }).days.length,
    0,
  );
});

test('statistics: tag rename/delete and task edits recalculate; classification does not dynamically inherit', () => {
  const w = workspace([
    localTask('parent', [['09:00', '10:00']], { tagIds: ['personal'] }),
    localTask('child', [['09:00', '10:00']], { parentId: 'parent', tagIds: ['study'] }),
  ]);
  assert.equal(analyze(w).summary.work, 60);
  w.tags[1].name = '新名称';
  assert.equal(analyze(w).selectedTag?.name, '新名称');
  w.tags[0].name = '生活';
  assert.equal(analyze(w).personalId, null);
  assert.equal(analyze(w).summary.personal, 0);
  assert.equal(analyze(w).summary.parallel, 60);
  w.tags.splice(1, 1);
  w.tasks[1].tagIds = [];
  assert.equal(analyze(w).selectedTag, null);
  w.tasks[1].placements = [];
  assert.equal(analyze(w).summary.parallel, 0);
});

test('statistics: calendar shortcuts and strict dates are host timezone independent', () => {
  const now = Date.parse('2026-11-02T00:30:00+08:00');
  assert.deepEqual(statisticsRange({ ...defaultStatistics, range: 'week' }, now), {
    startDate: '2026-11-02',
    endDate: '2026-11-02',
  });
  assert.deepEqual(statisticsRange({ ...defaultStatistics, range: 'month' }, now), {
    startDate: '2026-11-01',
    endDate: '2026-11-02',
  });
  assert.deepEqual(statisticsRange(defaultStatistics, now), {
    startDate: '2026-10-04',
    endDate: '2026-11-02',
  });
  assert.equal(validStatisticsDate('2026-02-30'), false);
  assert.equal(validStatisticsDate('2028-02-29'), true);
  assert.throws(() => analyze(workspace([]), { startDate: '2026-11-04' }), /日期范围/);
});

test('statistics preferences: old files default safely, invalid patches preserve disk, selection and display persist across restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'statistics-'));
  const options = { dataDir: join(root, 'data'), localDir: join(root, 'local') };
  let store = await Store.open(options);
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const { statistics, ...old } = await store.getPreferences();
  const path = join(options.dataDir, 'preferences.json');
  await writeFile(path, JSON.stringify(old));
  assert.deepEqual((await store.getPreferences()).statistics, defaultStatistics);
  const saved = {
    ...defaultStatistics,
    range: 'custom' as const,
    startDate: '2026-10-01',
    endDate: '2026-11-02',
    tagId: 'study',
    hiddenCharts: ['tags' as const],
  };
  await store.updatePreferences({ statistics: saved });
  const before = await readFile(path, 'utf8');
  await assert.rejects(
    store.updatePreferences({ statistics: { ...saved, startDate: '2026-02-30' } }),
  );
  await assert.rejects(
    store.updatePreferences({ statistics: { ...saved, startDate: '2027-01-01' } }),
  );
  assert.equal(await readFile(path, 'utf8'), before);
  await store.close();
  store = await Store.open(options);
  assert.deepEqual((await store.getPreferences()).statistics, saved);
  await store.updatePreferences({ statistics: structuredClone(defaultStatistics) });
  assert.deepEqual((await store.getPreferences()).statistics, defaultStatistics);
  assert.equal((await store.getPreferences()).theme, old.theme);
});
