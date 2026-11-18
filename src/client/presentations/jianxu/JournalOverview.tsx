import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  Clock3,
  Waves,
  Sun,
  Plus,
  ArrowUpRight,
  Check,
  Circle,
} from 'lucide-react';
import type { Workbench } from '../../application/useWorkbench';
import { addDays, minuteLabel, segmentsFor, taskOnDay, today, weekday } from '../../time';
import { Ribbon } from '../../../../prototype/glasswork/Ribbon';
import { liquidGlass, isLensSupported } from '../../../../prototype/glasswork/vendor/lens.js';
import './journal.css';

export function JournalOverview({ workbench: w }: { workbench: Workbench }) {
  const [mist, setMist] = useState(() => localStorage.getItem('jianxu-background') !== 'white');
  const [hidden, setHidden] = useState(document.hidden);
  const glass = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!glass.current || !isLensSupported()) return;
    const lens = liquidGlass(glass.current, { rim: 34, edge: 1.6, power: 1.7, dispersion: 0.09 });
    return () => lens.destroy();
  }, []);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const { date, filteredTasks } = w;
  const tasks = filteredTasks.filter((t) => taskOnDay(t, date));
  const timed = segmentsFor(tasks, date);
  const untimed = tasks.filter((t) =>
    t.placements.some((p) => p.kind === 'day' && p.date === date),
  );
  const minutes = timed.reduce((n, s) => n + s.end - s.start, 0);
  const month = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long',
    timeZone: 'UTC',
  });
  return (
    <div className={'journalOverview ' + (mist ? 'mist' : 'plain') + (hidden ? ' paused' : '')}>
      <section className="hero">
        {mist && <Ribbon />}
        <div className="heroInner">
          <div className="intro">
            <div className="month">
              {month.toUpperCase()} / {date.slice(0, 4)}
            </div>
            <h1>{date === today() ? '今日工作台' : '每日工作台'}</h1>
            <div className="summary">
              <ListTodo size={15} />
              {tasks.length} 项任务
              <b />
              <Clock3 size={15} />
              {minutes} 分钟安排
              <button
                className="backgroundChoice"
                title="切换白底与流动薄雾"
                aria-pressed={mist}
                onClick={() => {
                  localStorage.setItem('jianxu-background', mist ? 'white' : 'mist');
                  setMist(!mist);
                }}
              >
                {mist ? <Waves size={15} /> : <Sun size={15} />} {mist ? '流动薄雾' : '白底'}
              </button>
            </div>
          </div>
          <div className="dateGlass" ref={glass}>
            <div className="dateText">
              <small>
                <CalendarDays size={14} />
                {weekday(date)}
              </small>
              <strong>
                {date.slice(5, 7)}
                <em>/</em>
                {date.slice(8)}
              </strong>
            </div>
            <nav>
              <button aria-label="上一天" onClick={() => w.setDate(addDays(date, -1))}>
                <ChevronLeft />
              </button>
              <button onClick={() => w.setDate(today())}>今天</button>
              <button aria-label="下一天" onClick={() => w.setDate(addDays(date, 1))}>
                <ChevronRight />
              </button>
            </nav>
          </div>
        </div>
      </section>
      <div className="workspace">
        <section className="tasks">
          <div className="sectionTitle">
            <ListTodo />
            <h2>任务清单</h2>
            <button aria-label="新建任务" onClick={() => w.setNewTask(true)}>
              <Plus size={16} />
            </button>
          </div>
          <div className="taskList">
            {tasks.map((t) => (
              <button
                key={t.id}
                className="task blue"
                aria-pressed={w.selected === t.id && w.panel === 'task'}
                onClick={() => w.select(t.id)}
              >
                <span className="taskTop">
                  {t.status === 'done' ? <Check size={14} /> : <Circle size={14} />}{' '}
                  {t.status === 'done' ? '已完成' : '待完成'}
                  <ArrowUpRight className="arrow" size={15} />
                </span>
                <strong>{t.title}</strong>
              </button>
            ))}
            {!tasks.length && <p>这一天还没有符合当前筛选的任务。</p>}
          </div>
        </section>
        <section className="timeline">
          <div className="sectionTitle">
            <Clock3 />
            <h2>当天时间轴</h2>
          </div>
          <div className="agenda">
            {untimed.map((t) => (
              <div className="row green" key={t.id}>
                <time>当天</time>
                <span className="track">
                  <i />
                </span>
                <button className="event" onClick={() => w.select(t.id)}>
                  <span className="eventTime">未定时</span>
                  <strong>{t.title}</strong>
                </button>
              </div>
            ))}
            {timed.map(({ task, placement, start, end }) => (
              <div className="row blue" key={task.id + placement.id}>
                <time>{minuteLabel(start)}</time>
                <span className="track">
                  <i />
                </span>
                <button className="event" onClick={() => w.select(task.id)}>
                  <span className="eventTime">
                    {minuteLabel(start)} — {minuteLabel(end)}
                  </span>
                  <strong>{task.title}</strong>
                </button>
              </div>
            ))}
            {!tasks.length && <p>暂无日程。可在排期视图中安排任务。</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
