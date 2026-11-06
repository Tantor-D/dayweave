import { useEffect, useRef, useState } from 'react';
import { ImagePlus, SlidersHorizontal, X } from 'lucide-react';
import { defaultLiquidGlass, type LiquidGlassSettings } from '../../../domain/liquid-glass';
import type { Workbench } from '../../application/useWorkbench';
import { prepareBackground } from './background';
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
          onDraft({ ...(w.preferences.liquidGlass ?? defaultLiquidGlass) });
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
              <p className={s.hint}>让喜欢的图片透过玻璃。调整即时预览，保存后保留。</p>
              <div className={s.preview} aria-label="背景预览">
                {draft.backgroundImage && (
                  <img
                    src={draft.backgroundImage}
                    alt="当前背景"
                    style={{ filter: `blur(${draft.backgroundBlur}px)` }}
                  />
                )}
                <span className={s.sample}>
                  留白 <small>清透，自在</small>
                </span>
              </div>
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
                      onDraft({ ...draft, backgroundImage });
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
                  onDraft({ ...draft, backgroundImage: null });
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
                  disabled={pending || !draft.backgroundImage}
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
