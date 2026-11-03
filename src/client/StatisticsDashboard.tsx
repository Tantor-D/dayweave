import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  calculateStatistics,
  defaultStatistics,
  statisticsRange,
  ratio,
  validStatisticsDate,
  type StatisticsDay,
} from '../domain/statistics';
import type { StatisticsPreferences, Workspace } from '../domain/types';
import s from './StatisticsDashboard.module.css';

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
  return (
    <section className={`${s.card} ${wide ? s.wide : ''}`}>
      <div className={s.cardHeading}>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}
function Empty({ children = '这段时间还没有投入记录' }: { children?: ReactNode }) {
  return <div className={s.empty}>{children}</div>;
}

function DailyChart({
  days,
  mode,
}: {
  days: StatisticsDay[];
  mode: 'duration' | 'first' | 'personal' | 'selectedTag';
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const isFirst = mode === 'first';
  const values = days.map((d) => (isFirst ? d.first : mode === 'duration' ? d.work : d[mode]));
  if (!values.some((v) => v !== null && v > 0)) return <Empty />;
  const max = isFirst
    ? 1440
    : Math.max(60, Math.ceil(Math.max(...values.map((v) => v ?? 0)) / 60) * 60);
  const min = isFirst ? 360 : 0;
  const width = Math.max(640, days.length * 22),
    plot = width - 72;
  const x = (i: number) => 52 + ((i + 0.5) * plot) / days.length;
  const y = (value: number) => 206 - ((value - min) / (max - min)) * 166;
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
      <div className={s.chartScroll}>
        <svg
          className={s.chart}
          viewBox={`0 0 ${width} 248`}
          style={{ minWidth: Math.min(width, 2200) }}
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
                    y="32"
                    width={plot / days.length}
                    height="176"
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
                            height={(part / max) * 166}
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
                {(i % Math.max(1, Math.ceil(days.length / 10)) === 0 || i === days.length - 1) && (
                  <text x={x(i)} y="232" textAnchor="middle">
                    {d.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className={s.chartReadout} role="status">
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

export function StatisticsDashboard({
  workspace,
  preferences,
  update,
}: {
  workspace: Workspace;
  preferences: StatisticsPreferences;
  update: (value: StatisticsPreferences) => Promise<boolean>;
}) {
  const [now, setNow] = useState(Date.now());
  const [configOpen, setConfigOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const range = statisticsRange(preferences, now);
  const [draftStart, setDraftStart] = useState(range.startDate);
  const [draftEnd, setDraftEnd] = useState(range.endDate);
  const [rangeError, setRangeError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
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
  const save = async (next: StatisticsPreferences) => {
    setSaving(true);
    try {
      await update(next);
    } finally {
      setSaving(false);
    }
  };
  const visible = (key: ChartKey) => !preferences.hiddenCharts.includes(key);
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
      <div className={s.heading}>
        <div>
          <span className={s.eyebrow}>时间与节奏</span>
          <h1>看见时间的去向</h1>
          <p>从日常记录中，发现投入、节奏与留给自己的空间。</p>
        </div>
        <button onClick={() => setConfigOpen(!configOpen)} aria-expanded={configOpen}>
          配置展示
        </button>
      </div>
      <div className={s.toolbar}>
        <div className={s.presets}>
          {(['last30', 'week', 'month', 'custom'] as const).map((key, i) => (
            <button
              key={key}
              disabled={saving}
              aria-pressed={preferences.range === key}
              onClick={() => {
                setRangeError('');
                void save({
                  ...preferences,
                  range: key,
                  ...(key === 'custom'
                    ? { startDate: range.startDate, endDate: range.endDate }
                    : {}),
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
        {preferences.range === 'custom' && (
          <form
            className={s.dateForm}
            onSubmit={(e) => {
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
              void save({ ...preferences, startDate: draftStart, endDate: draftEnd });
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
        )}
      </div>
      {rangeError && <p role="alert">{rangeError}</p>}
      {configOpen && (
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
      )}
      <div className={s.metrics}>
        {cards.map(([label, value, hint, color]) => (
          <section className={`${s.metric} ${color}`} key={label}>
            <h2>{label}</h2>
            <strong>{value}</strong>
            <p>{hint}</p>
          </section>
        ))}
      </div>
      <details className={s.method}>
        <summary>统计口径 · 已发生的时间轴记录 · 上海时区</summary>
        <p>
          包括已完成、未完成和归档任务；未定时及未来安排不计入，今日截至当前时刻。工作任务排除带“个人”标签的任务；任务自身标签决定分类。重叠时段去重，两个不同工作任务同时进行才算并行，父子任务独立参与。
        </p>
        <p>
          首次工作取06:00后的首个工作时段，跨06:00取06:00。标签内部去重，标签之间、个人与工作之间可能重叠，不能直接相加。历史结果随当前任务、安排和标签修改而重算。
        </p>
      </details>
      <div className={s.grid}>
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
        {visible('parallel') && (
          <Card title="专注与并行" description="按真实经过的时间去重，不叠加任务时长">
            {summary.work ? (
              <>
                <div className={s.splitSummary}>
                  <strong>{percent(summary.parallelRatio)}</strong>
                  <span>工作时间在处理多个任务</span>
                </div>
                <svg
                  viewBox="0 0 500 42"
                  className={s.split}
                  role="img"
                  aria-label={`单任务 ${hours(summary.work - summary.parallel)}，多任务 ${hours(summary.parallel)}`}
                >
                  <rect x="0" y="4" width="500" height="30" rx="12" className={s.workFill} />
                  <rect
                    x={500 * (1 - (summary.parallelRatio ?? 0))}
                    y="4"
                    width={500 * (summary.parallelRatio ?? 0)}
                    height="30"
                    rx="8"
                    className={s.overtimeFill}
                  />
                </svg>
                <div className={s.splitLabels}>
                  <span>
                    单任务 <b>{hours(summary.work - summary.parallel)}</b>
                  </span>
                  <span>
                    多任务 <b>{hours(summary.parallel)}</b>
                  </span>
                </div>
              </>
            ) : (
              <Empty />
            )}
          </Card>
        )}
        {visible('tags') && (
          <Card title="时间花在了哪里" description="标签内部去重；多标签之间可能重叠">
            {!data.tags.some((tag) => tag.minutes > 0) ? (
              <Empty />
            ) : (
              <div className={s.ranking}>
                {data.tags
                  .filter((tag) => tag.minutes > 0)
                  .map((tag) => (
                    <div className={s.rankRow} key={tag.id}>
                      <span title={tag.name}>{tag.name}</span>
                      <svg
                        viewBox="0 0 240 14"
                        role="img"
                        aria-label={`${tag.name} ${hours(tag.minutes)}`}
                      >
                        <rect width="240" height="14" rx="7" className={s.track} />
                        <rect
                          width={(240 * tag.minutes) / data.tags[0].minutes}
                          height="14"
                          rx="7"
                          fill={tag.color}
                        />
                      </svg>
                      <b>{hours(tag.minutes)}</b>
                    </div>
                  ))}
              </div>
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
      </div>
      <p className={s.footer}>时间记录不等于打卡证明。给每一次投入留痕，也给休息留出位置。</p>
    </main>
  );
}
