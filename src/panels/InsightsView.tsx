import { invoke } from '@/lib/tauri';
import { sameJson, useLibraryRefresh } from '@/lib/hooks/use-library-refresh';
import { useMemo, useState } from 'react';
import { AnimatedNumber } from '@/components/motion/animated-number';
import { Tabs, TabsList, TabsTrigger } from '@/components/motion/tabs';
import { PixelStrip } from '@/components/brand/pixel-field';
import { motion, useReducedMotion } from 'motion/react';
import { EASE_OUT } from '@/lib/ease';
import './panels.css';

type Row = { label: string; sessions: number; prompts: number; tokens: number };
type Insights = {
  sessions: number;
  prompts: number;
  tokens: number;
  activity: [string, number][];
  hours?: [number, number][];
  agents: Row[];
  projects: Row[];
  models: Row[];
};
type Metric = 'sessions' | 'prompts' | 'tokens';
type Board = 'agents' | 'projects' | 'models';

const labels = {
  title: 'Insights', subtitle: 'Every session you have had with an agent, measured in one place.', eyebrow: 'Overview', sessions: 'Sessions',
  prompts: 'Prompts', tokens: 'Tokens', activity: 'Activity', lastYear: 'Last 12 months',
  less: 'Less', more: 'More', weekday: 'Weekdays', month: 'Months', hour: 'Hours',
  agents: 'Agents', projects: 'Projects', models: 'Models', empty: 'No sessions indexed yet.',
  retry: 'Retry', noData: 'No data yet',
} as const;

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shortNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function Bars({ rows, metric, empty }: { rows: Row[]; metric: Metric; empty: string }) {
  const reduce = useReducedMotion();
  const sorted = [...rows].sort((a, b) => b[metric] - a[metric]).slice(0, 10);
  const max = sorted[0]?.[metric] ?? 0;
  if (!sorted.length) return <p className="panel-empty">{empty}</p>;
  return <div className="insight-bars">
    {sorted.map(row => <div className="insight-bar" key={row.label}>
      <span className="insight-bar-label" title={row.label}>{row.label}</span>
      <div className="insight-bar-track"><motion.div initial={reduce ? false : { width: 0 }}
        animate={{ width: `${max ? Math.max(2, row[metric] / max * 100) : 0}%` }} transition={{ duration: 0.35, ease: EASE_OUT }} /></div>
      <strong>{shortNumber(row[metric])}</strong>
    </div>)}
  </div>;
}

