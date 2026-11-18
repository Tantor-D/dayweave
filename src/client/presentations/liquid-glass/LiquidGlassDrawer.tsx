import { useEffect, useRef, useState } from 'react';
import { ImagePlus, SlidersHorizontal, X } from 'lucide-react';
import { mistPoster } from './MistWallpaper';
import { backgroundOf, defaultLiquidGlass, type LiquidGlassSettings } from '../../../domain/liquid-glass';
import type { Workbench } from '../../application/useWorkbench';
import { prepareBackground } from './background';
import { attachGlassRim } from './rim';
import s from './Drawer.module.css';

export function LiquidGlassDrawer({
  workbench: w,
  draft,
  onDraft,
}: {
  workbench: Workbench;
  draft: LiquidGlassSettings | null;
  onDraft: (value: LiquidGlassSettings | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const open = draft !== null;
  const pending = saving || processing;
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
    if (!pending) {
      onDraft(null);
      setError('');
    }
  };
  return (
    <>
      <button
        ref={trigger}
        disabled={locked || open}
        className={s.trigger}
        aria-label="液态玻璃自定义"
        title="自定义背景图片和模糊程度"
        onClick={() => {
          setError('');
          onDraft({ ...defaultLiquidGlass, ...w.preferences.liquidGlass });
        }}
      >
        <SlidersHorizontal size={16} />
        <span>自定义</span>
      </button>
      <dialog
        ref={dialog}
        className={s.drawer}
        aria-labelledby="liquid-glass-title"
        onCancel={(e) => {
          e.preventDefault();
          cancel();
        }}
      >
        <header className={s.heading}>
          <div>
            <small>LIQUID GLASS</small>
            <h2 id="liquid-glass-title">背景自定义</h2>
          </div>
          <button aria-label="关闭背景自定义" disabled={pending} onClick={cancel}>
            <X size={18} />
          </button>
        </header>
        {draft && (
          <>
            <div className={s.body}>
              <p className={s.hint}>背景和材质会即时预览，保存后保留。</p>
              <fieldset className={s.materials} disabled={pending}>
                <legend>背景</legend>
                <div>
                  {([['white', '白底'], ['mist', '流动薄雾'], ['image', '我的图片']] as const).map(([background, label]) => (
                    <button key={background} aria-pressed={backgroundOf(draft) === background}
                      disabled={background === 'image' && !draft.backgroundImage}
                      onClick={() => onDraft({ ...draft, background })}>{label}</button>
                  ))}
                </div>
              </fieldset>
              <div className={s.preview} aria-label="背景预览">
                {backgroundOf(draft) === 'mist' && <img src={mistPoster} alt="流动薄雾封面" />}
                {backgroundOf(draft) === 'image' && draft.backgroundImage && (
                  <img
                    src={draft.backgroundImage}
                    alt="当前背景"
                    style={{ filter: `blur(${draft.backgroundBlur}px)` }}
                  />
                )}
                <span ref={draft.material === 'clear' ? attachGlassRim : undefined} className={s.sample}>
                  留白 <small>清透，自在</small>
                </span>
              </div>
              <fieldset className={s.materials} disabled={pending}>
                <legend>面板材质</legend>
                <div>
                  <button
                    aria-pressed={(draft.material ?? 'soft') === 'soft'}
                    onClick={() => onDraft({ ...draft, material: 'soft' })}
                  >
                    柔白玻璃
                  </button>
                  <button
                    aria-pressed={draft.material === 'clear'}
                    onClick={() => onDraft({ ...draft, material: 'clear' })}
                  >
                    清透玻璃
                  </button>
                </div>
                <p className={s.hint}>
                  清透材质保留背景颜色与纹理，仅在边缘形成高光。背景模糊仍由下方滑块单独控制。
                </p>
              </fieldset>
              <label className={s.upload}>
                <span>
                  <ImagePlus size={18} />
                  {processing ? '正在处理图片…' : '上传背景图片'}
                </span>
                <input
                  type="file"
                  aria-label="上传背景图片"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={pending}
                  onChange={async (e) => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (!file) return;
                    setProcessing(true);
                    setError('');
                    try {
                      const backgroundImage = await prepareBackground(file);
                      onDraft({ ...draft, background: 'image', backgroundImage });
                    } catch (error) {
                      setError(error instanceof Error ? error.message : '图片处理失败，请重试。');
                    } finally {
                      setProcessing(false);
                    }
                  }}
                />
              </label>
              <p className={s.hint}>
                JPG、PNG、WebP，最大 12MB。图片会自动缩放压缩，仅保存在本机。
              </p>
              <button
                disabled={pending || !draft.backgroundImage}
                onClick={() => {
                  onDraft({ ...draft, background: backgroundOf(draft) === 'image' ? 'white' : backgroundOf(draft), backgroundImage: null });
                  setError('');
                }}
              >
                移除图片
              </button>
              <label className={s.range}>
                <span>
                  背景图片模糊<output>{draft.backgroundBlur}px</output>
                </span>
                <input
                  type="range"
                  aria-label="背景图片模糊"
                  min={0}
                  max={40}
                  step={1}
                  disabled={pending || backgroundOf(draft) !== 'image'}
                  value={draft.backgroundBlur}
                  onChange={(e) => onDraft({ ...draft, backgroundBlur: Number(e.target.value) })}
                />
              </label>
              <p className={s.hint}>0 为清晰原图，数值越大越柔和。只影响背景图片。</p>
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className={s.footer}>
              <button
                disabled={pending}
                onClick={() => {
                  onDraft({ ...defaultLiquidGlass });
                  setError('');
                }}
              >
                恢复默认
              </button>
              <div>
                <button disabled={pending} onClick={cancel}>
                  取消
                </button>
                <button
                  className={s.save}
                  disabled={pending}
                  onClick={async () => {
                    setSaving(true);
                    setError('');
                    try {
                      if (await w.updatePreferences({ liquidGlass: draft })) onDraft(null);
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
