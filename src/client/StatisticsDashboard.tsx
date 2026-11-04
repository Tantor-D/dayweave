import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  calculateStatistics,
  defaultStatistics,
  statisticsRange,
  ratio,
  validStatisticsDate,
  type StatisticsDay,
} from '../domain/statistics';
import type { StatisticsPreferences, Workspace } from '../domain/types';
import { useAppearance } from './presentations/Appearance';

const hours = (minutes: number | null) =>
  minutes === null
    ? '—'
    : `${(minutes / 60).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} h`;
const exactDuration = (minutes: number) =>
  `${hours(minutes)}（${minutes.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 分钟）`;
const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);
const clock = (minute: number | null) => {
  if (minute === null) return '—';
  const rounded = Math.round(minute);
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
};
const chartLabels = {
  trend: '折线趋势',
  duration: '每日投入',
  first: '首次工作',
  parallel: '并行分析',
  tags: '标签排行',
  selectedTag: '关注标签',
} as const;
type ChartKey = keyof typeof chartLabels;
function Card({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const { statistics: s } = useAppearance();
  return (
    <section className={`${s.card} ${wide ? s.wide : ''}`} data-chart={title}>
      <div className={s.cardHeading} title={description}>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}
function StatisticsDialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const { statistics: s } = useAppearance();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} className={s.dialog} aria-label={title} onCancel={close}>
      <header>
        <h2>{title}</h2>
        <button onClick={close} aria-label="关闭弹窗">
          关闭
        </button>
      </header>
      <div className={s.dialogBody}>{children}</div>
    </dialog>
  );
}

function Empty({ children = '这段时间还没有投入记录' }: { children?: ReactNode }) {
  const { statistics: s } = useAppearance();
  return <div className={s.empty}>{children}</div>;
}

function useChartSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 480, height: 190 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0)
        setSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
    });
    observer.observe(element);
    return () => observer.disconnect();
  });
  return { ref, ...size };
}

