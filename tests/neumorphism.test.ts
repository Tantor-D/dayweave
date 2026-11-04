import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.ts';
import { defaultNeumorphism } from '../src/domain/neumorphism.ts';
import { neumorphismSchema } from '../src/domain/schema.ts';
import { neumorphismTokens } from '../src/client/presentations/neumorphism/themes.ts';

test('neumorphism validates complete settings and rejects unsafe ranges', () => {
  assert.deepEqual(neumorphismSchema.parse(defaultNeumorphism), defaultNeumorphism);
  for (const patch of [
    { background: '#111111' },
    { background: 'red' },
    { accent: '#xyzxyz' },
    { radius: 33 },
    { distance: 1 },
    { intensity: 0.3 },
    { blur: 37 },
    { light: 'left' },
    { unexpected: true },
  ]) {
    assert.equal(neumorphismSchema.safeParse({ ...defaultNeumorphism, ...patch }).success, false);
  }
});
test('light direction reverses relief, while accent foreground remains readable', () => {
  const a = neumorphismTokens();
  const b = neumorphismTokens({ ...defaultNeumorphism, light: 'bottom-right' });
  assert.match(a['--shadow'], /^11px 11px/);
  assert.match(b['--shadow'], /^-11px -11px/);
  assert.equal(
    neumorphismTokens({ ...defaultNeumorphism, accent: '#ffffff' })['--on-accent'],
    '#000000',
  );
  assert.equal(
    neumorphismTokens({ ...defaultNeumorphism, accent: '#000000' })['--on-accent'],
    '#ffffff',
  );
});
test('old preferences acquire defaults and settings survive restarts and unrelated patches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'neumorphism-'));
  const options = { dataDir: join(root, 'data'), localDir: join(root, 'local') };
  let store = await Store.open(options);
  try {
    const old = await store.getPreferences();
    assert.equal(old.theme, 'neumorphism-light');
    assert.equal(old.days, 1);
    assert.equal(old.orientation, 'vertical');
    assert.equal(old.showUntimed, false);
    assert.equal(old.dayStart, 600);
    assert.equal(old.dayEnd, 1290);
    assert.equal(old.autoCompleteParents, false);
    assert.equal(old.statistics.range, 'week');
    assert.deepEqual(old.neumorphism, defaultNeumorphism);
    delete old.neumorphism;
    await writeFile(join(options.dataDir, 'preferences.json'), JSON.stringify(old));
    assert.deepEqual((await store.getPreferences()).neumorphism, defaultNeumorphism);
    const before = await store.read('workspace');
    const custom = {
      ...defaultNeumorphism,
      background: '#ebe5dc',
      radius: 28,
      light: 'bottom-right' as const,
    };
    await store.updatePreferences({ theme: 'neumorphism-light', neumorphism: custom });
    await store.close();
    store = await Store.open(options);
    assert.deepEqual((await store.getPreferences()).neumorphism, custom);
    await store.updatePreferences({ theme: 'glass-light' });
    assert.deepEqual((await store.getPreferences()).neumorphism, custom);
    await assert.rejects(store.updatePreferences({ neumorphism: { ...custom, blur: -1 } }));
    assert.deepEqual((await store.getPreferences()).neumorphism, custom);
    assert.equal((await store.read('workspace')).hash, before.hash);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
