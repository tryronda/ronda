import { invoke } from '@/lib/tauri';
import { sameJson, useLibraryRefresh } from '@/lib/hooks/use-library-refresh';
import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { AnimatedNumber } from '@/components/motion/animated-number';
import { Tabs, TabsList, TabsTrigger } from '@/components/motion/tabs';
import { PixelStrip } from '@/components/brand/pixel-field';
import { EASE_OUT } from '@/lib/ease';
import './panels.css';

type Evidence = { session_key: string; seq: number; title: string };
export type Intelligence = {
  since: number | null;
  project: string | null;
  totals: { sessions: number; active_ms: number; recovery_ms: number; tool_calls: number; tool_errors: number; failed_sessions: number; recurring_bugs: number };
  time: { category: string; label: string; sessions: number; active_ms: number }[];
  failures: { pattern: string; label: string; sessions: number; evidence: Evidence[] }[];
  recurring: { signature: string; message: string; sessions: number; agents: string[]; projects: string[]; first_seen: number; last_seen: number; came_back: boolean; evidence: Evidence[] }[];
  stack: { tech: string; sessions: number; share: number; new: boolean }[];
  outcomes: { outcome: string; label: string; sessions: number; active_ms: number }[];
  coverage: { agent: string; sessions: number; with_tools: number; with_time: number }[];
  callouts: string[];
};
type Range = 'week' | 'month' | 'all';

const DAY = 86_400_000;
const ranges: Record<Range, number | null> = { week: 7 * DAY, month: 30 * DAY, all: null };

const labels = {
  eyebrow: 'Intelligence', title: 'Where your time goes',
  subtitle: 'Worked out on this machine from your sessions: time, failures, errors that come back, and your stack.',
  week: '7 days', month: '30 days', all: 'All time', allProjects: 'All projects', project: 'Project', range: 'Range',
  activeTime: 'Active time', sessions: 'Sessions', endedFailing: 'Ended failing', recurring: 'Recurring errors',
  time: 'Where your time goes', recovering: 'Recovering from failing commands', failures: 'Agent failures',
  bugs: 'Errors that keep coming back', stack: 'Your stack', outcomes: 'How sessions end', notes: 'Worth knowing',
  shareOfSessions: 'share of sessions with tool calls', cameBack: 'came back after a committed fix', open: 'Open',
  sessionsCount: (n: number) => `${n} ${n === 1 ? 'session' : 'sessions'}`, newTech: 'new',
  none: 'Nothing in this range.', empty: 'No sessions in this range yet.', retry: 'Retry',
  noTools: (agents: string) => `No tool data from ${agents}, so failures, errors, stack, and outcomes leave them out.`,
  lastSeen: 'last seen',
} as const;

const tone: Record<string, string> = {
  features: 'var(--sky)', bugs: 'var(--olive)', recovering: 'var(--ember)', refactoring: 'var(--sun)',
  tests: 'var(--bark)', setup: 'var(--stone)', exploring: 'color-mix(in oklab, var(--sky) 45%, var(--paper))',
  committed: 'var(--olive)', uncommitted: 'var(--sun)', failed: 'var(--ember)', no_changes: 'var(--chip)',
};

export function hours(ms: number) {
  const h = ms / 3_600_000;
  if (h >= 10) return `${Math.round(h)} h`;
  if (h >= 1) return `${h.toFixed(1)} h`;
  return `${ms > 0 ? Math.max(1, Math.round(ms / 60_000)) : 0} min`;
}

const day = (ms: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(ms));