function DailyChart({
  days,
  mode,
}: {
  days: StatisticsDay[];
  mode: 'duration' | 'first' | 'personal' | 'selectedTag';
}) {
  const { statistics: s } = useAppearance();
  const [focused, setFocused] = useState<string | null>(null);
  const { ref: chartRef, width, height } = useChartSize();
  const plotHeight = Math.max(10, height - 40);
  const isFirst = mode === 'first';
  const values = days.map((d) => (isFirst ? d.first : mode === 'duration' ? d.work : d[mode]));
  if (!values.some((v) => v !== null && v > 0)) return <Empty />;
  const max = isFirst
    ? 1440
    : Math.max(60, Math.ceil(Math.max(...values.map((v) => v ?? 0)) / 60) * 60);
  const min = isFirst ? 360 : 0;
  const plot = width - 72;
  const x = (i: number) => 52 + ((i + 0.5) * plot) / days.length;
  const y = (value: number) => height - 24 - ((value - min) / (max - min)) * plotHeight;
  const barWidth = Math.min(32, (plot / days.length) * 0.65);
  const firsts = days.flatMap((d) => (d.first === null ? [] : [d.first]));
  const mean = firsts.reduce((a, b) => a + b, 0) / firsts.length;
  const title = isFirst
    ? '每日首次工作时间'
    : mode === 'duration'
      ? '每日工作时长'
      : mode === 'personal'
        ? '个人时间趋势'
        : '关注标签时间趋势';
  const describe = (d: StatisticsDay) =>
    `${d.date} · ${isFirst ? `首次工作 ${clock(d.first)}` : mode === 'duration' ? `工作 ${exactDuration(d.work)}，普通 ${exactDuration(d.work - d.lunch - d.overtime)}，午休占用 ${exactDuration(d.lunch)}，加班 ${exactDuration(d.overtime)}` : exactDuration(d[mode])}`;
  return (
    <>
      <div className={s.chartScroll} ref={chartRef}>
        <svg
          className={s.chart}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label={title}
        >
          {[0, 1, 2, 3].map((i) => {
            const value = min + ((max - min) * i) / 3;
            return (
              <g key={i}>
                <line x1="52" x2={width - 20} y1={y(value)} y2={y(value)} className={s.gridline} />
                <text x="42" y={y(value) + 4} textAnchor="end">
                  {isFirst ? clock(value) : `${(value / 60).toFixed(1)}h`}
                </text>
              </g>
            );
          })}
          {isFirst && (
            <g>
              <line x1="52" x2={width - 20} y1={y(mean)} y2={y(mean)} className={s.mean} />
              <text x={width - 24} y={y(mean) - 8} textAnchor="end">
                平均 {clock(mean)}
              </text>
            </g>
          )}
          {days.map((d, i) => {
            const value = values[i];
            const label = describe(d);
            const parts =
              mode === 'duration'
                ? [d.work - d.lunch - d.overtime, d.lunch, d.overtime]
                : [value ?? 0];
            let cumulative = 0;
            return (
              <g key={d.date}>
                <g
                  tabIndex={0}
                  role="img"
                  aria-label={label}
                  className={s.point}
                  onFocus={() => setFocused(label)}
                  onBlur={() => setFocused(null)}
                  onMouseEnter={() => setFocused(label)}
                  onMouseLeave={() => setFocused(null)}
                >
                  <title>{label}</title>
                  <rect
                    x={x(i) - plot / days.length / 2}
                    y="16"
                    width={plot / days.length}
                    height={plotHeight}
                    fill="transparent"
                  />
                  {isFirst
                    ? value !== null && (
                        <circle cx={x(i)} cy={y(value)} r="5" className={s.workFill} />
                      )
                    : parts.map((part, j) => {
                        cumulative += part;
                        return (
                          <rect
                            key={j}
                            x={x(i) - barWidth / 2}
                            y={y(cumulative)}
                            width={barWidth}
                            height={(part / max) * plotHeight}
                            rx="2"
                            className={
                              mode === 'personal'
                                ? s.personalFill
                                : [s.workFill, s.lunchFill, s.overtimeFill][j]
                            }
                          />
                        );
                      })}
                </g>
                {i % Math.max(1, Math.ceil(days.length / 6)) === 0 && (
                  <text x={x(i)} y={height - 6} textAnchor="middle">
                    {d.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className={s.chartReadout} role="status" title={focused ?? undefined}>
        {focused ?? '悬停或用 Tab 聚焦图中日期，查看准确数值'}
      </div>
      {mode === 'duration' && (
        <div className={s.legend}>
          <span>
            <i className={s.workFill} />
            普通工作
          </span>
          <span>
            <i className={s.lunchFill} />
            午休占用
          </span>
          <span>
            <i className={s.overtimeFill} />
            加班
          </span>
        </div>
      )}
    </>
  );
}

const trendMetrics = {
  work: '工作时长',
  overtime: '加班时长',
  lunch: '午休占用',
  personal: '个人时长',
  parallelRatio: '并行占比',
  first: '首次工作时间',
} as const;
type TrendMetric = keyof typeof trendMetrics;
function TrendChart({ days }: { days: StatisticsDay[] }) {
  const { statistics: s } = useAppearance();
  const [metric, setMetric] = useState<TrendMetric>('work');
  const [focused, setFocused] = useState<string | null>(null);
  const { ref: chartRef, width, height } = useChartSize();
  const plotHeight = Math.max(10, height - 40);
  const values = days.map((day) => day[metric]);
  const valid = values.filter((value): value is number => value !== null);
  const isClock = metric === 'first',
    isRatio = metric === 'parallelRatio';
  const min = isClock ? 360 : 0;
  const max = isClock
    ? 1440
    : isRatio
      ? 1
      : Math.max(60, Math.ceil(valid.reduce((a, b) => Math.max(a, b), 0) / 60) * 60);
  const plot = width - 80;
  const x = (i: number) => 60 + ((i + 0.5) * plot) / days.length;
  const y = (value: number) => height - 24 - ((value - min) / (max - min)) * plotHeight;
  const label = (value: number | null) =>
    isClock ? clock(value) : isRatio ? percent(value) : value === null ? '—' : exactDuration(value);
  const hasData = days.some((day) => day.total > 0) && valid.length > 0;
  return (
    <>
      <div className={s.trendToolbar}>
        <label>
          分析指标{' '}
          <select
            aria-label="趋势指标"
            value={metric}
            onChange={(event) => {
              setMetric(event.target.value as TrendMetric);
              setFocused(null);
            }}
          >
            {Object.entries(trendMetrics).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span>按日 · {isClock ? '时刻' : isRatio ? '百分比' : '小时'}</span>
      </div>
      {!hasData ? (
        <Empty>所选范围没有可分析的记录</Empty>
      ) : (
        <>
          <div className={s.chartScroll} ref={chartRef}>
            <svg
              className={s.chart}
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="xMidYMid meet"
              role="group"
              aria-label={`${trendMetrics[metric]}折线趋势`}
            >
              {[0, 1, 2, 3, 4].map((index) => {
                const value = min + ((max - min) * index) / 4;
                return (
                  <g key={index}>
                    <line
                      x1="60"
                      x2={width - 20}
                      y1={y(value)}
                      y2={y(value)}
                      className={s.gridline}
                    />
                    <text x="50" y={y(value) + 4} textAnchor="end">
                      {isClock
                        ? clock(value)
                        : isRatio
                          ? percent(value)
                          : `${(value / 60).toFixed(1)}h`}
                    </text>
                  </g>
                );
              })}
              {values.map((value, i) => {
                const previous = values[i - 1];
                return value !== null && previous !== null && previous !== undefined ? (
                  <line
                    key={days[i].date}
                    x1={x(i - 1)}
                    y1={y(previous)}
                    x2={x(i)}
                    y2={y(value)}
                    className={s.trendLine}
                  />
                ) : null;
              })}
              {days.map((day, i) => {
                const value = values[i];
                const text = `${day.date} · ${trendMetrics[metric]} ${label(value)}`;
                return (
                  <g key={day.date}>
                    <g
                      tabIndex={0}
                      role="img"
                      aria-label={text}
                      className={s.point}
                      onFocus={() => setFocused(text)}
                      onBlur={() => setFocused(null)}
                      onMouseEnter={() => setFocused(text)}
                      onMouseLeave={() => setFocused(null)}
                    >
                      <title>{text}</title>
                      <rect
                        x={x(i) - plot / days.length / 2}
                        y="16"
                        width={plot / days.length}
                        height={plotHeight}
                        fill="transparent"
                      />
                      {value !== null && (
                        <circle cx={x(i)} cy={y(value)} r="3" className={s.trendDot} />
                      )}
                    </g>
                    {i % Math.max(1, Math.ceil(days.length / 6)) === 0 && (
                      <text x={x(i)} y={height - 6} textAnchor="middle">
                        {day.date.slice(5)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className={s.chartReadout} role="status" title={focused ?? undefined}>
            {focused ?? '悬停或用 Tab 查看每日数值；无首次工作或无占比分母的日期断开连线。'}
          </div>
        </>
      )}
    </>
  );
}

export function StatisticsDashboard({
  onEditingChange,
  workspace,
  preferences,
  update,
}: {
  workspace: Workspace;
  onEditingChange: (editing: boolean) => void;
  preferences: StatisticsPreferences;
  update: (value: StatisticsPreferences) => Promise<boolean>;
}) {
  const { statistics: s } = useAppearance();
  const [now, setNow] = useState(Date.now());
  const [popup, setPopup] = useState<'config' | 'method' | 'dates' | 'details' | null>(null);
  const [group, setGroup] = useState(0);
  const [tagPage, setTagPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const range = statisticsRange(preferences, now);
  const [draftStart, setDraftStart] = useState(range.startDate);
  const [draftEnd, setDraftEnd] = useState(range.endDate);
  const [rangeError, setRangeError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    onEditingChange(!!popup || !!expanded);
    return () => onEditingChange(false);
  }, [popup, expanded, onEditingChange]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setDraftStart(range.startDate);
    setDraftEnd(range.endDate);
  }, [range.startDate, range.endDate]);
  const data = useMemo(
    () => calculateStatistics(workspace, { ...range, tagId: preferences.tagId, now }),
    [workspace, range.startDate, range.endDate, preferences.tagId, now],
  );
  const summary = data.summary;
  const rankedTags = [
    ...data.tags,
    { id: null, name: '无标签', color: '#8b929e', minutes: data.untaggedMinutes },
  ]
    .filter((tag) => tag.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
  const tagPages = Math.max(1, Math.ceil(rankedTags.length / 4));
  const currentTagPage = Math.min(tagPage, tagPages - 1);
  const save = async (next: StatisticsPreferences) => {
    setSaving(true);
    try {
      return await update(next);
    } finally {
      setSaving(false);
    }
  };
  const visible = (key: ChartKey) => !preferences.hiddenCharts.includes(key);
  const groupKeys = ['trend', 'duration', 'first', 'tags', null, 'selectedTag'] as const;
  const activeGroup = groupKeys[group] === null || visible(groupKeys[group]!) ? group : 4;
  const cards = [
    [
      '工作时长',
      hours(summary.work),
      `${summary.workDays} 个有记录日 · 日均 ${hours(summary.dailyWork)}`,
      s.work,
    ],
    ['加班时长', hours(summary.overtime), '21:00—次日06:00', s.overtime],
    ['午休占用', hours(summary.lunch), '12:30—14:00 · 午睡牺牲时间', s.lunch],
    [
      '并行占比',
      percent(summary.parallelRatio),
      `多任务同时进行 ${hours(summary.parallel)}`,
      s.work,
    ],
    ['平均首次工作', clock(summary.first), '每天06:00后的首次工作', s.work],
    [
      '个人时长',
      hours(summary.personal),
      `${summary.personalDays} 天 · 占总投入 ${percent(summary.personalRatio)}`,
      s.personal,
    ],
  ];
  return (
    <main className={s.dashboard} aria-label="统计面板">
      <div className={s.toolbar}>
        <h1>统计</h1>
        <div className={s.presets}>
          {(['last30', 'week', 'month', 'custom'] as const).map((key, i) => (
            <button
              key={key}
              disabled={saving}
              aria-pressed={preferences.range === key}
              onClick={() => {
                setRangeError('');
                if (key === 'custom') {
                  setPopup('dates');
                  return;
                }
                void save({
                  ...preferences,
                  range: key,
                });
              }}
            >
              {['近30天', '本周', '本月', '自定义'][i]}
            </button>
          ))}
        </div>
        <span className={s.rangeLabel}>
          {range.startDate} — {range.endDate}
        </span>
        <div className={s.actions}>
          {preferences.range === 'custom' && (
            <button onClick={() => setPopup('dates')}>修改日期</button>
          )}
          <button onClick={() => setPopup('details')}>每日明细</button>
          <button onClick={() => setPopup('config')}>配置</button>
          <button onClick={() => setPopup('method')}>口径</button>
        </div>
      </div>
      {popup === 'dates' && (
        <StatisticsDialog title="自定义日期" close={() => setPopup(null)}>
          <form
            className={s.dateForm}
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                !validStatisticsDate(draftStart) ||
                !validStatisticsDate(draftEnd) ||
                draftStart > draftEnd
              ) {
                setRangeError('请选择有效日期，开始日期不能晚于结束日期');
                return;
              }
              setRangeError('');
              const saved = await save({
                ...preferences,
                range: 'custom',
                startDate: draftStart,
                endDate: draftEnd,
              });
              if (saved) setPopup(null);
              else setRangeError('日期保存失败，请重试');
            }}
          >
            <input
              type="date"
              aria-label="统计开始日期"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
              required
            />
            <span>至</span>
            <input
              type="date"
              aria-label="统计结束日期"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              required
            />
            <button disabled={saving}>应用日期</button>
          </form>
          {rangeError && <p role="alert">{rangeError}</p>}
        </StatisticsDialog>
      )}
      {popup === 'config' && (
        <StatisticsDialog title="统计展示配置" close={() => setPopup(null)}>
          <section className={s.configuration} aria-label="统计展示配置">
            <strong>显示图表</strong>
            {(Object.keys(chartLabels) as ChartKey[]).map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={visible(key)}
                  disabled={saving}
                  onChange={() =>
                    void save({
                      ...preferences,
                      hiddenCharts: visible(key)
                        ? [...preferences.hiddenCharts, key]
                        : preferences.hiddenCharts.filter((k) => k !== key),
                    })
                  }
                />
                {chartLabels[key]}
              </label>
            ))}
            <button
              disabled={saving}
              onClick={() => {
                setRangeError('');
                void save(structuredClone(defaultStatistics));
              }}
            >
              恢复默认展示
            </button>
          </section>
        </StatisticsDialog>
      )}
      <div className={s.metrics}>
        {cards.map(([label, value, hint, color]) => (
          <section className={`${s.metric} ${color}`} key={label}>
            <h2>{label}</h2>
            <strong>{value}</strong>
            <p>{hint}</p>
            {label === '并行占比' && visible('parallel') && (
              <div className={s.parallelMini}>
                <div>
                  <i style={{ width: `${(summary.parallelRatio ?? 0) * 100}%` }} />
                </div>
                <span>
                  单任务 {hours(summary.work - summary.parallel)} · 多任务 {hours(summary.parallel)}
                </span>
              </div>
            )}
          </section>
        ))}
      </div>
      {popup === 'method' && (
        <StatisticsDialog title="统计口径 · 上海时区" close={() => setPopup(null)}>
          <div className={s.method}>
            <p>
              包括已完成、未完成和归档任务；未定时及未来安排不计入，今日截至当前时刻。工作任务排除带“个人”标签的任务；任务自身标签决定分类。重叠时段去重，两个不同工作任务同时进行才算并行，父子任务独立参与。
            </p>
            <p>
              首次工作取06:00后的首个工作时段，跨06:00取06:00。标签内部去重，标签之间、个人与工作之间可能重叠，不能直接相加。历史结果随当前任务、安排和标签修改而重算。
            </p>
          </div>
        </StatisticsDialog>
      )}
      <nav className={s.groupNav} aria-label="图表分组">
        {['投入趋势', '每日投入', '工作节奏', '标签排行', '个人时间', '关注标签'].map(
          (label, index) => (
            <button
              key={label}
              disabled={groupKeys[index] !== null && !visible(groupKeys[index]!)}
              aria-pressed={activeGroup === index}
              onClick={() => setGroup(index)}
            >
              {label}
            </button>
          ),
        )}
      </nav>
      <div className={s.grid} data-group={activeGroup}>
        {visible('trend') && (
          <Card title="投入如何变化" description="折线趋势 · 切换指标，观察每天的投入与节奏" wide>
            <TrendChart days={data.days} />
          </Card>
        )}
        {visible('duration') && (
          <Card title="每日投入" description="普通工作、午休占用与加班，合计为当天工作时长" wide>
            <DailyChart days={data.days} mode="duration" />
          </Card>
        )}
        {visible('first') && (
          <Card
            title="一天从何时开始"
            description="06:00后的首次工作 · 虚线为有记录日期的平均值"
            wide
          >
            <DailyChart days={data.days} mode="first" />
          </Card>
        )}
        {visible('tags') && (
          <Card title="时间花在了哪里" description="含无标签任务；分类内部去重，分类之间可能重叠">
            {rankedTags.length === 0 ? (
              <Empty />
            ) : (
              <>
                <div className={s.ranking}>
                  {rankedTags.slice(currentTagPage * 4, currentTagPage * 4 + 4).map((tag) => (
                    <div className={s.rankRow} key={tag.id === null ? 'untagged' : `tag-${tag.id}`}>
                      <span title={tag.name}>{tag.name}</span>
                      <svg
                        viewBox="0 0 240 14"
                        role="img"
                        aria-label={`${tag.name} ${hours(tag.minutes)}`}
                      >
                        <rect width="240" height="14" rx="7" className={s.track} />
                        <rect
                          width={(240 * tag.minutes) / rankedTags[0].minutes}
                          height="14"
                          rx="7"
                          fill={tag.color}
                        />
                      </svg>
                      <b>{hours(tag.minutes)}</b>
                    </div>
                  ))}
                </div>
                <div className={s.pagination}>
                  <button
                    disabled={currentTagPage === 0}
                    onClick={() => setTagPage(currentTagPage - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    {currentTagPage + 1} / {tagPages} · {rankedTags.length} 个分类
                  </span>
                  <button
                    disabled={currentTagPage + 1 >= tagPages}
                    onClick={() => setTagPage(currentTagPage + 1)}
                  >
                    下一页
                  </button>
                </div>
              </>
            )}
          </Card>
        )}
        <Card title="留给自己的时间" description="固定关注「个人」标签" wide>
          {data.personalId ? (
            <>
              <div className={s.tagSummary}>
                <strong>{hours(summary.personal)}</strong>
                <span>
                  占全部投入 <b>{percent(summary.personalRatio)}</b>
                </span>
                <span>
                  涉及 <b>{summary.personalDays}</b> 天
                </span>
              </div>
              <DailyChart days={data.days} mode="personal" />
            </>
          ) : (
            <Empty>尚未设置“个人”标签。为任务添加此名称的标签后，这里会自动统计。</Empty>
          )}
        </Card>
        {visible('selectedTag') && (
          <Card title="关注一个标签" description="随时切换你想了解的投入方向" wide>
            <select
              className={s.tagSelect}
              aria-label="关注标签"
              value={preferences.tagId ?? ''}
              disabled={saving}
              onChange={(e) => void save({ ...preferences, tagId: e.target.value || null })}
            >
              <option value="">选择标签</option>
              {preferences.tagId && !data.selectedTag && (
                <option value={preferences.tagId}>原标签已删除</option>
              )}
              {workspace.tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                  {tag.archivedAt ? '（已归档）' : ''}
                </option>
              ))}
            </select>
            {data.selectedTag ? (
              <>
                <div className={s.tagSummary}>
                  <strong>{hours(summary.selectedTag)}</strong>
                  <span>
                    占全部投入 <b>{percent(summary.selectedTagRatio)}</b>
                  </span>
                  <span>
                    涉及 <b>{summary.selectedTagDays}</b> 天
                  </span>
                </div>
                <DailyChart days={data.days} mode="selectedTag" />
              </>
            ) : (
              <Empty>
                {preferences.tagId
                  ? '原关注标签已删除，请重新选择。'
                  : '选择一个标签，查看它的投入时长与每日趋势。'}
              </Empty>
            )}
          </Card>
        )}
      </div>
      {popup === 'details' && (
        <StatisticsDialog title="每日明细" close={() => setPopup(null)}>
          <Card
            title="每日明细"
            description="点击日期展开任务时段，数值均按当天已发生的区间计算"
            wide
          >
            {!data.days.length ? (
              <Empty>所选范围尚无已发生的日期</Empty>
            ) : (
              <div className={s.tableScroll}>
                <table>
                  <thead>
                    <tr>
                      {[
                        '日期',
                        '首次工作',
                        '最后结束',
                        '工作',
                        '加班',
                        '午休占用',
                        '并行',
                        '并行占比',
                        '个人',
                      ].map((label) => (
                        <th key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.days].reverse().map((day) => (
                      <Fragment key={day.date}>
                        <tr>
                          <td>
                            <button
                              aria-expanded={expanded === day.date}
                              onClick={() => setExpanded(expanded === day.date ? null : day.date)}
                            >
                              {expanded === day.date ? '−' : '+'} {day.date}
                            </button>
                          </td>
                          <td>{clock(day.first)}</td>
                          <td>{clock(day.last)}</td>
                          <td>{hours(day.work)}</td>
                          <td>{hours(day.overtime)}</td>
                          <td>{hours(day.lunch)}</td>
                          <td>{hours(day.parallel)}</td>
                          <td>{percent(ratio(day.parallel, day.work))}</td>
                          <td>{hours(day.personal)}</td>
                        </tr>
                        {expanded === day.date && (
                          <tr>
                            <td colSpan={9}>
                              <div className={s.dayDetails}>
                                {day.details.length
                                  ? day.details.map((detail) => (
                                      <div key={detail.taskId}>
                                        <strong>{detail.title}</strong>
                                        <span>
                                          {detail.personal ? '个人' : '工作'} ·{' '}
                                          {detail.intervals
                                            .map(([a, b]) => `${clock(a)}–${clock(b)}`)
                                            .join('、')}
                                        </span>
                                        <small>
                                          {detail.tagIds
                                            .map(
                                              (id) => workspace.tags.find((t) => t.id === id)?.name,
                                            )
                                            .filter(Boolean)
                                            .join(' · ') || '无标签'}
                                        </small>
                                      </div>
                                    ))
                                  : '当天没有定时投入记录'}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </StatisticsDialog>
      )}
    </main>
  );
}
