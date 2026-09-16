import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AppleIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { PixelField } from "@/components/brand/pixel-field";
import { TextReveal } from "@/components/motion/text-reveal";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { groupTone, parseChangelog, releaseDate, releaseTitle } from "./changelog/releases";
import { base, SiteFooter, SiteHeader } from "./Chrome";
import { docs } from "./docs/sections";
import { Inline } from "./Inline";
import { useMacDownloads } from "./release";

const LivePreview = lazy(() => import("./preview/LivePreview"));

const features = [
  { label: "18 agents", title: "Every agent, one library", body: "Claude Code, Codex, Cursor, Gemini CLI and fourteen more, read straight from the session files they already write." },
  { label: "~26 ms p95", title: "Find it in milliseconds", body: "Full-text search across every transcript, from code fragments to prose in any language, landing on the exact message." },
  { label: "terminal", title: "Resume without leaving", body: "Resume opens the agent in a terminal built into Ronda, in the right folder or over SSH. Flip between transcript and terminal while it runs." },
  { label: "intelligence", title: "See how you work", body: "Where the hours go, where agents get stuck, the errors that keep coming back, and how sessions end, plus a year of activity across agents and models." },
  { label: "mcp", title: "Agents that remember", body: "A bundled CLI and read-only MCP server let your agents search past sessions and check whether an error has been seen before." },
  { label: "local", title: "Private by design", body: "A rebuildable SQLite index on your machine. Sessions never go to a server, and agent files are only removed when you move one to Trash." },
];

export function Landing() {
  const downloads = useMacDownloads();
  const reduce = useReducedMotion();
  const rise = (delay: number) => reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, ease: EASE_OUT, delay } };

  return <div className="min-h-full bg-background text-foreground">
    <SiteHeader page="home" />

    <main id="main">
      <section id="top" className="mx-auto grid max-w-[1240px] gap-8 px-4 pt-14 pb-12 sm:px-6 lg:grid-cols-[minmax(0,728px)_minmax(0,451px)] lg:items-end lg:justify-between lg:pt-24">
        <div className="flex flex-col gap-[26px]">
          <motion.a href={`${base}changelog/`} className="eyebrow-chip px-3 pt-1.5 pb-2.5 text-[14px] hover:text-foreground" {...rise(0)}>
            {downloads.version ? `Ronda ${downloads.version} is out` : "Your sessions, stored locally"}
          </motion.a>
          <TextReveal as="h1" text={["All your agent sessions", "in one place."]} stagger={0.025} blur={4} duration={0.3} yOffset="20%"
            spring={{ stiffness: 420, damping: 36, mass: 0.6 }}
            className="font-serif text-[40px] leading-[1.1] tracking-[-0.01em] sm:text-[48px] lg:text-[56px]" />
        </div>
        <motion.div {...rise(0.08)}>
          <p className="text-[18px] leading-normal tracking-[0.025em]">
            Ronda is a desktop library for your coding-agent conversations. Search sessions from 18 agents and resume them in a built-in terminal. Everything is indexed on your machine and never uploaded.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <a href={downloads.appleSilicon} className="flex h-10 items-center gap-2 bg-foreground px-4 font-mono text-[14px] font-medium tracking-[0.025em] text-background transition-opacity hover:opacity-90">
              <HugeiconsIcon icon={AppleIcon} size={16} strokeWidth={1.8} />download for mac
            </a>
            <a href={downloads.intel} className="glass flex h-10 items-center px-3.5 font-mono text-[14px] font-medium tracking-[0.025em] text-foreground/60 hover:text-foreground">intel</a>
            <a href="#preview" className="glass flex h-10 items-center gap-1.5 px-3.5 font-mono text-[14px] font-medium tracking-[0.025em] text-foreground/60 hover:text-foreground">
              try it here<HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </a>
          </div>
          <p className="mt-3 font-mono text-[12px] tracking-[0.025em] text-muted-foreground">
            {downloads.published ? "Apple silicon and Intel · " : "Downloads open the GitHub releases page · "}
            <a href={`${base}docs/#install`} className="underline decoration-stone underline-offset-2 hover:text-foreground">Windows and Linux</a>
          </p>
        </motion.div>
      </section>

      <PreviewBand />

      <section aria-label="Features" className="border-b border-border">
        {/* A 1px gap over the border colour draws the grid lines at every column count. */}
        <div className="mx-auto grid max-w-[1240px] gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map(feature => <div key={feature.title} className="bg-background px-4 py-10 sm:px-6">
            <span className="eyebrow-chip">{feature.label}</span>
            <h2 className="mt-5 font-serif text-[28px] leading-[1.1] tracking-[-0.01em]">{feature.title}</h2>
            <p className="mt-3 text-[16px] leading-normal tracking-[0.02em] text-ink-soft">{feature.body}</p>
          </div>)}
        </div>
      </section>

      <LearnMore />
    </main>

    <SiteFooter />
  </div>;
}

