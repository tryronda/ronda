import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { PageIntro, SiteFooter, SiteHeader } from "../Chrome";
import { Inline } from "../Inline";
import { REPO_URL } from "../release";
import { groupTone, parseChangelog, releaseAnchor, releaseDate, releaseTitle } from "./releases";

export function Changelog() {
  const releases = parseChangelog();
  return <div className="min-h-full bg-background text-foreground">
    <SiteHeader page="changelog" />
    <main id="main" className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,1fr)] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-16 lg:py-20">
      <PageIntro eyebrow="changelog" title="What's new">
        <p className="mt-4 text-[17px] leading-normal tracking-[0.02em] text-ink-soft">Every change to Ronda, newest first.</p>
        <nav aria-label="Releases" className="mt-6 flex gap-1 overflow-x-auto pb-1 lg:grid lg:overflow-visible">
          {releases.map(release => <a key={release.version} href={`#${releaseAnchor(release)}`}
            className="flex flex-none items-baseline justify-between gap-4 px-3 py-2 font-mono text-[13px] tracking-[0.025em] text-foreground/60 transition-colors hover:text-foreground">
            <span>{releaseTitle(release).toLowerCase()}</span>
            {releaseDate(release) && <span className="hidden text-muted-foreground lg:inline">{releaseDate(release)}</span>}
          </a>)}
        </nav>
        <a href={`${REPO_URL}/blob/main/CHANGELOG.md`} className="mt-5 inline-flex items-center gap-1.5 font-mono text-[13px] tracking-[0.025em] text-foreground/60 underline decoration-stone underline-offset-2 hover:text-foreground">
          CHANGELOG.md<HugeiconsIcon icon={ArrowRight01Icon} size={13} /></a>
      </PageIntro>
      <ol className="grid content-start gap-5">
        {releases.map(release => <li key={release.version} id={releaseAnchor(release)} className="raised scroll-mt-24 p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-serif text-[32px] leading-[1.1] tracking-[-0.01em]">
              <a href={`#${releaseAnchor(release)}`} className="hover:underline hover:decoration-stone hover:underline-offset-4">{releaseTitle(release)}</a>
            </h2>
            {releaseDate(release) && <span className="eyebrow-chip">{releaseDate(release)}</span>}
          </div>
          {release.groups.map(group => <div key={group.kind} className="mt-6">
            <h3 className={cn("inline-block px-2 pt-0.5 pb-1 font-mono text-[12px] font-medium tracking-[0.025em] lowercase", groupTone[group.kind] ?? "bg-chip")}>{group.kind}</h3>
            <ul className="mt-3 grid gap-2.5">
              {group.items.map(item => <li key={item} className="grid grid-cols-[12px_minmax(0,1fr)] gap-3 text-[16px] leading-normal tracking-[0.015em] text-ink-soft">
                <span className="mt-[9px] size-1.5 bg-foreground/30" aria-hidden="true" /><span><Inline>{item}</Inline></span>
              </li>)}
            </ul>
          </div>)}
        </li>)}
      </ol>
    </main>
    <SiteFooter />
  </div>;
}
