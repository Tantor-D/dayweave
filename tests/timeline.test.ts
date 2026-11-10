import test from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/domain/types';
import {
  addDays,
  atMinute,
  dateOf,
  localInput,
  localToUTC,
  placementAt,
  segmentsFor,
  snap,
  taskOnDay,
} from '../src/client/time';
const date = '2026-11-03';
test('timeline clicks snap to 15 minutes, clamp edges and keep full duration across midnight', () => {
  const day = placementAt(date);
  assert.equal(day.kind, 'day');
  if (day.kind === 'day') assert.equal(day.date, date);
  for (const [fraction, minute] of [
    [-0.01, 0],
    [549 / 1440, 555],
    [1, 1425],
  ]) {
    const result = placementAt(date, fraction);
    assert.equal(result.kind, 'timed');
    if (result.kind === 'timed') {
      assert.equal(result.startAt, atMinute(date, minute));
      assert.equal(Date.parse(result.endAt) - Date.parse(result.startAt), 3600000);
    }
  }
});
const task = (id: string, start: number, end: number): Task => ({
  id,
  title: id,
  description: '',
  status: 'todo',
  parentId: null,
  tagIds: ['P2'],
  order: 0,
  createdAt: atMinute(date, 0),
  updatedAt: atMinute(date, 0),
  completedAt: null,
  archivedAt: null,
  placements: [
    {
      id: `placement-${id}`,
      kind: 'timed',
      startAt: atMinute(date, start),
      endAt: atMinute(date, end),
    },
  ],
});
test('Shanghai dates and local forms round-trip independently of host timezone', () => {
  assert.equal(atMinute(date, 0), '2026-11-02T16:00:00.000Z');
  assert.equal(dateOf('2026-11-02T16:00:00.000Z'), date);
  assert.equal(localInput(atMinute(date, 543)), '2026-11-03T09:03');
  assert.equal(localToUTC('2026-11-03T09:03'), atMinute(date, 543));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(snap(549), 555);
  assert.equal(snap(-1), 0);
  assert.equal(snap(1440), 1425);
});
test('cross-midnight placements split into display segments preserving identity', () => {
  const original = task('night', 23 * 60, 25 * 60 + 15);
  const first = segmentsFor([original], date)[0],
    second = segmentsFor([original], addDays(date, 1))[0];
  assert.equal(first.start, 1380);
  assert.equal(first.end, 1440);
  assert.equal(first.first, true);
  assert.equal(first.last, false);
  assert.equal(second.start, 0);
  assert.equal(second.end, 75);
  assert.equal(second.first, false);
  assert.equal(second.last, true);
  assert.equal(first.placement.id, second.placement.id);
  assert.equal(taskOnDay(original, date), true);
  assert.equal(taskOnDay(original, addDays(date, 1)), true);
  assert.equal(taskOnDay(original, addDays(date, 2)), false);
});
test('unlimited overlap gives each simultaneous task a lane without dropping records', () => {
  const tasks = Array.from({ length: 12 }, (_, i) => task(`t${i}`, 540, 600));
  const result = segmentsFor(tasks, date);
  assert.equal(result.length, 12);
  assert.equal(new Set(result.map((s) => s.lane)).size, 12);
  assert.ok(result.every((s) => s.lanes === 12));
});
test('touching intervals reuse lanes and separate overlap groups use local counts', () => {
  const result = segmentsFor(
    [task('a', 60, 120), task('b', 90, 180), task('c', 180, 240), task('d', 240, 300)],
    date,
  );
  assert.deepEqual(
    result.map((s) => [s.task.id, s.lane, s.lanes]),
    [
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 1],
      ['d', 0, 1],
    ],
  );
});
test('an event ending exactly at midnight is excluded from the following day', () => {
  const ending = task('ending', 1380, 1440);
  assert.equal(segmentsFor([ending], addDays(date, 1)).length, 0);
  assert.equal(taskOnDay(ending, addDays(date, 1)), false);
});

test('chain overlaps reuse two lanes when the first bar ends before the third starts', () => {
  const tasks = [task('a', 915, 975), task('b', 960, 1050), task('c', 1020, 1050)];
  for (const input of [tasks, [...tasks].reverse()]) {
    const result = segmentsFor(input, date);
    assert.ok(result.every((s) => s.lanes === 2), 'chain overlap must use only two lanes');
    assert.equal(result[0].lane, result[2].lane);
    assert.notEqual(result[0].lane, result[1].lane);
  }
});

test('repeated tasks keep their relative lanes and a long placement stays one bar', () => {
  const long = { ...task('a', 840, 1080), order: 2 };
  const first = { ...task('z', 855, 960), order: 0 };
  const middle = { ...task('m', 855, 900), order: 1 };
  long.placements.unshift(...task('evening-a', 1140, 1230).placements);
  first.placements.push(...task('evening-z', 1140, 1230).placements);

  for (const tasks of [
    [long, middle, first],
    [first, middle, long],
  ]) {
    const segments = segmentsFor(tasks, date);
    const bars = (id: string) =>
      segments.filter((s) => s.task.id === id).map((s) => [s.start, s.end, s.lane, s.lanes]);
    assert.deepEqual(bars('a'), [
      [840, 1080, 2, 3],
      [1140, 1230, 1, 2],
    ]);
    assert.deepEqual(bars('z'), [
      [855, 960, 0, 3],
      [1140, 1230, 0, 2],
    ]);
    assert.deepEqual(bars('m'), [[855, 900, 1, 3]]);
  }
});
