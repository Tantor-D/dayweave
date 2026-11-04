import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const families = ['glass', 'neobrutalism', 'claymorphism'];
const client = new URL('../src/client/', import.meta.url).pathname;
async function sources(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? sources(join(path, e.name)) : Promise.resolve([join(path, e.name)]),
      ),
    )
  ).flat();
}
test('presentation families never import one another; shared controls do not import a family', async () => {
  for (const family of families) {
    const other = `(?:${families.filter((name) => name !== family).join('|')})`;
    for (const file of await sources(join(client, 'presentations', family))) {
      const content = await readFile(file, 'utf8');
      assert.doesNotMatch(content, new RegExp(`(?:from|@import)\\s*['\"][^'\"]*${other}/`), file);
    }
  }
  for (const file of [
    'Panels.tsx',
    'TaskFields.tsx',
    'Timeline.tsx',
    'StatisticsDashboard.tsx',
    'ScheduleDialog.tsx',
    'NewTaskDialog.tsx',
    'TagPropagationDialog.tsx',
    'application/useWorkbench.ts',
  ]) {
    const content = await readFile(join(client, file), 'utf8');
    assert.doesNotMatch(
      content,
      /from ['"][^'"]*presentations\/(glass|neobrutalism|claymorphism)\//,
      file,
    );
  }
});
test('all families supply all style slots used by shared controls', async () => {
  for (const [files, sheet] of [
    [
      [
        'Panels',
        'TaskFields',
        'Timeline',
        'ScheduleDialog',
        'NewTaskDialog',
        'TagPropagationDialog',
      ],
      'Workbench',
    ],
    [['StatisticsDashboard'], 'Statistics'],
  ] as const) {
    const slots = new Set<string>();
    for (const file of files) {
      const source = await readFile(join(client, `${file}.tsx`), 'utf8');
      for (const match of source.matchAll(/\bs\.([A-Za-z_]\w*)/g)) slots.add(match[1]);
    }
    for (const family of families) {
      const css = await readFile(
        join(client, 'presentations', family, `${sheet}.module.css`),
        'utf8',
      );
      for (const slot of slots)
        assert.match(css, new RegExp(`\\.${slot}\\b`), `${family}: missing ${slot}`);
    }
  }
});