function PreviewBand() {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Load the interface bundle shortly before the band scrolls into view, or once the page is idle.
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setVisible(true); }, { rootMargin: "600px" });
    observer.observe(node);
    const idle = window.requestIdleCallback?.(() => setVisible(true), { timeout: 2500 }) ?? window.setTimeout(() => setVisible(true), 1500);
    return () => { observer.disconnect(); if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle); };
  }, []);

  return <section id="preview" ref={ref} aria-label="Live preview" className="relative scroll-mt-16 overflow-hidden border-y border-border">
    <PixelField cols={60} rows={40} cell={26} seed={7} className="absolute inset-0" />
    <div className="relative mx-auto max-w-[1240px] px-3 pt-12 sm:px-10 sm:pt-20">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="glass bg-paper px-3 pt-1.5 pb-2 font-mono text-[13px] tracking-[0.025em]">live preview · sample data · click anything</span>
      </div>
      <div className="bg-[linear-gradient(90deg,var(--px-base),color-mix(in_oklab,var(--px-olive)_45%,var(--px-light))_45%,var(--px-base))] p-[5px] pb-0 shadow-lift">
        <Suspense fallback={<PreviewPlaceholder />}>
          {visible ? <LivePreview /> : <PreviewPlaceholder />}
        </Suspense>
      </div>
    </div>
  </section>;
}

function PreviewPlaceholder() {
  return <div className="flex aspect-[1180/720] w-full items-center justify-center bg-background">
    <span className="font-mono text-[13px] tracking-[0.025em] text-muted-foreground">loading the interface…</span>
  </div>;
}

function LearnMore() {
  const latest = parseChangelog().find(release => release.groups.length > 0);
  const highlights = latest?.groups.flatMap(group => group.items.map(item => ({ kind: group.kind, item }))).slice(0, 4) ?? [];

  return <section aria-label="Changelog and documentation">
    <div className="mx-auto grid max-w-[1240px] gap-5 px-4 py-20 sm:px-6 lg:grid-cols-2">
      <div className="raised flex flex-col p-6 sm:p-8">
        <span className="eyebrow-chip self-start">changelog</span>
        <h2 className="mt-[26px] font-serif text-[40px] leading-[1.1] tracking-[-0.01em]">What's new</h2>
        {latest && <p className="mt-2 font-mono text-[13px] tracking-[0.025em] text-muted-foreground">{[releaseTitle(latest).toLowerCase(), releaseDate(latest)].filter(Boolean).join(" · ")}</p>}
        <ul className="mt-6 grid gap-3">
          {highlights.map(({ kind, item }) => <li key={item} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-3 text-[16px] leading-normal tracking-[0.015em] text-ink-soft">
            <span className={cn("px-2 pt-0.5 pb-1 font-mono text-[11px] font-medium tracking-[0.025em] lowercase", groupTone[kind] ?? "bg-chip")}>{kind}</span>
            <span><Inline>{item}</Inline></span>
          </li>)}
        </ul>
        <MoreLink href={`${base}changelog/`}>read the changelog</MoreLink>
      </div>
      <div className="raised flex flex-col p-6 sm:p-8">
        <span className="eyebrow-chip self-start">docs</span>
        <h2 className="mt-[26px] font-serif text-[40px] leading-[1.1] tracking-[-0.01em]">Documentation</h2>
        <p className="mt-2 text-[16px] leading-normal tracking-[0.02em] text-ink-soft">Install, search, intelligence, resuming sessions, the CLI and MCP server, remote hosts, and how your data is handled.</p>
        <ul className="mt-6 grid gap-x-4 sm:grid-cols-2">
          {docs.map(doc => <li key={doc.id}>
            <a href={`${base}docs/#${doc.id}`} className="flex items-center justify-between gap-2 border-t border-border py-2.5 font-mono text-[13px] tracking-[0.025em] lowercase text-foreground/60 transition-colors hover:text-foreground">
              {doc.title}<HugeiconsIcon icon={ArrowRight01Icon} size={13} />
            </a>
          </li>)}
        </ul>
        <MoreLink href={`${base}docs/`}>open the docs</MoreLink>
      </div>
    </div>
  </section>;
}

function MoreLink({ href, children }: { href: string; children: string }) {
  return <div className="mt-auto pt-7">
    <a href={href} className="glass inline-flex h-10 items-center gap-1.5 px-3.5 font-mono text-[14px] font-medium tracking-[0.025em] text-foreground/60 hover:text-foreground">
      {children}<HugeiconsIcon icon={ArrowRight01Icon} size={14} />
    </a>
  </div>;
}
