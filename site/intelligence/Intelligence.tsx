import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AppleIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { PixelField } from "@/components/brand/pixel-field";
import { TextReveal } from "@/components/motion/text-reveal";
import { base, SiteFooter, SiteHeader } from "../Chrome";
import { REPO_URL, useMacDownloads } from "../release";

const LiveReport = lazy(() => import("./LiveReport"));

const IDEA_URL = `${REPO_URL}/issues/new?title=${encodeURIComponent("Session intelligence: ")}`;

const questions = [
  { title: "Where did the time go?", body: "Active time split into features, bug fixes, refactoring, tests, setup, and exploring, plus the time spent recovering from failing commands. Breaks longer than 15 minutes don't count." },
  { title: "Where do agents get stuck?", body: "Edit loops, context that filled up and was compacted, tests still failing at the end, denied tool calls, and calls to APIs that don't exist." },
  { title: "Which errors keep coming back?", body: "Error lines are normalized so the same bug matches across sessions, agents, and projects, and flagged when it returns after a session that committed a fix." },
  { title: "What is my real stack?", body: "Languages, frameworks, and tools read from the files your agents edit and the commands they run, with anything new in the period marked." },
  { title: "How do sessions end?", body: "Committed, edited but not committed, ended failing, or no file changes, with the time each outcome took." },
  { title: "Where's the proof?", body: "Failures and recurring errors link to the sessions behind them. Click one to open the transcript at the message where it happened." },
];

const steps = [
  { label: "01", title: "Worked out while indexing", body: "Ronda derives facts from each transcript as it indexes it: tool calls, errors, edited files, commands, and outcomes. Reports read those facts, so they stay fast on large libraries." },
  { label: "02", title: "Deterministic and local", body: "Rules, not a language model. Nothing leaves your machine, and the same sessions always give the same report. Agents that don't record tool calls count toward time and sessions only, and the view says which ones." },
  { label: "03", title: "Ask from any agent", body: "`ronda-mcp` exposes `ronda_insights` and `ronda_find_error`, so an agent can check whether an error has been seen before it starts fixing it again. `ronda-cli insights` and `ronda-cli errors` do the same from a shell." },
];

