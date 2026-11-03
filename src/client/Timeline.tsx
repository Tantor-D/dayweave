import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, GripVertical } from 'lucide-react';
import type { Operation, Placement, Task } from '../domain/types';
import { atMinute, clockLabel, segmentsFor, snap, today, weekday } from './time';
import s from './App.module.css';
import { ThemeCard } from './themes';
export type DragMode = 'move' | 'start' | 'end';
export interface DragStart {
  (event: ReactPointerEvent, task: Task, placement?: Placement, mode?: DragMode): void;
}
interface DragState {
  task: Task;
  original?: Placement;
  mode: DragMode;
  x: number;
  y: number;
  moved: boolean;
  offset: number;
  preview?: Placement;
}
export function useScheduleDrag(save: (ops: Operation[], summary: string) => Promise<unknown>) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const latest = useRef<DragState | null>(null),
    suppressedUntil = useRef(0),
    saveRef = useRef(save),
    dragSaveRef = useRef(save);
  saveRef.current = save;
  const start: DragStart = (event, task, placement, mode = 'move') => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,select,textarea'))
      return;
    event.stopPropagation();
    const cell = (event.currentTarget as HTMLElement).closest(
      '[data-time-date]',
    ) as HTMLElement | null;
    let offset = 0;
    if (placement?.kind === 'timed' && cell && mode === 'move') {
      const rect = cell.getBoundingClientRect();
      const ratio =
        cell.dataset.axis === 'horizontal'
          ? (event.clientX - rect.left) / rect.width
          : (event.clientY - rect.top) / rect.height;
      offset =
        Date.parse(atMinute(cell.dataset.timeDate!, ratio * 1440)) - Date.parse(placement.startAt);
    }
    const next = {
      task,
      original: placement,
      mode,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      offset,
    };
    dragSaveRef.current = saveRef.current;
    latest.current = next;
    setDrag(next);
  };
  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const previous = latest.current!;
      if (!previous.moved && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 5)
        return;
      event.preventDefault();
      const el = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-time-date],[data-day-date]') as HTMLElement | null;
      let preview: Placement | undefined;
      if (el?.dataset.dayDate && previous.mode === 'move')
        preview = {
          id: previous.original?.id ?? crypto.randomUUID(),
          kind: 'day',
          date: el.dataset.dayDate,
        };
      if (el?.dataset.timeDate) {
        const rect = el.getBoundingClientRect();
        const ratio =
          el.dataset.axis === 'horizontal'
            ? (event.clientX - rect.left) / rect.width
            : (event.clientY - rect.top) / rect.height;
        const original = previous.original?.kind === 'timed' ? previous.original : undefined;
        const raw = atMinute(
          el.dataset.timeDate,
          previous.mode === 'end'
            ? Math.max(0, Math.min(1440, Math.round((ratio * 1440) / 15) * 15))
            : snap(ratio * 1440),
        );
        if (previous.mode === 'start' && original)
          preview = {
            ...original,
            startAt: new Date(
              Math.min(Date.parse(raw), Date.parse(original.endAt) - 900000),
            ).toISOString(),
          };
        else if (previous.mode === 'end' && original)
          preview = {
            ...original,
            endAt: new Date(
              Math.max(Date.parse(raw), Date.parse(original.startAt) + 900000),
            ).toISOString(),
          };
        else {
          const shifted = Date.parse(raw) - previous.offset;
          const startAt = new Date(Math.round(shifted / 900000) * 900000).toISOString();
          preview = {
            id: previous.original?.id ?? crypto.randomUUID(),
            kind: 'timed',
            startAt,
            endAt: new Date(
              Date.parse(startAt) +
                (original ? Date.parse(original.endAt) - Date.parse(original.startAt) : 3600000),
            ).toISOString(),
          };
        }
      }
      const next = { ...previous, moved: true, x: event.clientX, y: event.clientY, preview };
      latest.current = next;
      setDrag(next);
    };
    const stop = () => {
      const current = latest.current;
      latest.current = null;
      setDrag(null);
      if (current?.moved) {
        suppressedUntil.current = Date.now() + 350;
        if (current.preview)
          void dragSaveRef.current(
            [{ type: 'placement.put', taskId: current.task.id, placement: current.preview }],
            `安排「${current.task.title}」`,
          );
      }
    };
    const cancel = () => {
      latest.current = null;
      setDrag(null);
      suppressedUntil.current = Date.now() + 350;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      document.body.style.userSelect = '';
    };
  }, [!!drag]);
  return { drag, start, canClick: () => Date.now() > suppressedUntil.current };
}
interface Props {
  tasks: Task[];
  dates: string[];
  orientation: 'vertical' | 'horizontal';
  onSelect: (id: string) => void;
  onDrag: DragStart;
  preview: DragState | null;
  selectedId?: string;
}
export function Timeline({
  tasks,
  dates,
  orientation,
  onSelect,
  onDrag,
  preview,
  selectedId,
}: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroll.current;
    if (el) {
      if (orientation === 'vertical') {
        el.scrollTop = 7 * 56;
        el.scrollLeft = 0;
      } else {
        el.scrollLeft = 7 * 90;
        el.scrollTop = 0;
      }
    }
  }, [orientation, dates[0]]);
  const renderTasks = tasks.map((task) =>
    preview?.preview && task.id === preview.task.id
      ? {
          ...task,
          placements: [
            ...task.placements.filter((p) => p.id !== preview.original?.id),
            preview.preview,
          ],
        }
      : task,
  );
  const all = dates.map((date) => segmentsFor(renderTasks, date));
  const horizontal = orientation === 'horizontal';
  const daySizes = all.map((segments) =>
    Math.max(
      horizontal ? 142 : 220,
      Math.max(1, ...segments.map((x) => x.lanes)) * (horizontal ? 66 : 104),
    ),
  );
  const timeSize = horizontal ? 2160 : 1344;
  const weekStyle = {
    '--day-count': dates.length,
    '--time-size': `${timeSize}px`,
    '--day-columns': daySizes.map((n) => `minmax(${n}px, 1fr)`).join(' '),
    '--board-min-width': `${daySizes.reduce((a, b) => a + b, 56)}px`,
  } as CSSProperties;
  const timeNow = new Date();
  const minutesNow =
    Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(timeNow),
    ) *
      60 +
    Number(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', minute: '2-digit' }).format(
        timeNow,
      ),
    );
  return (
    <div className={`${s.timeline} ${horizontal ? s.horizontal : ''}`} style={weekStyle}>
      <div className={s.boardScroll} ref={scroll} data-testid="timeline-scroll">
        <div className={s.boardCanvas}>
          {!horizontal && (
            <>
              <div className={s.dayHeaders}>
                <div className={s.timezone}>GMT+8</div>
                {dates.map((date) => (
                  <div
                    key={date}
                    className={`${s.dayHeading} ${date === today() ? s.todayHeading : ''}`}
                  >
                    <span>{weekday(date)}</span>
                    <strong>{Number(date.slice(8))}</strong>
                    {date === today() && <i>今天</i>}
                  </div>
                ))}
              </div>
              <div className={s.allDayRow}>
                <div className={s.allDayLabel}>未定时</div>
                {dates.map((date) => (
                  <DayDrop
                    key={date}
                    date={date}
                    tasks={renderTasks}
                    onDrag={onDrag}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </>
          )}
          {horizontal ? (
            <>
              <div className={s.horizontalHours}>
                <div className={s.rowDate}>日期 / 时间</div>
                <div className={s.hourRow}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <span key={h}>{String(h).padStart(2, '0')}:00</span>
                  ))}
                </div>
              </div>
              {dates.map((date, index) => (
                <div className={s.horizontalDay} key={date} style={{ minHeight: daySizes[index] }}>
                  <div className={s.rowDate}>
                    <b>
                      {date.slice(5)} {weekday(date)}
                    </b>
                    <DayDrop date={date} tasks={renderTasks} onDrag={onDrag} onSelect={onSelect} />
                  </div>
                  <div
                    className={s.timeCell}
                    data-time-date={date}
                    data-axis="horizontal"
                    style={{ height: daySizes[index] }}
                  >
                    {all[index].map((seg) => renderSegment(seg, daySizes[index]))}
                    {date === today() && (
                      <div
                        className={s.nowLine}
                        style={{ left: `${(minutesNow / 1440) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className={s.timeBody}>
              <div className={s.hourLabels}>
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} style={{ top: h * 56 }}>
                    {String(h).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
              {dates.map((date, index) => (
                <div key={date} className={s.timeCell} data-time-date={date} data-axis="vertical">
                  {all[index].map((seg) => renderSegment(seg, daySizes[index]))}
                  {date === today() && (
                    <div className={s.nowLine} style={{ top: `${(minutesNow / 1440) * 100}%` }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={s.boardFoot}>
        <span>
          <span className={s.liveDot} />
          本机保存 · Asia/Shanghai
        </span>
        <span>拖动安排 · 边缘拉伸 · 15 分钟吸附</span>
      </div>
      {preview?.moved && (
        <div className={s.dragTip} style={{ left: preview.x + 16, top: preview.y + 16 }}>
          {preview.preview
            ? preview.preview.kind === 'day'
              ? `${preview.preview.date} · 未定时`
              : `${clockLabel(preview.preview.startAt)} — ${clockLabel(preview.preview.endAt)}`
            : '拖到日期或时间轴'}
          <small>Esc 取消</small>
        </div>
      )}
    </div>
  );
  function renderSegment(seg: ReturnType<typeof segmentsFor>[number], size: number) {
    const { task, placement } = seg;
    const css: CSSProperties = horizontal
      ? {
          left: (seg.start / 1440) * timeSize,
          width: Math.max(((seg.end - seg.start) / 1440) * timeSize, 20),
          top: (seg.lane / seg.lanes) * size + 5,
          height: size / seg.lanes - 10,
        }
      : {
          top: (seg.start / 1440) * timeSize,
          height: Math.max(((seg.end - seg.start) / 1440) * timeSize, 14),
          left: `calc(${(seg.lane / seg.lanes) * 100}% + 5px)`,
          width: `calc(${100 / seg.lanes}% - 10px)`,
        };
    return (
      <div
        key={placement.id}
        role="button"
        tabIndex={0}
        aria-label={`${task.title} ${clockLabel(placement.startAt)} 至 ${clockLabel(placement.endAt)}`}
        className={`${s.timeBlock} ${s[task.priority]} ${task.status === 'done' ? s.done : ''} ${selectedId === task.id ? s.selected : ''} ${preview?.original?.id === placement.id ? s.dragging : ''}`}
        style={css}
        onPointerDown={(e) => onDrag(e, task, placement)}
        onClick={() => onSelect(task.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect(task.id);
        }}
      >
        {seg.first && (
          <span
            className={`${s.resizeHandle} ${s.startHandle}`}
            title="调整开始时间"
            onPointerDown={(e) => onDrag(e, task, placement, 'start')}
          />
        )}
        <ThemeCard task={task}>
          <div className={s.blockTitle}>
            {task.status === 'done' && <Check size={12} />}
            <strong>{task.title}</strong>
          </div>
          <span className={s.blockTime}>
            {!seg.first ? '← ' : ''}
            {clockLabel(placement.startAt)}–{clockLabel(placement.endAt)}
            {!seg.last ? ' →' : ''}
          </span>
          <small>{task.priority}</small>
        </ThemeCard>
        {seg.last && (
          <span
            className={`${s.resizeHandle} ${s.endHandle}`}
            title="调整结束时间"
            onPointerDown={(e) => onDrag(e, task, placement, 'end')}
          />
        )}
      </div>
    );
  }
}
function DayDrop({
  date,
  tasks,
  onDrag,
  onSelect,
}: {
  date: string;
  tasks: Task[];
  onDrag: DragStart;
  onSelect: (id: string) => void;
}) {
  const placements = tasks.flatMap((task) =>
    task.placements.filter((p) => p.kind === 'day' && p.date === date).map((p) => ({ task, p })),
  );
  return (
    <div className={s.dayDrop} data-day-date={date} aria-label={`${date} 未定时区域`}>
      {placements.map(({ task, p }) => (
        <div
          key={p.id}
          role="button"
          tabIndex={0}
          className={`${s.dayChip} ${s[task.priority]} ${task.status === 'done' ? s.done : ''}`}
          onPointerDown={(e) => onDrag(e, task, p)}
          onClick={() => onSelect(task.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSelect(task.id);
          }}
        >
          <GripVertical size={11} />
          {task.title}
        </div>
      ))}
      {placements.length === 0 && <span className={s.dropHint}>拖到这里，仅安排日期</span>}
    </div>
  );
}
