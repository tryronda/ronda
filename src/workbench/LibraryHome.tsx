import { motion, useReducedMotion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Folder01Icon, ReloadIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Button } from "@/components/motion/button/base";
import { TextReveal } from "@/components/motion/text-reveal";
import { PixelField } from "@/components/brand/pixel-field";
import { EASE_OUT } from "@/lib/ease";
import type { AgentId, SessionMeta } from "./api";

const copy = {
  eyebrow: "Local · Private · 18 agents",
  headline: ["All your agent sessions", "in one place."],
  lede: "Browse, search, and resume conversations from Claude Code, Codex, Cursor and fifteen more agents. Indexed on your machine, never uploaded.",
  search: "Search sessions", refresh: "Refresh library", sessions: "sessions", projects: "projects", agents: "agents",
  continue: "Pick up where you left off", empty: "Your sessions will appear here once an agent has been used on this machine.",
};

export function LibraryHome({ sessions, projectCount, agentNames, shortcut, scanning, onOpen, onSearch, onRefresh, titleOf, projectOf, timeOf }: {
  sessions: SessionMeta[]; projectCount: number; agentNames: Record<AgentId, string>;
  shortcut: string; scanning: boolean; onOpen: (session: SessionMeta) => void; onSearch: () => void; onRefresh: () => void;
  titleOf: (session: SessionMeta) => string; projectOf: (session: SessionMeta) => string; timeOf: (ms: number) => string;
}) {
  const t = copy;
  const reduce = useReducedMotion();
  const agentCount = new Set(sessions.map(session => session.agent)).size;
  const recent = sessions.slice(0, 4);
  const rise = (delay: number) => reduce ? {} : {
    initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: EASE_OUT, delay },
  };

  return <div className="library-home @container min-h-0 flex-1 overflow-y-auto">
    <section className="grid gap-x-10 gap-y-8 px-10 pt-14 pb-12 @max-[640px]:px-7 @[900px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] @[900px]:items-end">
      <div className="min-w-0">
        <motion.span className="eyebrow-chip px-3 pt-1.5 pb-2.5 text-[14px]" {...rise(0)}>{t.eyebrow}</motion.span>
        <TextReveal as="h1" text={t.headline} stagger={0.025} blur={4} duration={0.3} yOffset="20%" spring={{ stiffness: 420, damping: 36, mass: 0.6 }}
          className="mt-[26px] font-serif text-[clamp(40px,4.4vw,56px)] leading-[1.1] tracking-[-0.01em] text-foreground" />
      </div>
      <motion.div className="min-w-0 max-w-[451px]" {...rise(0.06)}>
        <p className="text-[18px] leading-normal tracking-[0.025em] text-foreground">{t.lede}</p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onSearch} className="label-mono h-9 gap-2 rounded-none px-3.5 text-[13px] lowercase">
            <HugeiconsIcon icon={Search01Icon} size={14} strokeWidth={2} />{t.search}
            <kbd className="bg-primary-foreground/15 px-1.5 text-[10px] normal-case">{shortcut}K</kbd>
          </Button>
          <Button size="sm" variant="secondary" onClick={onRefresh} disabled={scanning}
            className="glass label-mono h-9 gap-2 rounded-none border-0 px-3.5 text-[13px] lowercase">
            <HugeiconsIcon icon={ReloadIcon} size={14} strokeWidth={2} className={scanning ? "animate-spin" : undefined} />{t.refresh}
          </Button>
        </div>
      </motion.div>
    </section>

    <motion.dl className="label-mono flex flex-wrap gap-x-8 gap-y-2 border-y border-border px-10 py-3.5 text-[13px] text-muted-foreground @max-[640px]:px-7" {...rise(0.1)}>
      {([[sessions.length, t.sessions], [projectCount, t.projects], [agentCount, t.agents]] as const).map(([value, label]) =>
        <div key={label} className="flex items-baseline gap-1.5">
          <dt className="sr-only">{label}</dt>
          <dd className="m-0 text-[14px] text-foreground"><AnimatedNumber value={value} duration={0.45} startOnView={false} /></dd>
          <span>{label}</span>
        </div>)}
    </motion.dl>

    <PixelField cols={36} rows={18} cell={26} seed={7} className="h-[468px]">
      <motion.div className="absolute inset-x-[7%] top-[64px] bottom-0 bg-[linear-gradient(90deg,var(--px-base),color-mix(in_oklab,var(--px-olive)_45%,var(--px-light))_45%,var(--px-base))] p-[5px] pb-0 shadow-lift"
        {...(reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, ease: EASE_OUT, delay: 0.08 } })}>
        <div className="@container h-full bg-paper px-7 pt-8 pb-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="m-0 font-serif text-[30px] leading-[1.1] tracking-[-0.01em]">{t.continue}</h2>
          </div>
          {recent.length ? <div className="mt-5 grid grid-cols-1 gap-2.5 @[520px]:grid-cols-2">
            {recent.map((session, index) => <motion.button key={session.key} type="button" onClick={() => onOpen(session)}
              className="raised group flex min-w-0 flex-col gap-2 p-4 text-left transition-shadow hover:shadow-[0_2px_10px_#0000001f,0_0_0_1px_#0000001a]"
              {...(reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, ease: EASE_OUT, delay: 0.12 + index * 0.03 } })}
              whileHover={reduce ? undefined : { y: -2 }}>
              <span className="label-mono flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className={`agent-dot agent-${session.agent}`} />{agentNames[session.agent]}
                <time className="ml-auto normal-case">{timeOf(session.updated_at)}</time>
              </span>
              <strong className="line-clamp-2 text-[16px] leading-snug font-normal tracking-[0.015em] text-foreground">{titleOf(session)}</strong>
              <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <HugeiconsIcon icon={Folder01Icon} size={12} /><span className="truncate">{projectOf(session)}</span>
                <HugeiconsIcon icon={ArrowRight01Icon} size={13} className="ml-auto opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
            </motion.button>)}
          </div> : <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-muted-foreground">{t.empty}</p>}
        </div>
      </motion.div>
    </PixelField>
  </div>;
}
