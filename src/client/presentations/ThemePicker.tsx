import { useState } from 'react';
import type { Workbench } from '../application/useWorkbench';
import type { ThemeDefinition } from '../themes';
import { themes } from '../themes';
export function ThemePicker({ workbench: w }: { workbench: Workbench }) {
  const [saving, setSaving] = useState(false);
  const locked =
    saving ||
    w.statisticsEditing ||
    w.busy ||
    !!w.panel ||
    w.newTask ||
    !!w.schedule ||
    !!w.tagConfirmation ||
    !!w.drag;
  return (
    <label title={locked ? '请先关闭编辑区域，并等待当前操作结束后切换风格' : '切换界面风格'}>
      <select
        aria-label="界面风格"
        value={w.preferences.theme}
        disabled={locked}
        onChange={async (e) => {
          setSaving(true);
          try {
            await w.updatePreferences({ theme: e.target.value as ThemeDefinition['id'] });
          } finally {
            setSaving(false);
          }
        }}
      >
        {Object.values(themes).map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
