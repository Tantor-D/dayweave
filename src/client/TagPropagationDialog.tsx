import { useEffect, useRef } from 'react';
import { useAppearance } from './presentations/Appearance';
export interface TagConfirmation {
  title: string;
  count: number;
  added: string[];
  removed: string[];
  resolve: (answer: boolean | null) => void;
}
export function TagPropagationDialog({
  request,
  onAnswer,
}: {
  request: TagConfirmation;
  onAnswer: (answer: boolean | null) => void;
}) {
  const { controls: s } = useAppearance();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={s.modal}
      aria-labelledby="tag-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onAnswer(null);
      }}
    >
      <h2 id="tag-confirm-title">是否同步后代标签？</h2>
      <p>
        「{request.title}」的标签已修改，涉及 {request.count} 个后代任务。
      </p>
      {!!request.added.length && (
        <p>合并父任务当前标签：{request.added.join('、')}。保留后代其他标签。</p>
      )}
      {!!request.removed.length && (
        <p>从全部后代移除本次删除的标签：{request.removed.join('、')}。</p>
      )}
      <div className={s.buttonRow}>
        <button onClick={() => onAnswer(null)}>取消保存</button>
        <button onClick={() => onAnswer(false)}>仅此任务</button>
        <button className={s.primary} onClick={() => onAnswer(true)}>
          应用全部后代
        </button>
      </div>
    </dialog>
  );
}
