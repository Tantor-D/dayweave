import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  defaultNeumorphism,
  isLightSurface,
  type NeumorphismSettings,
} from '../../../domain/neumorphism';
import type { Workbench } from '../../application/useWorkbench';
import s from './Drawer.module.css';

export function NeumorphismDrawer({
  workbench: w,
  draft,
  onDraft,
}: {
  workbench: Workbench;
  draft: NeumorphismSettings | null;
  onDraft: (value: NeumorphismSettings | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const open = draft !== null;
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else if (dialog.current?.open) {
      dialog.current.close();
      trigger.current?.focus();
    }
  }, [open]);
  const locked =
    w.statisticsEditing ||
    w.todoEditing ||
    w.busy ||
    !!w.panel ||
    w.newTask ||
    !!w.schedule ||
    !!w.tagConfirmation ||
    !!w.drag;
  const cancel = () => {
    if (!saving) {
      onDraft(null);
      setError('');
    }
  };
  const update = (patch: Partial<NeumorphismSettings>) => {
    if (draft) onDraft({ ...draft, ...patch });
  };
  return (
    <>
      <button
        ref={trigger}
        className={s.trigger}
        disabled={locked || open}
        title={locked ? '请先结束编辑和当前操作' : '调整柔光拟态外观'}
        onClick={() => {
          setError('');
          onDraft({ ...(w.preferences.neumorphism ?? defaultNeumorphism) });
        }}
      >
        <SlidersHorizontal size={16} />
        <span>拟态设置</span>
      </button>
      <dialog
        ref={dialog}
        className={s.drawer}
        aria-labelledby="neumorphism-title"
        onCancel={(e) => {
          e.preventDefault();
          cancel();
        }}
      >
        <header className={s.heading}>
          <div>
            <small>NEUMORPHISM</small>
            <h2 id="neumorphism-title">拟态设置</h2>
          </div>
          <button aria-label="关闭拟态设置" disabled={saving} onClick={cancel}>
            <X size={18} />
          </button>
        </header>
        {draft && (
          <>
            <div className={s.body}>
              <p className={s.hint}>调整会即时预览，保存后保留。关闭将恢复原来的外观。</p>
              <fieldset disabled={saving}>
                <legend>配色</legend>
                <div className={s.presets}>
                  {[
                    ['浅灰', '#e0e0e0'],
                    ['暖白', '#ebe5dc'],
                    ['灰蓝', '#dce4ec'],
                    ['晨光暖白', '#f3f3f8'],
                    ['冷白', '#f3f5f8'],
                  ].map(([name, color]) => (
                    <button
                      key={color}
                      aria-pressed={draft.background === color}
                      onClick={() => {
                        update({ background: color });
                        setError('');
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <label className={s.color}>
                  自定义底色{' '}
                  <input
                    type="color"
                    aria-label="自定义底色"
                    value={draft.background}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (isLightSurface(value)) {
                        update({ background: value });
                        setError('');
                      } else setError('请选择浅色底色：RGB 各通道至少为 180。');
                    }}
                  />
                  <output>{draft.background}</output>
                </label>
                <label className={s.color}>
                  强调色{' '}
                  <input
                    type="color"
                    aria-label="强调色"
                    value={draft.accent}
                    onChange={(e) => update({ accent: e.target.value })}
                  />
                  <output>{draft.accent}</output>
                </label>
              </fieldset>
              <fieldset disabled={saving}>
                <legend>形状</legend>
                <Range
                  label="圆角"
                  value={draft.radius}
                  min={8}
                  max={32}
                  unit="px"
                  onChange={(radius) => update({ radius })}
                />
              </fieldset>
              <fieldset disabled={saving}>
                <legend>光影</legend>
                <label className={s.light}>
                  一级任务材质
                  <select
                    value={draft.rootRelief}
                    onChange={(e) =>
                      update({ rootRelief: e.target.value as NeumorphismSettings['rootRelief'] })
                    }
                  >
                    <option value="inset">凹陷</option>
                    <option value="raised">凸起</option>
                  </select>
                </label>
                <Range
                  label="凸起距离"
                  value={draft.distance}
                  min={2}
                  max={12}
                  unit="px"
                  onChange={(distance) => update({ distance })}
                />
                <Range
                  label="阴影强度"
                  value={Math.round(draft.intensity * 100)}
                  min={5}
                  max={25}
                  unit="%"
                  onChange={(intensity) => update({ intensity: intensity / 100 })}
                />
                <Range
                  label="阴影柔和度"
                  value={draft.blur}
                  min={6}
                  max={36}
                  unit="px"
                  onChange={(blur) => update({ blur })}
                />
                <label className={s.light}>
                  光源方向
                  <select
                    value={draft.light}
                    onChange={(e) =>
                      update({ light: e.target.value as NeumorphismSettings['light'] })
                    }
                  >
                    <option value="top-left">左上</option>
                    <option value="top-right">右上</option>
                    <option value="bottom-left">左下</option>
                    <option value="bottom-right">右下</option>
                  </select>
                </label>
              </fieldset>
              <div className={s.sample} aria-label="材质预览">
                <strong>柔光，从这里开始</strong>
                <p>面板轻轻浮起，输入区域自然内凹。</p>
                <div className={s.sampleInset}>内凹材质预览</div>
              </div>
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className={s.footer}>
              <button
                disabled={saving}
                onClick={() => {
                  onDraft({ ...defaultNeumorphism });
                  setError('');
                }}
              >
                恢复默认
              </button>
              <div>
                <button disabled={saving} onClick={cancel}>
                  取消
                </button>
                <button
                  className={s.save}
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    setError('');
                    try {
                      if (await w.updatePreferences({ neumorphism: draft })) onDraft(null);
                      else setError('保存失败，预览尚未保存。请重试或取消。');
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </footer>
          </>
        )}
      </dialog>
    </>
  );
}
function Range({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className={s.range}>
      <span>
        {label}
        <output>
          {value}
          {unit}
        </output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
