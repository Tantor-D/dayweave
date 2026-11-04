import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, ChevronRight, GripVertical } from 'lucide-react';
import { taskColor } from '../domain/tags';
import type { Placement, Task, Tag } from '../domain/types';
import {
  dayTaskRows,
  atMinute,
  clockLabel,
  selectedRange,
  placementAt,
  segmentsFor,
  windowMinute,
  placementInWindow,
  minuteLabel,
  today,
  weekday,
} from './time';
import { useAppearance } from './presentations/Appearance';
import { ThemeCard } from './themes';
import { type DragStart, type DragState } from './scheduleDrag';
interface Props {
  tasks: Task[];
  allTasks?: Task[];
  tags: Tag[];
  dayStart: number;
  dayEnd: number;
  dates: string[];
  orientation: 'vertical' | 'horizontal';
  showUntimed?: boolean;
  onSelect: (id: string) => void;
  onSchedule: (placement: Placement) => void;
  onDrag: DragStart;
  preview: DragState | null;
  selectedId?: string;
}
export function Timeline({
  tasks,
  allTasks = tasks,
  tags,
  dayStart,
  dayEnd,
  dates,
  orientation,
  showUntimed = false,
  onSelect,
  onSchedule,
  onDrag,
  preview,
  selectedId,
}: Props) {
  const { controls: s } = useAppearance();
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
        windowMinute(ratio, Number(cell.dataset.dayStart), Number(cell.dataset.dayEnd), true),
      );
      const next = selectedRange(state.anchor, endpoint, state.id);
      if (state.anchor === endpoint)
        next.endAt = new Date(
          Math.min(
            Date.parse(next.endAt),
            Date.parse(atMinute(cell.dataset.timeDate!, Number(cell.dataset.dayEnd))),
          ),
        ).toISOString();
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
        el.scrollTop = (Math.max(0, 7 * 60 - dayStart) / 60) * 56;
        el.scrollLeft = 0;
      } else {
        el.scrollLeft = (Math.max(0, 7 * 60 - dayStart) / 60) * 90;
        el.scrollTop = 0;
      }
    }
    selection.current = null;
    setSelecting(false);
    setRange(undefined);
  }, [orientation, dates[0], dayStart, dayEnd]);
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
  const all = dates.map((date) => segmentsFor(renderTasks, date, dayStart, dayEnd));
  const horizontal = orientation === 'horizontal';
  const daySizes = all.map((segments) =>
    Math.max(
      horizontal ? 142 : 220,
      Math.max(1, ...segments.map((x) => x.lanes)) * (horizontal ? 66 : 104),
    ),
  );
  const rowHeights = dates.map((date, i) =>
    Math.min(
      284,
      Math.max(
        daySizes[i],
        64 +
          (showUntimed ? renderTasks : []).reduce(
            (n, t) => n + t.placements.filter((p) => p.kind === 'day' && p.date === date).length,
            0,
          ) *
            30,
      ),
    ),
  );
  const duration = dayEnd - dayStart;
  const timeSize = (duration / 60) * (horizontal ? 90 : 56);
  const ticks = [
    dayStart,
    ...Array.from(
      { length: Math.max(0, Math.ceil(dayEnd / 60) - Math.floor(dayStart / 60) - 1) },
      (_, i) => (Math.floor(dayStart / 60) + i + 1) * 60,
    ),
  ];
  const weekStyle = {
    '--day-count': dates.length,
    '--time-size': `${timeSize}px`,
    '--date-column-width': showUntimed ? '150px' : '90px',
    '--grid-offset': `${(-(dayStart % 60) / 60) * (horizontal ? 90 : 56)}px`,
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
              {showUntimed && (
                <div className={s.allDayRow}>
                  <div className={s.allDayLabel}>未定时</div>
                  {dates.map((date) => (
                    <DayDrop
                      key={date}
                      date={date}
                      tasks={renderTasks}
                      tags={tags}
                      onDrag={onDrag}
                      onSelect={onSelect}
                      onSchedule={onSchedule}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          {horizontal ? (
            <>
              <div className={s.horizontalHours}>
                <div className={s.rowDate}>日期 / 时间</div>
                <div className={s.hourRow}>
                  {ticks.map((minute) => (
                    <span
                      key={minute}
                      style={{ position: 'absolute', left: ((minute - dayStart) / 60) * 90 }}
                    >
                      {minuteLabel(minute)}
                    </span>
                  ))}
                </div>
              </div>
              {dates.map((date, index) => (
                <div className={s.horizontalDay} key={date} style={{ height: rowHeights[index] }}>
                  <div className={s.rowDate}>
                    <b>
                      {date.slice(5)} {weekday(date)}
                    </b>
                    {showUntimed && (
                      <DayDrop
                        date={date}
                        tasks={renderTasks}
                        allTasks={allTasks}
                        hierarchical
                        tags={tags}
                        onDrag={onDrag}
                        onSelect={onSelect}
                        onSchedule={onSchedule}
                      />
                    )}
                  </div>
                  <div className={s.dayTimeScroll}>
                    <div
                      className={s.timeCell}
                      data-time-date={date}
                      data-day-start={dayStart}
                      data-day-end={dayEnd}
                      data-axis="horizontal"
                      style={{ height: Math.max(rowHeights[index], daySizes[index]) }}
                      {...scheduleEvents(date)}
                    >
                      {all[index].map((seg) =>
                        renderSegment(
                          seg,
                          horizontal
                            ? Math.max(rowHeights[index], daySizes[index])
                            : daySizes[index],
                        ),
                      )}
                      {renderRange(date)}
                      {date === today() && minutesNow >= dayStart && minutesNow < dayEnd && (
                        <div
                          className={s.nowLine}
                          style={{ left: `${((minutesNow - dayStart) / duration) * 100}%` }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className={s.timeBody}>
              <div className={s.hourLabels}>
                {ticks.map((minute) => (
                  <span key={minute} style={{ top: ((minute - dayStart) / 60) * 56 }}>
                    {minuteLabel(minute)}
                  </span>
                ))}
              </div>
              {dates.map((date, index) => (
                <div
                  key={date}
                  className={s.timeCell}
                  data-time-date={date}
                  data-axis="vertical"
                  data-day-start={dayStart}
                  data-day-end={dayEnd}
                  {...scheduleEvents(date)}
                >
                  {all[index].map((seg) =>
                    renderSegment(
                      seg,
                      horizontal ? Math.max(rowHeights[index], daySizes[index]) : daySizes[index],
                    ),
                  )}
                  {renderRange(date)}
                  {date === today() && minutesNow >= dayStart && minutesNow < dayEnd && (
                    <div
                      className={s.nowLine}
                      style={{ top: `${((minutesNow - dayStart) / duration) * 100}%` }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {preview?.moved && (
        <div className={s.dragTip} style={{ left: preview.x + 16, top: preview.y + 16 }}>
          {preview.rootTarget
            ? '设为一级任务'
            : preview.sortTarget
              ? '移到「' +
                preview.sortTarget.title +
                '」' +
                (preview.sortTarget.side === 'before' ? '前面' : '后面')
              : preview.parentTarget
                ? '设为「' + preview.parentTarget.title + '」的子任务'
                : preview.preview
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
        const initial = placementInWindow(
          date,
          horizontal
            ? (event.clientX - rect.left) / rect.width
            : (event.clientY - rect.top) / rect.height,
          dayStart,
          dayEnd,
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
          onSchedule(
            placementInWindow(date, Math.max(0, (540 - dayStart) / duration), dayStart, dayEnd),
          );
        }
      },
    };
  }
  function renderRange(date: string) {
    if (!range) return null;
    const midnight = Date.parse(atMinute(date, 0));
    const start = Math.max(dayStart, (Date.parse(range.startAt) - midnight) / 60000);
    const end = Math.min(dayEnd, (Date.parse(range.endAt) - midnight) / 60000);
    if (end <= start) return null;
    const style = horizontal
      ? {
          left: ((start - dayStart) / duration) * timeSize,
          width: ((end - start) / duration) * timeSize,
          top: 2,
          bottom: 2,
        }
      : {
          top: ((start - dayStart) / duration) * timeSize,
          height: ((end - start) / duration) * timeSize,
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
          left: ((seg.start - dayStart) / duration) * timeSize,
          width: Math.max(((seg.end - seg.start) / duration) * timeSize, 20),
          top: (seg.lane / seg.lanes) * size + 5,
          height: size / seg.lanes - 10,
        }
      : {
          top: ((seg.start - dayStart) / duration) * timeSize,
          height: Math.max(((seg.end - seg.start) / duration) * timeSize, 14),
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
        style={
          { ...css, '--task-color': taskColor(task, tags) ?? 'var(--accent)' } as CSSProperties
        }
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
  tags,
  tasks,
  allTasks = tasks,
  hierarchical = false,
  onDrag,
  onSelect,
  onSchedule,
}: {
  date: string;
  tags: Tag[];
  tasks: Task[];
  allTasks?: Task[];
  hierarchical?: boolean;
  onDrag: DragStart;
  onSelect: (id: string) => void;
  onSchedule: (placement: Placement) => void;
}) {
  const { controls: s } = useAppearance();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const rows = dayTaskRows(tasks, allTasks, date, expanded);
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
        if ((event.target as HTMLElement).closest('[data-placement], [data-day-task]')) return;
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
      {hierarchical
        ? rows.map(({ task, placement, depth, hasChildren }) => (
            <div
              key={task.id}
              data-day-task={task.id}
              className={s.dayTreeRow}
              style={{ marginLeft: Math.min(depth, 6) * 10 }}
            >
              {hasChildren ? (
                <button
                  className={s.dayTreeToggle}
                  aria-label={`${expanded.has(task.id) ? '收起' : '展开'} ${task.title}`}
                  aria-expanded={expanded.has(task.id)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((old) => {
                      const next = new Set(old);
                      if (next.has(task.id)) next.delete(task.id);
                      else next.add(task.id);
                      return next;
                    });
                  }}
                >
                  <ChevronRight
                    size={13}
                    style={{ transform: expanded.has(task.id) ? 'rotate(90deg)' : undefined }}
                  />
                </button>
              ) : (
                <span className={s.dayTreeSpacer} />
              )}
              <div
                data-placement={placement?.id}
                role="button"
                tabIndex={0}
                aria-label={`${task.title}${placement ? '' : '（父任务）'}`}
                title={placement ? task.title : `${task.title}（仅显示层级，未安排到当天）`}
                className={`${s.dayChip} ${s.taskColor} ${!placement ? s.dayTreeContext : ''} ${task.status === 'done' ? s.done : ''}`}
                style={
                  { '--task-color': taskColor(task, tags) ?? 'var(--accent)' } as CSSProperties
                }
                onPointerDown={(e) => {
                  if (placement) onDrag(e, task, placement);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(task.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    onSelect(task.id);
                  }
                }}
              >
                {placement && <GripVertical size={11} />}
                {task.title}
              </div>
            </div>
          ))
        : placements.map(({ task, p }) => (
            <div
              key={p.id}
              data-placement={p.id}
              role="button"
              tabIndex={0}
              style={{ '--task-color': taskColor(task, tags) ?? 'var(--accent)' } as CSSProperties}
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
