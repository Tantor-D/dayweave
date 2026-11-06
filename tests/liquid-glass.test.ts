import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultLiquidGlass, maxBackgroundLength } from '../src/domain/liquid-glass';
import { liquidGlassSchema } from '../src/domain/schema';
import { Store } from '../src/server/store';
import { prepareBackground } from '../src/client/presentations/liquid-glass/background';

const image = 'data:image/jpeg;base64,/9j/AAAAAAAAAAAA';
test('liquid glass accepts bounded local JPEG data and rejects external or active content', () => {
  assert.deepEqual(liquidGlassSchema.parse(defaultLiquidGlass), defaultLiquidGlass);
  assert.doesNotThrow(() =>
    liquidGlassSchema.parse({ backgroundImage: image, backgroundBlur: 40 }),
  );
  for (const patch of [
    { backgroundImage: 'https://example.com/background.jpg' },
    { backgroundImage: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { backgroundImage: 'data:image/jpeg;base64,invalid' },
    { backgroundImage: image + 'A'.repeat(maxBackgroundLength) },
    { backgroundImage: image + '\n' },
    { backgroundBlur: -1 },
    { backgroundBlur: 41 },
    { backgroundBlur: 1.5 },
    { unexpected: true },
  ])
    assert.equal(liquidGlassSchema.safeParse({ ...defaultLiquidGlass, ...patch }).success, false);
});

test('upload rejects unsupported and oversized files before attempting to decode them', async () => {
  await assert.rejects(
    prepareBackground(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })),
    /JPG/,
  );
  await assert.rejects(
    prepareBackground(
      new File([new Uint8Array(12 * 1024 * 1024 + 1)], 'x.jpg', { type: 'image/jpeg' }),
    ),
    /12MB/,
  );
});

test('wallpaper survives restart and unrelated patches; old preferences default and removal persists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liquid-glass-'));
  const options = { dataDir: join(root, 'data'), localDir: join(root, 'local') };
  let store = await Store.open(options);
  try {
    const before = await store.read('workspace');
    const old = await store.getPreferences();
    assert.deepEqual(old.liquidGlass, defaultLiquidGlass);
    delete old.liquidGlass;
    await writeFile(join(options.dataDir, 'preferences.json'), JSON.stringify(old));
    assert.deepEqual((await store.getPreferences()).liquidGlass, defaultLiquidGlass);
    const custom = { backgroundImage: image, backgroundBlur: 18 };
    await store.updatePreferences({ liquidGlass: custom });
    await store.close();
    store = await Store.open(options);
    assert.deepEqual((await store.getPreferences()).liquidGlass, custom);
    await store.updatePreferences({ theme: 'glass-dark' });
    assert.deepEqual((await store.getPreferences()).liquidGlass, custom);
    await assert.rejects(
      store.updatePreferences({ liquidGlass: { ...custom, backgroundBlur: 41 } }),
    );
    assert.deepEqual((await store.getPreferences()).liquidGlass, custom);
    await store.updatePreferences({ liquidGlass: { ...custom, backgroundImage: null } });
    await store.close();
    store = await Store.open(options);
    assert.equal((await store.getPreferences()).liquidGlass?.backgroundImage, null);
    assert.equal((await store.read('workspace')).hash, before.hash);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