export function IntelligenceView({ onOpen, active = true }: { onOpen?: (key: string, seq: number) => void; active?: boolean }) {
  const t = labels;
  const reduce = useReducedMotion();
  const [range, setRange] = useState<Range>('month');
  const [project, setProject] = useState<string>('');
  const [projects, setProjects] = useState<string[]>([]);
  const [data, setData] = useState<Intelligence | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useLibraryRefresh(() => {
    let live = true;
    const span = ranges[range];
    invoke<Intelligence>('get_intelligence', { since: span === null ? null : Date.now() - span, project: project || null })
      .then(result => { if (live) { setData(current => sameJson(current, result) ? current : result); setError(''); } })
      .catch(reason => { if (live) setError(String(reason)); });
    invoke<{ path: string }[]>('list_projects')
      .then(list => { if (live) setProjects(current => { const next = list.map(p => p.path); return sameJson(current, next) ? current : next; }); })
      .catch(() => {});
    return () => { live = false; };
  }, [range, project, reload], active);

  const time = useMemo(() => {
    if (!data) return [];
    const rows = data.time.map(row => ({ key: row.category, label: row.label, ms: row.active_ms, sessions: row.sessions }));
    if (data.totals.recovery_ms > 0) rows.push({ key: 'recovering', label: t.recovering, ms: data.totals.recovery_ms, sessions: 0 });
    return rows.filter(row => row.ms > 0).sort((a, b) => b.ms - a.ms);
  }, [data, t.recovering]);
  const totalTime = time.reduce((sum, row) => sum + row.ms, 0);
  const failingShare = data?.totals.sessions ? Math.round(data.totals.failed_sessions / data.totals.sessions * 100) : 0;
  const blind = data?.coverage.filter(c => c.with_tools === 0).map(c => c.agent) ?? [];
  const grow = (percent: number, delay = 0) => ({
    initial: reduce ? false : { width: 0 }, animate: { width: `${percent}%` }, transition: { duration: 0.4, ease: EASE_OUT, delay },
  } as const);
  const open = (e: Evidence) => onOpen?.(e.session_key, e.seq);

  const header = <header className="panel-header">
    <span className="eyebrow-chip">{t.eyebrow}</span><h1>{t.title}</h1><p>{t.subtitle}</p>
    <PixelStrip cols={48} seed={17} className="panel-strip" />
  </header>;
  const controls = <div className="intel-controls">
    <Tabs variant="segment" value={range} onValueChange={next => setRange(next as Range)}>
      <TabsList className="panel-segment" aria-label={t.range}>
        {(['week', 'month', 'all'] as const).map(key => <TabsTrigger key={key} value={key}
          className={`label-mono h-8 px-3 text-[12px] lowercase ${range === key ? '!text-foreground' : '!text-foreground/50'}`}
          indicatorClassName="glass !bg-paper">{t[key]}</TabsTrigger>)}
      </TabsList>
    </Tabs>
    <select className="intel-project" aria-label={t.project} value={project} onChange={event => setProject(event.target.value)}>
      <option value="">{t.allProjects}</option>
      {projects.map(path => <option key={path} value={path}>{path.split(/[\\/]/).filter(Boolean).pop() ?? path}</option>)}
    </select>
  </div>;

  if (!data && !error) return <div className="ronda-panel insights-panel" role="status" aria-label={t.eyebrow} aria-busy="true">
    {header}{controls}
    <div className="insight-stats intel-stats">{[0, 1, 2, 3].map(index => <div className="insight-stat panel-skeleton" key={index}><i /><i /></div>)}</div>
    <div className="panel-card panel-skeleton insight-loading"><i /><i /></div>
  </div>;

  const stats: [string, number, (n: number) => string][] = [
    [t.activeTime, data?.totals.active_ms ?? 0, hours],
    [t.sessions, data?.totals.sessions ?? 0, n => Math.round(n).toLocaleString()],
    [t.endedFailing, failingShare, n => `${Math.round(n)}%`],
    [t.recurring, data?.totals.recurring_bugs ?? 0, n => Math.round(n).toLocaleString()],
  ];
  const maxFailure = Math.max(1, ...(data?.failures.map(f => f.sessions) ?? []));
  const outcomeTotal = Math.max(1, data?.outcomes.reduce((sum, o) => sum + o.sessions, 0) ?? 0);

  return <div className="ronda-panel insights-panel intel-panel">
    {header}{controls}
    {error && <div className="panel-error" role="alert">{error} <button onClick={() => setReload(value => value + 1)}>{t.retry}</button></div>}
    <div className="insight-stats intel-stats">
      {stats.map(([label, value, format]) => <div className="insight-stat" key={label}>
        <span>{label}</span><strong><AnimatedNumber value={value} format={format} duration={0.5} startOnView={false} /></strong>
      </div>)}
    </div>
    {data && !data.totals.sessions && <p className="panel-empty">{t.empty}</p>}
    {blind.length > 0 && <div className="panel-notice">{t.noTools(blind.join(', '))}</div>}

    {data && data.totals.sessions > 0 && <>
      <section className="panel-card">
        <div className="panel-section-head"><h2>{t.time}</h2><span>{hours(totalTime)}</span></div>
        {time.length ? <>
          <div className="intel-split" role="img" aria-label={time.map(row => `${row.label} ${hours(row.ms)}`).join(', ')}>
            {time.map((row, index) => <motion.div key={row.key} style={{ background: tone[row.key] }} {...grow(row.ms / totalTime * 100, index * 0.03)} />)}
          </div>
          <ul className="intel-legend">
            {time.map(row => <li key={row.key}><i style={{ background: tone[row.key] }} /><span>{row.label}</span><strong>{hours(row.ms)}</strong></li>)}
          </ul>
        </> : <p className="panel-empty">{t.none}</p>}
      </section>

      {data.callouts.length > 0 && <section className="panel-card intel-notes">
        <h2>{t.notes}</h2>
        <ul>{data.callouts.map(note => <li key={note}>{note}</li>)}</ul>
      </section>}

      <div className="intel-columns">
        <section className="panel-card">
          <div className="panel-section-head"><h2>{t.failures}</h2><span>{t.sessionsCount(data.failures.reduce((sum, f) => sum + f.sessions, 0))}</span></div>
          {data.failures.length ? <ul className="intel-failures">
            {data.failures.map((row, index) => <li key={row.pattern}>
              <div className="intel-row-head"><span>{row.label}</span><strong>{row.sessions}</strong></div>
              <div className="insight-bar-track intel-failure-track"><motion.div {...grow(row.sessions / maxFailure * 100, index * 0.04)} /></div>
              <div className="intel-evidence">{row.evidence.slice(0, 3).map(e => <button key={`${e.session_key}#${e.seq}`} type="button"
                title={e.title} onClick={() => open(e)}>{e.title || e.session_key}</button>)}</div>
            </li>)}
          </ul> : <p className="panel-empty">{t.none}</p>}
        </section>

        <section className="panel-card">
          <div className="panel-section-head"><h2>{t.bugs}</h2><span>{data.totals.recurring_bugs}</span></div>
          {data.recurring.length ? <ul className="intel-bugs">
            {data.recurring.slice(0, 8).map(bug => <li key={bug.signature}>
              <button type="button" className="intel-bug" onClick={() => bug.evidence[0] && open(bug.evidence[0])} title={t.open}>
                <code>{bug.message}</code>
                <span className="intel-chips">
                  <b className="intel-chip-warm">{t.sessionsCount(bug.sessions)}</b>
                  {bug.agents.map(agent => <b key={agent}>{agent}</b>)}
                  <small>{t.lastSeen} {day(bug.last_seen)}</small>
                  {bug.came_back && <small className="intel-came-back">{t.cameBack}</small>}
                </span>
              </button>
            </li>)}
          </ul> : <p className="panel-empty">{t.none}</p>}
        </section>
      </div>

      <div className="intel-columns">
        <section className="panel-card">
          <div className="panel-section-head"><h2>{t.stack}</h2><span>{t.shareOfSessions}</span></div>
          {data.stack.length ? <div className="insight-bars">
            {data.stack.slice(0, 10).map((row, index) => <div className="insight-bar" key={row.tech}>
              <span className="insight-bar-label" title={row.tech}>{row.tech}{row.new && <em className="intel-new">{t.newTech}</em>}</span>
              <div className="insight-bar-track"><motion.div {...grow(Math.max(2, row.share), index * 0.03)} /></div>
              <strong>{row.share}%</strong>
            </div>)}
          </div> : <p className="panel-empty">{t.none}</p>}
        </section>

        <section className="panel-card">
          <div className="panel-section-head"><h2>{t.outcomes}</h2><span>{t.sessionsCount(outcomeTotal)}</span></div>
          <ul className="intel-outcomes">
            {data.outcomes.map((row, index) => <li key={row.outcome}>
              <strong>{Math.round(row.sessions / outcomeTotal * 100)}%</strong>
              <div className="intel-outcome-track"><motion.div style={{ background: tone[row.outcome] }} {...grow(row.sessions / outcomeTotal * 100, index * 0.05)} /></div>
              <span>{row.label}</span><small>{t.sessionsCount(row.sessions)} · {hours(row.active_ms)}</small>
            </li>)}
          </ul>
        </section>
      </div>
    </>}
  </div>;
}