export function Intelligence() {
  const downloads = useMacDownloads();

  return <div className="min-h-full bg-background text-foreground">
    <SiteHeader page="intelligence" />

    <main id="main">
      <section id="top" className="mx-auto grid max-w-[1240px] gap-8 px-4 pt-14 pb-12 sm:px-6 lg:grid-cols-[minmax(0,728px)_minmax(0,451px)] lg:items-end lg:justify-between lg:pt-24">
        <div className="flex flex-col gap-[26px]">
          <span className="eyebrow-chip flex items-center gap-2 px-3 pt-1.5 pb-2.5 text-[14px]">
            <span className="size-2 bg-olive" aria-hidden="true" />session intelligence · in ronda now
          </span>
          <TextReveal as="h1" text={["See where your", "time goes."]} stagger={0.025} blur={4} duration={0.3} yOffset="20%"
            spring={{ stiffness: 420, damping: 36, mass: 0.6 }}
            className="font-serif text-[40px] leading-[1.1] tracking-[-0.01em] sm:text-[48px] lg:text-[56px]" />
        </div>
        <div>
          <p className="text-[18px] leading-normal tracking-[0.025em]">
            Ronda keeps every session from your coding agents, and learns from them on your machine: where the hours go, where agents get stuck, the errors that keep coming back, and the stack you actually build with.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <a href={downloads.appleSilicon} className="flex h-10 items-center gap-2 bg-foreground px-4 font-mono text-[14px] font-medium tracking-[0.025em] text-background transition-opacity hover:opacity-90">
              <HugeiconsIcon icon={AppleIcon} size={16} strokeWidth={1.8} />download for mac
            </a>
            <a href="#report" className="glass flex h-10 items-center gap-1.5 px-3.5 font-mono text-[14px] font-medium tracking-[0.025em] text-foreground/60 hover:text-foreground">
              try the report<HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </a>
          </div>
          <p className="mt-3 font-mono text-[12px] tracking-[0.025em] text-muted-foreground">
            Open <b className="font-medium text-foreground">Intelligence</b> in the top bar, or press ⌘3 ·{" "}
            <a href={`${base}docs/#intelligence`} className="underline decoration-stone underline-offset-2 hover:text-foreground">read the docs</a>
          </p>
        </div>
      </section>

      <ReportBand />

      <section aria-labelledby="questions" className="border-b border-border">
        <div className="mx-auto max-w-[1240px] px-4 py-20 sm:px-6">
          <span className="eyebrow-chip">questions</span>
          <h2 id="questions" className="mt-[26px] max-w-[720px] font-serif text-[40px] leading-[1.1] tracking-[-0.01em]">Answers your session history already holds.</h2>
          <div className="mt-10 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {questions.map(question => <div key={question.title} className="bg-background p-6 sm:p-8">
              <h3 className="font-serif text-[26px] leading-[1.15] tracking-[-0.01em]">{question.title}</h3>
              <p className="mt-3 text-[16px] leading-normal tracking-[0.02em] text-ink-soft">{question.body}</p>
            </div>)}
          </div>
        </div>
      </section>

      <section aria-labelledby="how" className="border-b border-border">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-16">
          <div>
            <span className="eyebrow-chip">how it works</span>
            <h2 id="how" className="mt-[26px] font-serif text-[40px] leading-[1.1] tracking-[-0.01em]">Same rules as the rest of Ronda.</h2>
            <p className="mt-4 text-[17px] leading-normal tracking-[0.02em] text-ink-soft">Filter any report to the last 7 days, 30 days, or all time, and to a single project.</p>
          </div>
          <ol className="grid gap-5">
            {steps.map(step => <li key={step.label} className="raised grid gap-4 p-6 sm:grid-cols-[56px_minmax(0,1fr)] sm:p-8">
              <span className="font-mono text-[13px] tracking-[0.025em] text-muted-foreground">{step.label}</span>
              <div>
                <h3 className="font-serif text-[28px] leading-[1.1] tracking-[-0.01em]">{step.title}</h3>
                <p className="mt-3 text-[16px] leading-normal tracking-[0.02em] text-ink-soft"><Code>{step.body}</Code></p>
              </div>
            </li>)}
          </ol>
        </div>
      </section>

      <section aria-labelledby="follow">
        <div className="mx-auto max-w-[1240px] px-4 py-20 sm:px-6">
          <div className="raised flex flex-col gap-6 p-6 sm:p-10 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-[640px]">
              <h2 id="follow" className="font-serif text-[40px] leading-[1.1] tracking-[-0.01em]">What should it notice next?</h2>
              <p className="mt-3 text-[17px] leading-normal tracking-[0.02em] text-ink-soft">Tell us which patterns would save you the most time, or where a report got your sessions wrong.</p>
            </div>
            <div className="flex flex-none flex-wrap gap-2">
              <a href={IDEA_URL} className="flex h-10 items-center gap-2 bg-foreground px-4 font-mono text-[14px] font-medium tracking-[0.025em] text-background transition-opacity hover:opacity-90">share an idea</a>
              <a href={base} className="glass flex h-10 items-center gap-1.5 px-3.5 font-mono text-[14px] font-medium tracking-[0.025em] text-foreground/60 hover:text-foreground">
                get ronda<HugeiconsIcon icon={ArrowRight01Icon} size={14} />
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>

    <SiteFooter />
  </div>;
}

/** Renders `code` spans in step copy. */
function Code({ children }: { children: string }) {
  return <>{children.split(/(`[^`]+`)/).map((part, index) => part.startsWith("`")
    ? <code key={index} className="bg-chip px-1.5 pt-0.5 pb-1 font-mono text-[13px] text-foreground">{part.slice(1, -1)}</code>
    : part)}</>;
}

function ReportBand() {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Load the app bundle shortly before the band scrolls into view, or once the page is idle.
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setVisible(true); }, { rootMargin: "600px" });
    observer.observe(node);
    const idle = window.requestIdleCallback?.(() => setVisible(true), { timeout: 2500 }) ?? window.setTimeout(() => setVisible(true), 1500);
    return () => { observer.disconnect(); if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle); };
  }, []);

  return <section id="report" ref={ref} aria-label="Sample report" className="relative scroll-mt-16 overflow-hidden border-y border-border">
    <PixelField cols={60} rows={80} cell={26} seed={11} className="absolute inset-0" />
    <div className="relative mx-auto max-w-[1240px] px-3 py-12 sm:px-10 sm:py-20">
      <span className="glass mb-4 inline-block bg-paper px-3 pt-1.5 pb-2 font-mono text-[13px] tracking-[0.025em]">the real view · sample data · change the range and project</span>
      <div className="shadow-lift">
        <Suspense fallback={<ReportPlaceholder />}>
          {visible ? <LiveReport /> : <ReportPlaceholder />}
        </Suspense>
      </div>
    </div>
  </section>;
}

function ReportPlaceholder() {
  return <div className="flex h-[720px] w-full items-center justify-center bg-background">
    <span className="font-mono text-[13px] tracking-[0.025em] text-muted-foreground">loading the report…</span>
  </div>;
}
