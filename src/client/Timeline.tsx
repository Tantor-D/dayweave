import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, GripVertical } from 'lucide-react';
import type { Operation, Placement, Task } from '../domain/types';
import {
  atMinute,
  clockLabel,
  selectedRange,
  placementAt,
  segmentsFor,
  snap,
  today,
  weekday,
} from './time';
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
  onSchedule: (placement: Placement) => void;
  onDrag: DragStart;
  preview: DragState | null;
  selectedId?: string;
}
export function Timeline({
  tasks,
  dates,
  orientation,
  onSelect,
  onSchedule,
  onDrag,
  preview,
  selectedId,
}: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<Extract<Placement, { kind: 'timed' }>>();
  const selection = useRef<{
    anchor: string;
    id: string;
    x: number;
    y: number;
    pointerId: number;
    moved: boolean;
    placement?: Placement;
  } | null>(null);
  const suppressRangeClick = useRef(0);
  const scheduleRef = useRef(onSchedule);
  scheduleRef.current = onSchedule;
  const [selecting, setSelecting] = useState(false);
  useEffect(() => {
    if (!selecting) return;
    const cancel = () => {
      selection.current = null;
      setSelecting(false);
      setRange(undefined);
      suppressRangeClick.current = Date.now() + 350;
    };
    const move = (event: PointerEvent) => {
      const state = selection.current;
      if (!state || event.pointerId !== state.pointerId) return;
      if (!state.moved && Math.hypot(event.clientX - state.x, event.clientY - state.y) < 5) return;
      event.preventDefault();
      state.moved = true;
      const cell = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-time-date]') as HTMLElement | null;
      if (!cell || !scroll.current?.contains(cell)) {
        state.placement = undefined;
        setRange(undefined);
        return;
      }
      const rect = cell.getBoundingClientRect();
      const ratio =
        cell.dataset.axis === 'horizontal'
          ? (event.clientX - rect.left) / rect.width
          : (event.clientY - rect.top) / rect.height;
      const endpoint = atMinute(
        cell.dataset.timeDate!,
        Math.max(0, Math.min(1440, Math.round((ratio * 1440) / 15) * 15)),
      );
      const next = selectedRange(state.anchor, endpoint, state.id);
      state.placement = next;
      setRange(next);
    };
    const up = (event: PointerEvent) => {
      const state = selection.current;
      if (!state || event.pointerId !== state.pointerId) return;
      if (state.moved) move(event);
      const placement = state.placement;
      cancel();
      if (placement) scheduleRef.current(placement);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      document.body.style.userSelect = '';
    };
  }, [selecting]);

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
    selection.current = null;
    setSelecting(false);
    setRange(undefined);
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
                    onSchedule={onSchedule}
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
                    <DayDrop
                      date={date}
                      tasks={renderTasks}
                      onDrag={onDrag}
                      onSelect={onSelect}
                      onSchedule={onSchedule}
                    />
                  </div>
                  <div
                    className={s.timeCell}
                    data-time-date={date}
                    data-axis="horizontal"
                    style={{ height: daySizes[index] }}
                    {...scheduleEvents(date)}
                  >
                    {all[index].map((seg) => renderSegment(seg, daySizes[index]))}
                    {renderRange(date)}
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
                <div
                  key={date}
                  className={s.timeCell}
                  data-time-date={date}
                  data-axis="vertical"
                  {...scheduleEvents(date)}
                >
                  {all[index].map((seg) => renderSegment(seg, daySizes[index]))}
                  {renderRange(date)}
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
        <span>拖选范围安排 · 点击任务编辑 · 边缘拉伸</span>
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
  function scheduleEvents(date: string) {
    return {
      tabIndex: 0,
      role: 'group',
      'aria-label': `${date} 时间轴，拖选时间范围或按回车安排任务`,
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (
          event.button !== 0 ||
          !event.isPrimary ||
          preview ||
          (event.target as HTMLElement).closest('[data-placement]')
        )
          return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        const rect = event.currentTarget.getBoundingClientRect();
        const initial = placementAt(
          date,
          horizontal
            ? (event.clientX - rect.left) / rect.width
            : (event.clientY - rect.top) / rect.height,
        );
        if (initial.kind !== 'timed') return;
        selection.current = {
          anchor: initial.startAt,
          id: initial.id,
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          moved: false,
          placement: initial,
        };
        setSelecting(true);
      },
      onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
        if (Date.now() < suppressRangeClick.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onSchedule(placementAt(date, 9 / 24));
        }
      },
    };
  }
  function renderRange(date: string) {
    if (!range) return null;
    const midnight = Date.parse(atMinute(date, 0));
    const start = Math.max(0, (Date.parse(range.startAt) - midnight) / 60000);
    const end = Math.min(1440, (Date.parse(range.endAt) - midnight) / 60000);
    if (end <= start) return null;
    const style = horizontal
      ? {
          left: (start / 1440) * timeSize,
          width: ((end - start) / 1440) * timeSize,
          top: 2,
          bottom: 2,
        }
      : {
          top: (start / 1440) * timeSize,
          height: ((end - start) / 1440) * timeSize,
          left: 2,
          right: 2,
        };
    return (
      <div className={s.rangeSelection} style={style} aria-label="选定时间范围">
        {clockLabel(range.startAt)}–{clockLabel(range.endAt)}
      </div>
    );
  }
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
        data-placement={placement.id}
        role="button"
        tabIndex={0}
        aria-label={`${task.title} ${clockLabel(placement.startAt)} 至 ${clockLabel(placement.endAt)}`}
        className={`${s.timeBlock} ${s.taskColor} ${task.status === 'done' ? s.done : ''} ${selectedId === task.id ? s.selected : ''} ${preview?.original?.id === placement.id ? s.dragging : ''}`}
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
  onSchedule,
}: {
  date: string;
  tasks: Task[];
  onDrag: DragStart;
  onSelect: (id: string) => void;
  onSchedule: (placement: Placement) => void;
}) {
  const placements = tasks.flatMap((task) =>
    task.placements.filter((p) => p.kind === 'day' && p.date === date).map((p) => ({ task, p })),
  );
  return (
    <div
      className={s.dayDrop}
      data-day-date={date}
      aria-label={`${date} 未定时区域`}
      role="group"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-placement]')) return;
        event.currentTarget.focus({ preventScroll: true });
        onSchedule(placementAt(date));
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onSchedule(placementAt(date));
        }
      }}
    >
      {placements.map(({ task, p }) => (
        <div
          key={p.id}
          data-placement={p.id}
          role="button"
          tabIndex={0}
          className={`${s.dayChip} ${s.taskColor} ${task.status === 'done' ? s.done : ''}`}
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
      <span className={s.dropHint}>＋ 仅安排日期</span>
    </div>
  );
}
