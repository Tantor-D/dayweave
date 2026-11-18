import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Layers3,
  Waves,
  Sun,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  ListTodo,
  Clock3,
  CalendarDays,
  Feather,
  Headphones,
  Coffee,
  MessagesSquare,
  BookOpen,
  X,
} from 'lucide-react';
import { liquidGlass, isLensSupported } from './vendor/lens.js';
import './style.css';

const entries = [
  {
    name: '梳理秋季用户访谈的核心发现',
    kind: '研究整理',
    start: '09:00',
    end: '10:30',
    minutes: 90,
    icon: Headphones,
    note: '回听三段访谈录音，摘出关于使用动机的原话，整理成一页发现摘要。',
    color: 'blue',
  },
  {
    name: '撰写专注工作台的交互说明',
    kind: '深度写作',
    start: '10:45',
    end: '12:00',
    minutes: 75,
    icon: Feather,
    note: '从任务进入详情的路径写起，补齐日期切换和空状态的交互示例。',
    color: 'purple',
  },
  {
    name: '和设计伙伴对齐首页改版方向',
    kind: '协作讨论',
    start: '14:00',
    end: '14:45',
    minutes: 45,
    icon: MessagesSquare,
    note: '带上两份首页草图，确认信息优先级，并记录仍需验证的问题。',
    color: 'green',
  },
  {
    name: '阅读并摘录信息设计案例',
    kind: '阅读积累',
    start: '16:00',
    end: '16:30',
    minutes: 30,
    icon: BookOpen,
    note: '选择两个层级清晰的案例，写下它们如何安排标题、图例和留白。',
    color: 'sand',
  },
];
const rest = {
  name: '午间休息',
  kind: '留白',
  start: '12:00',
  end: '14:00',
  minutes: 120,
  icon: Coffee,
  note: '午餐，散步。',
  color: 'rest',
};
const today = new Date();
today.setHours(12, 0, 0, 0);
function Ribbon() {
  const path =
    'M-160 235 C95 255 190 -40 410 55 S745 225 891 156 S1110 -16 1360 55 S1550 164 1650 105';
  return (
    <svg className="ribbon" viewBox="0 0 1440 290" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="silk">
          <stop stopColor="#b9d7df" />
          <stop offset=".29" stopColor="#9bbcd7" />
          <stop offset=".56" stopColor="#5f93b7" />
          <stop offset=".76" stopColor="#82b5c9" />
          <stop offset="1" stopColor="#ced6ec" />
        </linearGradient>
      </defs>
      {Array.from({ length: 80 }, (_, i) => (
        <path
          key={i}
          d={path}
          transform={`translate(${i * 0.72} ${i * 0.72 - 23})`}
          fill="none"
          stroke="url(#silk)"
          strokeWidth={2}
          opacity={0.08 + 0.53 * Math.sin((i / 80) * Math.PI) ** 1.5}
        />
      ))}
      {[7, 17, 35, 62, 77].map((i) => (
        <path
          key={i}
          d={path}
          transform={`translate(${i * 0.72} ${i * 0.72 - 23})`}
          fill="none"
          stroke="white"
          strokeWidth=".9"
          opacity=".65"
        />
      ))}
    </svg>
  );
}
function App() {
  const [mist, setMist] = useState(true),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<number | null>(null),
    [hidden, setHidden] = useState(document.hidden);
  const dialog = useRef<HTMLDialogElement>(null),
    glass = useRef<HTMLDivElement>(null);
  const date = new Date(today);
  date.setDate(date.getDate() + offset);
  const tasks = offset === 0 ? entries : entries.filter((_, i) => (i + offset) % 3 !== 0);
  const events = [...tasks, rest].sort((a, b) => a.start.localeCompare(b.start));
  const task = selected === null ? null : tasks[selected];
  useEffect(() => {
    if (glass.current && isLensSupported()) {
      const lens = liquidGlass(glass.current, { rim: 34, edge: 1.6, power: 1.7, dispersion: 0.09 });
      return () => lens.destroy();
    }
  }, []);
  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  useEffect(() => {
    if (task) dialog.current?.showModal();
  }, [task]);
  const title = offset === 0 ? '今日工作台' : '每日工作台';
  return (
    <main className={(mist ? 'mist' : 'plain') + (hidden ? ' paused' : '')}>
      <header>
        <div className="brand">
          <span>
            <Layers3 size={21} />
          </span>
          间序
          <i />
          专注工作台
        </div>
        <div className="switch" aria-label="背景选择">
          {(
            [
              [true, Waves, '流动薄雾'],
              [false, Sun, '白底'],
            ] as const
          ).map(([v, Icon, label]) => {
            return (
              <button
                key={String(label)}
                aria-pressed={mist === v}
                onClick={() => setMist(v === true)}
              >
                <Icon size={15} />
                {String(label)}
              </button>
            );
          })}
        </div>
      </header>
      <section className="hero">
        {mist && <Ribbon />}
        <div className="heroInner">
          <div className="intro">
            <div className="month">
              {date.toLocaleDateString('en-US', { month: 'long' }).toUpperCase()} <span>/</span>{' '}
              {date.getFullYear()}
            </div>
            <h1>{title}</h1>
            <div className="summary">
              <ListTodo size={15} />
              {tasks.length} 项任务 <b /> <Clock3 size={15} />
              {tasks.reduce((n, t) => n + t.minutes, 0) / 60} 小时安排
            </div>
          </div>
          <div className="dateGlass" ref={glass}>
            <div className="dateText">
              <small>
                <CalendarDays size={14} />
                {date.toLocaleDateString('zh-CN', { weekday: 'long' })}
              </small>
              <strong>
                {String(date.getMonth() + 1).padStart(2, '0')}
                <em>/</em>
                {String(date.getDate()).padStart(2, '0')}
              </strong>
            </div>
            <nav>
              <button aria-label="上一天" onClick={() => setOffset(offset - 1)}>
                <ChevronLeft />
              </button>
              <button aria-label="下一天" onClick={() => setOffset(offset + 1)}>
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
            <small>{String(tasks.length).padStart(2, '0')}</small>
          </div>
          <div className="taskList">
            {tasks.map((t, i) => (
              <button
                aria-pressed={selected === i}
                className={'task ' + t.color}
                key={t.name}
                onClick={() => setSelected(i)}
              >
                <span className="taskTop">
                  <span className="icon">
                    <t.icon size={18} />
                  </span>
                  <span>{t.kind}</span>
                  <ArrowUpRight className="arrow" size={15} />
                </span>
                <strong>{t.name}</strong>
                <span className="meta">
                  <Clock3 size={12} />
                  {t.minutes} 分钟
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="timeline">
          <div className="sectionTitle">
            <Clock3 />
            <h2>当天时间轴</h2>
            <small>
              {events[0].start} — {events.at(-1)?.end}
            </small>
          </div>
          <div className="agenda">
            {events.map((t) => (
              <div className={'row ' + t.color} key={t.start}>
                <time>{t.start}</time>
                <span className="track">
                  <i />
                </span>
                {t === rest ? (
                  <div className="break">
                    <Coffee size={16} />
                    午间休息
                  </div>
                ) : (
                  <button className="event" onClick={() => setSelected(tasks.indexOf(t))}>
                    <span className="eventTime">
                      {t.start} — {t.end}
                    </span>
                    <strong>{t.name}</strong>
                    <span className="pill">{t.kind}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
      <dialog
        aria-label="任务详情"
        ref={dialog}
        onClose={() => setSelected(null)}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        {task && (
          <div className={'detail ' + task.color}>
            <div className="detailTop">
              <span className="icon">
                <task.icon size={20} />
              </span>
              <button aria-label="关闭详情" onClick={() => dialog.current?.close()}>
                <X size={18} />
              </button>
            </div>
            <article>
              <small>{task.kind} · 任务详情</small>
              <h2>{task.name}</h2>
              <p className="meta">
                <Clock3 size={14} />
                {task.start} — {task.end} · {task.minutes} 分钟
              </p>
              <hr />
              <h3>备注</h3>
              <p>{task.note}</p>
            </article>
          </div>
        )}
      </dialog>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
