import test from 'node:test';
import { defaultLiquidGlass } from '../src/domain/liquid-glass';
import assert from 'node:assert/strict';
import { readPreferences, savePreferences } from '../src/client/preferences.ts';
import { defaultStatistics, statisticsRange } from '../src/domain/statistics.ts';

test('legacy running backend responses retain statistics defaults on initial load and preference saves', async (t) => {
  const legacy = {
    theme: 'glass-light',
    days: 3,
    orientation: 'vertical',
    panelWidth: 300,
    hiddenTags: [],
    hiddenTasks: [],
    hiddenStatuses: [],
    showArchived: false,
    dayStart: 0,
    dayEnd: 1440,
    inheritParentTags: true,
  };
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(`${init?.method ?? 'GET'} ${input}`);
    return new Response(
      JSON.stringify(
        String(input) === '/api/session'
          ? { token: 'test-session' }
          : { ...legacy, ...(init?.body ? JSON.parse(String(init.body)) : {}) },
      ),
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const loaded = await readPreferences();
  assert.deepEqual(loaded.statistics, defaultStatistics);
  assert.deepEqual(loaded.liquidGlass, defaultLiquidGlass);
  assert.equal(loaded.showUntimed, false);
  assert.equal((await savePreferences({ showUntimed: true })).showUntimed, true);
  assert.doesNotThrow(() =>
    statisticsRange(loaded.statistics, Date.parse('2026-11-03T12:00:00+08:00')),
  );
  const saved = await savePreferences({ theme: 'glass-dark' });
  assert.equal(saved.theme, 'glass-dark');
  assert.deepEqual(saved.statistics, defaultStatistics);
  const configured = { ...defaultStatistics, range: 'week' as const, tagId: 'personal' };
  assert.deepEqual((await savePreferences({ statistics: configured })).statistics, configured);
  assert.ok(requests.includes('GET /api/preferences'));
  assert.ok(requests.includes('PATCH /api/preferences'));
});
