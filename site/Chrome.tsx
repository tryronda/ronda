import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { HugeiconsIcon } from "@hugeicons/react";
import { AppleIcon, GithubIcon } from "@hugeicons/core-free-icons";
import { PixelStrip, RondaLockup, RondaMark } from "@/components/brand/pixel-field";
import { ThemeSlider } from "@/components/brand/theme-slider";
import { applyTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { REPO_URL, useMacDownloads } from "./release";

export const base = import.meta.env.BASE_URL;

export type SitePage = "home" | "changelog" | "docs" | "brand" | "intelligence";

/** Applies the theme and hydrates prerendered markup, or renders fresh on the dev server. */
export function mount(app: ReactNode) {
  applyTheme(null); // light by default, like the app
  const root = document.getElementById("root")!;
  if (root.hasChildNodes()) hydrateRoot(root, app);
  else createRoot(root).render(app);
}

function NavLink({ href, current, children }: { href: string; current?: boolean; children: string }) {
  return <a href={href} aria-current={current ? "page" : undefined}
    className={cn("glass hidden h-9 items-center px-3 font-mono text-[14px] font-medium tracking-[0.025em] transition-colors hover:text-foreground md:flex",
      current ? "bg-paper text-foreground" : "text-foreground/50")}>{children}</a>;
}

export function SiteHeader({ page }: { page: SitePage }) {
  const downloads = useMacDownloads();
  return <>
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:z-50 focus:bg-foreground focus:px-4 focus:py-2 focus:font-mono focus:text-background">Skip to content</a>
    <header className="sticky top-0 z-40 border-b border-border bg-[var(--glass-bg)] backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-4 sm:px-6" aria-label="Site">
        <a href={page === "home" ? "#top" : base} className="flex h-9 items-center gap-2 text-foreground transition-opacity hover:opacity-70" aria-label="Ronda home">
          <RondaLockup className="text-[21px]" />
        </a>
        <div className="ml-auto flex items-center gap-2">
          <NavLink href={page === "home" ? "#preview" : `${base}#preview`}>preview</NavLink>
          <NavLink href={`${base}intelligence/`} current={page === "intelligence"}>intelligence</NavLink>
          <NavLink href={`${base}changelog/`} current={page === "changelog"}>changelog</NavLink>
          <NavLink href={`${base}docs/`} current={page === "docs"}>docs</NavLink>
          <a href={REPO_URL} className="glass flex h-9 items-center gap-2 px-3 font-mono text-[14px] font-medium tracking-[0.025em] text-foreground/50 transition-colors hover:text-foreground" aria-label="Ronda on GitHub">
            <HugeiconsIcon icon={GithubIcon} size={16} strokeWidth={1.8} /><span className="hidden lg:inline">github</span>
          </a>
          <ThemeSlider className="hidden h-9 sm:flex" />
          <a href={downloads.appleSilicon} className="flex h-9 items-center gap-2 bg-foreground px-3.5 font-mono text-[14px] font-medium tracking-[0.025em] text-background transition-opacity hover:opacity-90">
            <HugeiconsIcon icon={AppleIcon} size={16} strokeWidth={1.8} /><span>download</span>
          </a>
        </div>
      </nav>
    </header>
  </>;
}

export function SiteFooter() {
  return <footer className="border-t border-border">
    <PixelStrip cols={96} seed={12} className="h-2" />
    <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-8 font-mono text-[13px] tracking-[0.025em] text-muted-foreground sm:px-6">
      <span className="flex items-center gap-2 text-foreground"><RondaMark />Ronda</span>
      <a href={REPO_URL} className="hover:text-foreground">github</a>
      <a href={`${base}intelligence/`} className="hover:text-foreground">intelligence</a>
      <a href={`${base}changelog/`} className="hover:text-foreground">changelog</a>
      <a href={`${base}docs/`} className="hover:text-foreground">docs</a>
      <a href={`${base}brand/`} className="hover:text-foreground">brand</a>
      <a href={`${REPO_URL}/releases`} className="hover:text-foreground">releases</a>
      <a href={`${REPO_URL}/issues`} className="hover:text-foreground">issues</a>
      <ThemeSlider className="ml-auto sm:hidden" />
    </div>
  </footer>;
}

/** Intro column shared by the changelog and docs pages; sticks beside the content on wide screens. */
export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <div className="lg:sticky lg:top-28 lg:self-start">
    <span className="eyebrow-chip">{eyebrow}</span>
    <h1 className="mt-[26px] font-serif text-[40px] leading-[1.1] tracking-[-0.01em] lg:text-[48px]">{title}</h1>
    {children}
  </div>;
}

/** In-page section list for the intro column: a row that scrolls on narrow screens, a list on wide ones, with a glass marker on the section in view. */
export function SectionNav({ label, sections }: { label: string; sections: readonly { id: string; title: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const top = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActive(top.target.id);
    }, { rootMargin: "-20% 0px -70% 0px" });
    sections.forEach(section => { const node = document.getElementById(section.id); if (node) observer.observe(node); });
    return () => observer.disconnect();
  }, [sections]);

  return <nav aria-label={label} className="mt-6 flex gap-1 overflow-x-auto pb-1 lg:grid lg:overflow-visible">
    {sections.map(section => <a key={section.id} href={`#${section.id}`} aria-current={active === section.id ? "location" : undefined}
      className={cn("relative flex-none px-3 py-2 font-mono text-[13px] tracking-[0.025em] lowercase transition-colors",
        active === section.id ? "text-foreground" : "text-foreground/50 hover:text-foreground")}>
      {active === section.id && <motion.span layoutId={`${label}-active`} className="glass absolute inset-0 bg-paper" transition={{ type: "spring", stiffness: 700, damping: 45 }} />}
      <span className="relative">{section.title}</span>
    </a>)}
  </nav>;
}