export function InsightsView({ active = true }: { active?: boolean }) {
  const t = labels;
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [metric, setMetric] = useState<Metric>('sessions');
  const [board, setBoard] = useState<Board>('agents');

  useLibraryRefresh(() => {
    let live = true;
    invoke<Insights>('get_insights')
      .then(result => { if (live) { setData(current => sameJson(current, result) ? current : result); setError(''); } })
      .catch(reason => { if (live) setError(String(reason)); });
    return () => { live = false; };
  }, [reload], active);

  const calendar = useMemo(() => {
    const counts = new Map(data?.activity ?? []);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - 364);
    const cells: { key: string; count: number; placeholder?: boolean }[] = [];
    for (let i = 0; i < start.getDay(); i++) cells.push({ key: `pad-${i}`, count: 0, placeholder: true });
    for (let i = 0; i < 365; i++) {
      const day = new Date(start); day.setDate(start.getDate() + i);
      const key = dayKey(day); cells.push({ key, count: counts.get(key) ?? 0 });
    }
    return cells;
  }, [data]);

  const byWeekday = useMemo(() => {
    const values = Array(7).fill(0) as number[];
    for (const [date, count] of data?.activity ?? []) values[new Date(`${date}T12:00:00`).getDay()] += count;
    return values;
  }, [data]);

  const byMonth = useMemo(() => {
    const values = Array(12).fill(0) as number[];
    for (const [date, count] of data?.activity ?? []) values[Number(date.slice(5, 7)) - 1] += count;
    return values;
  }, [data]);

  if (!data && !error) return <div className="ronda-panel insights-panel" role="status" aria-label={t.title} aria-busy="true">
    <header className="panel-header"><span className="eyebrow-chip">{t.eyebrow}</span><h1>{t.title}</h1><p>{t.subtitle}</p><PixelStrip cols={48} seed={9} className="panel-strip" /></header>
    <div className="insight-stats">{[0, 1, 2].map(index => <div className="insight-stat panel-skeleton" key={index}><i /><i /></div>)}</div>
    <div className="panel-card panel-skeleton insight-loading"><i /><i /></div>
  </div>;

  return <div className="ronda-panel insights-panel">
    <header className="panel-header"><span className="eyebrow-chip">{t.eyebrow}</span><h1>{t.title}</h1><p>{t.subtitle}</p><PixelStrip cols={48} seed={9} className="panel-strip" /></header>
    {error && <div className="panel-error" role="alert">{error} <button onClick={() => setReload(value => value + 1)}>{t.retry}</button></div>}
    <div className="insight-stats">
      {(['sessions', 'prompts', 'tokens'] as const).map(key => <div className="insight-stat" key={key}>
        <span>{t[key]}</span><strong><AnimatedNumber value={data?.[key] ?? 0} format={shortNumber} duration={0.5} startOnView={false} /></strong>
      </div>)}
    </div>
    {!data?.sessions && !error && <p className="panel-empty">{t.empty}</p>}
    <section className="panel-card">
      <div className="panel-section-head"><h2>{t.activity}</h2><span>{t.lastYear}</span></div>
      <div className="heatmap-scroll"><div className="heatmap" role="img" aria-label={`${t.activity}: ${data?.prompts ?? 0} ${t.prompts}`}>
        {calendar.map(cell => <span key={cell.key} className={`heat-cell ${cell.placeholder ? 'heat-pad' : ''}`}
          data-level={cell.count === 0 ? 0 : cell.count < 2 ? 1 : cell.count < 4 ? 2 : cell.count < 8 ? 3 : 4}
          title={cell.placeholder ? undefined : `${cell.key}: ${cell.count} ${t.prompts}`} />)}
      </div></div>
      <div className="heat-legend"><span>{t.less}</span>{[0, 1, 2, 3, 4].map(n => <i key={n} data-level={n} />)}<span>{t.more}</span></div>
    </section>
    <div className="insight-breakdowns">
      <section className="panel-card"><h2>{t.weekday}</h2><MiniBars values={byWeekday} labels={['Sun','Mon','Tue','Wed','Thu','Fri','Sat']} /></section>
      <section className="panel-card"><h2>{t.month}</h2><MiniBars values={byMonth} labels={Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat('en', { month: 'narrow' }).format(new Date(2026, i, 1)))} /></section>
      {data?.hours && <section className="panel-card"><h2>{t.hour}</h2><MiniBars values={Array.from({ length: 24 }, (_, i) => data.hours?.find(([hour]) => hour === i)?.[1] ?? 0)} labels={Array.from({ length: 24 }, (_, i) => i % 4 === 0 ? String(i) : '')} /></section>}
    </div>
    <section className="panel-card">
      <div className="panel-section-head insight-leader-head"><h2>{t[board]}</h2>
        <Segment label="Leaderboard group" value={board} onChange={setBoard} options={(['agents','projects','models'] as const).map(key => [key, t[key]])} />
      </div>
      <Segment label="Leaderboard metric" className="insight-metric" value={metric} onChange={setMetric} options={(['sessions','prompts','tokens'] as const).map(key => [key, t[key]])} />
      <Bars rows={data?.[board] ?? []} metric={metric} empty={t.noData} />
    </section>
  </div>;
}

function MiniBars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return <div className="mini-bars">{values.map((value, index) => <div className="mini-bar" key={index} title={`${labels[index]}: ${value}`}>
    <div className="mini-bar-track"><motion.div initial={false} animate={{ height: `${value / max * 100}%` }} transition={{ duration: 0.3, ease: EASE_OUT }} /></div><small>{labels[index]}</small>
  </div>)}</div>;
}

function Segment<T extends string>({ label, value, onChange, options, className }: {
  label: string; value: T; onChange: (value: T) => void; options: [T, string][]; className?: string;
}) {
  return <Tabs variant="segment" value={value} onValueChange={next => onChange(next as T)} className={className}>
    <TabsList className="panel-segment" aria-label={label}>
      {options.map(([key, text]) => <TabsTrigger key={key} value={key}
        className={`label-mono h-8 px-3 text-[12px] lowercase ${value === key ? '!text-foreground' : '!text-foreground/50'}`}
        indicatorClassName="glass !bg-paper">{text}</TabsTrigger>)}
    </TabsList>
  </Tabs>;
}
