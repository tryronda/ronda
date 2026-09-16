import { useEffect, useRef, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AppleIcon, ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { PixelField, PixelStrip, RondaLockup, RondaMark } from "@/components/brand/pixel-field";
import { themes, type ThemeName } from "@/lib/theme";
import { cn } from "@/lib/utils";
import appIconPng from "../../src-tauri/icons/icon.png";
import appIcon from "../../src-tauri/icons/icon.svg";
import { base, PageIntro, SectionNav, SiteFooter, SiteHeader } from "../Chrome";
import { groupTone, parseChangelog, releaseTitle } from "../changelog/releases";
import { REPO_URL } from "../release";
import { logoAssets, platforms, socialAssets } from "./assets";

const sections = [
  { id: "press", title: "Press kit" }, { id: "social", title: "Social media" }, { id: "logo", title: "Logo" }, { id: "naming", title: "Naming" },
  { id: "voice", title: "Voice" }, { id: "color", title: "Color" }, { id: "themes", title: "Themes" },
  { id: "type", title: "Type" }, { id: "shape", title: "Shape" }, { id: "pixels", title: "Pixel field" }, { id: "motion", title: "Motion" },
];

const fileName = (path: string) => path.split("/").pop()!;

const logoFiles = [
  { name: "ronda-mark.svg", use: "Mark, vector, for light backgrounds", href: `${base}brand/ronda-mark.svg` },
  { name: "ronda-mark-reversed.svg", use: "Mark, vector, for dark backgrounds", href: `${base}brand/ronda-mark-reversed.svg` },
  ...logoAssets.map(asset => ({ name: fileName(asset.file), use: `${asset.use}, ${asset.width} × ${asset.height}`, href: `${base}${asset.file}` })),
  { name: "app-icon.svg", use: "Desktop app icon, vector", href: appIcon },
  { name: "app-icon.png", use: "Desktop app icon, 512 × 512", href: appIconPng },
];

const accents: [name: string, usage: string][] = [
  ["sky", "Daylight, the mark's corner"], ["sun", "Busiest days, performance"], ["olive", "Growth, what was added"],
  ["bark", "Ground, warm pixels"], ["ember", "Fixes, Claude Code"], ["rust", "Security"], ["destructive", "Move to Trash only"],
];

const themeNotes: Record<ThemeName, string> = {
  dawn: "Warm paper for early hours",
  morning: "The light default",
  dusk: "Plum and ember for evenings",
  night: "The dark default",
};

const families = [
  { role: "display", family: "Newsreader", className: "font-serif text-[40px] leading-[1.1] tracking-[-0.01em]", usage: "Headlines, the wordmark and release titles." },
  { role: "body", family: "Afacad", className: "text-[24px] leading-snug tracking-[0.02em]", usage: "Paragraphs, docs, transcripts and marketing copy." },
  { role: "mono", family: "JetBrains Mono", className: "font-mono text-[20px] leading-snug tracking-[0.025em]", usage: "Buttons, labels, metadata, keys and code." },
];

const typeScale = [
  { name: "display-hero", spec: "Newsreader 56 / 1.1", className: "font-serif text-[40px] leading-[1.1] tracking-[-0.01em] sm:text-[56px]", sample: "All your agent sessions in one place." },
  { name: "display-section", spec: "Newsreader 48 / 1.1", className: "font-serif text-[48px] leading-[1.1] tracking-[-0.01em]", sample: "What's new" },
  { name: "heading-card", spec: "Newsreader 28 / 1.1", className: "font-serif text-[28px] leading-[1.1] tracking-[-0.01em]", sample: "Find it in milliseconds" },
  { name: "lede", spec: "Afacad 18 / 1.5 / +0.025em", className: "text-[18px] leading-normal tracking-[0.025em]", sample: "Browse, search, and resume sessions from 18 agents." },
  { name: "body", spec: "Afacad 16 / 1.5 / +0.02em", className: "text-[16px] leading-normal tracking-[0.02em] text-ink-soft", sample: "A rebuildable SQLite index on your machine." },
  { name: "control", spec: "Mono 14 / 500 / +0.025em", className: "font-mono text-[14px] font-medium tracking-[0.025em]", sample: "download for mac" },
  { name: "label-mono", spec: "Mono 11 / 500 / +0.025em", className: "label-mono", sample: "18 agents · full-text search · resume" },
];

const voice: [write: string, not: string][] = [
  ["All your agent sessions in one place.", "The ultimate AI session manager!"],
  ["Sessions never go to a Ronda server.", "100% secure and private."],
  ["26 ms p95 on an Apple M3 Pro, including CLI startup.", "Blazing-fast search."],
  ["download for mac", "Download Now"],
];

const easings: [string, string, string][] = [
  ["EASE_OUT", "0.16, 1, 0.3, 1", "Entrances: rise 8px and fade over 0.35s"],
  ["EASE_IN_OUT", "0.77, 0, 0.175, 1", "Movement between two resting places"],
  ["EASE_DRAWER", "0.32, 0.72, 0, 1", "Sheets and drawers"],
];

const springs: [string, string, string][] = [
  ["SPRING_PRESS", "500 / 30 / 0.6", "Button press, scale 0.93"],
  ["SPRING_SWAP", "460 / 30 / 0.55", "Labels and icons trading places"],
  ["SPRING_PANEL", "420 / 40 / 0.5", "Modals and sheets"],
  ["SPRING_LAYOUT", "360 / 32 / 0.6", "Indicators gliding between positions"],
  ["SPRING_GLIDE", "700 / 50 / 0.5", "Dragged slider handles"],
];

/** Reads CSS custom properties from an element, refreshing when the page theme changes. */
function useCssValues<T extends HTMLElement>(names: readonly string[]) {
  const ref = useRef<T>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const key = names.join(" ");
  useEffect(() => {
    const read = () => {
      if (!ref.current) return;
      const style = getComputedStyle(ref.current);
      setValues(Object.fromEntries(key.split(" ").map(name => [name, style.getPropertyValue(`--${name}`).trim()])));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [key]);
  return [ref, values] as const;
}

function Section({ id, title, lead, children }: { id: string; title: string; lead: ReactNode; children: ReactNode }) {
  return <section id={id} className="mb-14 scroll-mt-24 border-b border-border pb-14">
    <h2 className="font-serif text-[32px] leading-[1.1] tracking-[-0.01em]">
      <a href={`#${id}`} className="hover:underline hover:decoration-stone hover:underline-offset-4">{title}</a>
    </h2>
    <p className="mt-3 max-w-[60ch] text-[17px] leading-normal tracking-[0.015em] text-ink-soft">{lead}</p>
    <div className="mt-10">{children}</div>
  </section>;
}

function Rules({ items, tone = "bg-olive" }: { items: ReactNode[]; tone?: string }) {
  return <ul className="mt-8 grid max-w-[65ch] gap-2.5">
    {items.map((item, index) => <li key={index} className="grid grid-cols-[12px_minmax(0,1fr)] gap-3 text-[16px] leading-normal tracking-[0.015em] text-ink-soft">
      <span className={cn("mt-[9px] size-1.5", tone)} aria-hidden="true" /><span>{item}</span>
    </li>)}
  </ul>;
}

const Token = ({ children }: { children: string }) => <code className="bg-chip px-1 py-px font-mono text-[0.86em] text-foreground">{children}</code>;
const Label = ({ children, className }: { children: ReactNode; className?: string }) => <span className={cn("label-mono text-muted-foreground", className)}>{children}</span>;

/** A specimen painted in one theme with a caption strip. Semantic aliases resolve on :root, so it uses raw tokens and re-points --foreground for the mark. */
function Tile({ theme, caption, children, className }: { theme: ThemeName; caption: string; children: ReactNode; className?: string }) {
  return <figure data-theme={theme} className={cn("m-0 flex flex-col bg-paper text-ink shadow-lift [--foreground:var(--ink)]", className)}>
    <div className="flex min-h-40 flex-1 items-center justify-center p-8">{children}</div>
    <figcaption className="label-mono border-t border-rule bg-chip px-4 py-2.5 text-stone">{caption}</figcaption>
  </figure>;
}

function Swatch({ name, usage }: { name: string; usage: string }) {
  const [ref, values] = useCssValues<HTMLDivElement>([name]);
  return <div ref={ref} className="min-w-0">
    <div className="h-24 shadow-lift" style={{ background: `var(--${name})` }} />
    <div className="mt-2.5 grid gap-0.5">
      <span className="label-mono">{name}</span>
      <Label className="uppercase">{values[name] || " "}</Label>
      <span className="mt-1 text-[14px] leading-snug text-muted-foreground">{usage}</span>
    </div>
  </div>;
}

const themeDots = ["paper", "chip", "stone", "ink"] as const;

function ThemeRow({ theme }: { theme: ThemeName }) {
  const [ref, values] = useCssValues<HTMLDivElement>(themeDots);
  return <div ref={ref} data-theme={theme} className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-paper px-6 py-5 text-ink shadow-lift">
    <div className="grid min-w-0 flex-1 gap-1.5">
      <span className="font-serif text-[26px] leading-none capitalize">{theme}</span>
      <span className="text-[15px] leading-snug text-stone">{themeNotes[theme]}</span>
    </div>
    <span className="label-mono text-stone">bg: {values.paper} / fg: {values.ink}</span>
    <div className="flex" aria-hidden="true">
      {themeDots.map(name => <span key={name} title={name} className="-ml-1.5 size-7 rounded-full shadow-lift first:ml-0" style={{ background: `var(--${name})` }} />)}
    </div>
  </div>;
}

export function Brand() {
  const latest = parseChangelog().find(release => release.date);

  return <div className="min-h-full bg-background text-foreground">
    <SiteHeader page="brand" />
    <main id="main" className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,1fr)] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-16 lg:py-20">
      <PageIntro eyebrow="brand" title="Brand">
        <p className="mt-4 text-[17px] leading-normal tracking-[0.02em] text-ink-soft">
          Logos, colors, themes, type and voice for representing Ronda, drawn from the app's own tokens and components.
        </p>
        <SectionNav label="Brand" sections={sections} />
        <a href={`${REPO_URL}/blob/main/src/index.css`} className="mt-5 inline-flex items-center gap-1.5 font-mono text-[13px] tracking-[0.025em] text-foreground/60 underline decoration-stone underline-offset-2 hover:text-foreground">
          src/index.css<HugeiconsIcon icon={ArrowRight01Icon} size={13} /></a>
      </PageIntro>

      <div className="min-w-0">
        <Section id="press" title="Press kit" lead="Resources for writers, reviewers and anyone featuring Ronda.">
          <blockquote className="m-0 max-w-[65ch] border-l-2 border-olive pl-5 text-[18px] leading-normal tracking-[0.02em]">
            Ronda is a desktop library for coding-agent conversations. It reads sessions from 18 agents, including Claude Code, Codex, Cursor and Gemini CLI, indexes them in a local SQLite database, and lets you browse, search and resume them. Sessions never go to a Ronda server.
          </blockquote>
          <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
            {[
              ["latest release", latest ? `${releaseTitle(latest)} · ${latest.date}` : "unreleased"],
              ["platforms", "macOS, Windows, Linux"],
              ["agents", "18 supported"],
              ["search", "26 ms p95"],
              ["built with", "Tauri 2, Rust, React"],
            ].map(([term, value]) => <div key={term} className="grid content-start gap-1.5 border-t border-border pt-3">
              <dt className="label-mono text-muted-foreground">{term}</dt>
              <dd className="m-0 text-[17px] leading-snug">{value}</dd>
            </div>)}
          </dl>
          <h3 className="mt-12"><Label>logo files</Label></h3>
          <ul className="mt-3">
            {logoFiles.map(file => <li key={file.name} className="border-t border-border last:border-b">
              <a href={file.href} download={file.name} className="group flex items-center gap-4 py-3">
                <span className="font-mono text-[13px] tracking-[0.025em]">{file.name}</span>
                <span className="hidden text-[15px] text-muted-foreground sm:inline">{file.use}</span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="ml-auto shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              </a>
            </li>)}
          </ul>
        </Section>

        <Section id="social" title="Social media" lead="Profile pictures, banners and post images, sized for each platform and ready to upload.">
          {platforms.map(platform => <div key={platform.id} className="mt-12 first:mt-0">
            <h3 className="font-serif text-[24px] leading-none">{platform.title}</h3>
            <p className="mt-2 max-w-[65ch] text-[15px] leading-normal text-muted-foreground">{platform.note}</p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2">
              {socialAssets.filter(asset => asset.platform === platform.id).map(asset => <li key={asset.file} className={cn(asset.width / asset.height > 2.5 && "sm:col-span-2")}>
                <a href={`${base}${asset.file}`} download={fileName(asset.file)} className="group grid gap-2.5">
                  <span className="grid place-items-center bg-canvas p-4 shadow-lift">
                    <img src={`${base}${asset.file}`} alt={`${platform.title} ${asset.label.toLowerCase()} preview`} loading="lazy" width={asset.width} height={asset.height}
                      className={cn("h-auto max-h-56 w-auto max-w-full", asset.kind === "avatar" && "max-h-28 rounded-full")} />
                  </span>
                  <span className="flex items-baseline gap-3">
                    <span className="text-[16px] leading-snug">{asset.label}</span>
                    <Label className="tabular-nums">{asset.width} × {asset.height}</Label>
                    <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="ml-auto shrink-0 self-center text-muted-foreground transition-colors group-hover:text-foreground" />
                  </span>
                  <span className="-mt-2 text-[14px] leading-snug text-muted-foreground">{asset.use}</span>
                </a>
              </li>)}
            </ul>
          </div>)}
        </Section>

        <Section id="logo" title="Logo" lead="A three-by-three grid of square pixels with the centre left open and one sky corner. Use the lockup where the name is not already on screen, and the reversed version on dark backgrounds.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Tile theme="morning" caption="lockup"><RondaLockup className="text-[40px]" /></Tile>
            <Tile theme="night" caption="lockup reversed"><RondaLockup className="text-[40px]" /></Tile>
            <Tile theme="dawn" caption="mark"><RondaMark className="size-12 gap-[3px]" /></Tile>
            <Tile theme="dusk" caption="mark reversed"><RondaMark className="size-12 gap-[3px]" /></Tile>
            <Tile theme="morning" caption="app icon · the reversed mark on a rounded night square" className="sm:col-span-2">
              <img src={appIcon} alt="Ronda app icon" className="size-20" />
            </Tile>
          </div>
          <Rules items={[
            "Keep clear space equal to the mark's height on every side of the lockup.",
            "Scale the gaps with the mark: 1px at 16px, 2px at 32px, 3px at 48px.",
            "Make the mark as tall as the capitals of “Ronda” and sit it on the baseline, about a third of the type size away.",
          ]} />
          <h3 className="mt-12 font-serif text-[24px] leading-none">Misuse</h3>
          <Rules tone="bg-ember" items={[
            "Do not round, rotate, stretch or re-space the cells.",
            "Do not fill the centre cell or move the sky cell to another corner.",
            "Do not recolor the sky cell, or set the ink cells in an accent.",
            "Do not add shadows, outlines or gradients.",
            "Do not place the logo directly on the pixel field or a busy image; use a paper or glass plate.",
            "Do not set the wordmark in another typeface.",
          ]} />
        </Section>

        <Section id="naming" title="Naming" lead={<>The product is <strong className="font-medium text-foreground">Ronda</strong>. Its command-line and MCP tools keep their lowercase binary names.</>}>
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <Label>correct</Label>
              <ul className="mt-3 grid gap-2.5 border-t border-border pt-3 text-[18px]">
                <li>Ronda</li>
                <li><code className="font-mono text-[15px]">ronda-cli</code>, <code className="font-mono text-[15px]">ronda-mcp</code></li>
              </ul>
            </div>
            <div>
              <Label>incorrect</Label>
              <ul className="mt-3 grid gap-2.5 border-t border-border pt-3 text-[18px] text-muted-foreground line-through decoration-stone">
                <li>RONDA</li>
                <li>Ronda App</li>
                <li>Ronda AI</li>
                <li>ronda, in running text</li>
              </ul>
            </div>
          </div>
        </Section>

        <Section id="voice" title="Voice" lead="Plain and specific. Say what Ronda does and what it never does, with real numbers and no hype.">
          <div className="grid gap-px bg-border sm:grid-cols-2">
            <Label className="bg-background pb-3">write</Label>
            <Label className="hidden bg-background pb-3 sm:block">not</Label>
            {voice.map(([yes, no]) => <div key={yes} className="contents">
              <p className="bg-background py-4 pr-6 text-[17px] leading-snug">{yes}</p>
              <p className="bg-background py-4 pr-6 text-[17px] leading-snug text-muted-foreground line-through decoration-stone">{no}</p>
            </div>)}
          </div>
          <Rules items={[
            "Headlines are sentence case and end with a period when they are a sentence.",
            <>Buttons, links, tags and eyebrows are lowercase mono: <Token>try it here</Token>, <Token>changelog</Token>.</>,
            <>Name interface items as they appear, in bold: <strong className="font-medium text-foreground">Move to Trash</strong>, <strong className="font-medium text-foreground">Settings → Remote hosts</strong>.</>,
            "Speak to “you”. Ronda is “Ronda” or “it”, never “we”. No emoji, no exclamation marks.",
            "State measurements with their conditions, and leave unknowns unknown.",
          ]} />
        </Section>

        <Section id="color" title="Color" lead="The accents come from the pixel field: sky for daylight, sun for the busiest days, olive and bark for ground, ember and rust for warmth. They stay the same in every theme and appear as fills, with #171717 text.">
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4 xl:grid-cols-7">
            {accents.map(([name, usage]) => <Swatch key={name} name={name} usage={usage} />)}
          </div>
          <Rules items={[
            <>The primary action is a solid <Token>ink</Token> block. There is no coloured button.</>,
            <>Never set body text in an accent. White text goes only on <Token>rust</Token>.</>,
            <>Keep <Token>destructive</Token> for removing things.</>,
          ]} />
        </Section>

        <Section id="themes" title="Themes" lead="Ronda shifts through four time-of-day themes, lightest to darkest. Morning and night follow the system setting; dawn and dusk are chosen. Offer all four, never a two-state toggle.">
          <div className="grid gap-3">
            {themes.map(theme => <ThemeRow key={theme} theme={theme} />)}
          </div>
          <Rules items={[
            <>Text is <Token>ink</Token> for headings, <Token>ink-soft</Token> for paragraphs, <Token>stone</Token> for metadata.</>,
            <>Separate sections with a <Token>rule</Token> hairline; lift single objects with the <Token>lift</Token> shadow instead of a border.</>,
            <>In dawn, <Token>stone</Token> reads 3.5:1 on paper. Use <Token>ink-soft</Token> for dawn captions.</>,
          ]} />
        </Section>

        <Section id="type" title="Type" lead="Three typefaces, three jobs: an editorial serif for statements, a warm sans for reading, and a mono for anything you press or scan.">
          <div className="grid gap-3">
            {families.map(face => <div key={face.role} className="bg-canvas shadow-lift">
              <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
                <Label>{face.role}</Label><Label>{face.family.toLowerCase()}</Label>
              </div>
              <div className="px-5 pt-5 pb-4">
                <p className={cn("text-balance", face.className)}>All your agent sessions in one place.</p>
                <p className="mt-3 text-[14px] leading-snug text-muted-foreground">{face.usage}</p>
              </div>
            </div>)}
          </div>
          <h3 className="mt-12"><Label>scale</Label></h3>
          <ul className="mt-3 grid">
            {typeScale.map(style => <li key={style.name} className="grid gap-2 border-t border-border py-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-8">
              <div className="grid content-start gap-1">
                <span className="label-mono">{style.name}</span>
                <Label>{style.spec}</Label>
              </div>
              <p className={cn("min-w-0 text-balance", style.className)}>{style.sample}</p>
            </li>)}
          </ul>
        </Section>

        <Section id="shape" title="Shape" lead="Square corners, glass controls and one hairline shadow. The pieces the site and app are built from.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Specimen label="buttons">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-10 items-center gap-2 bg-foreground px-4 font-mono text-[14px] font-medium tracking-[0.025em] text-background"><HugeiconsIcon icon={AppleIcon} size={16} strokeWidth={1.8} />download</span>
                <span className="glass flex h-10 items-center px-3.5 font-mono text-[14px] font-medium tracking-[0.025em] text-foreground/60">intel</span>
              </div>
            </Specimen>
            <Specimen label="eyebrow and tags">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow-chip">changelog</span>
                {Object.entries(groupTone).map(([kind, tone]) => <span key={kind} className={cn("inline-block px-2 pt-0.5 pb-1 font-mono text-[12px] font-medium tracking-[0.025em] lowercase", tone)}>{kind}</span>)}
              </div>
            </Specimen>
            <Specimen label="agents">
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {[["claude-code", "claude code"], ["codex", "codex"], ["cursor", "cursor"], ["gemini", "gemini cli"], ["opencode", "opencode"], ["kiro", "kiro"]].map(([id, name]) =>
                  <span key={id} className="label-mono flex items-center gap-2"><span className={`agent-dot agent-${id}`} />{name}</span>)}
              </div>
            </Specimen>
            <Specimen label="keys and code">
              <div className="grid gap-3">
                <div className="flex items-center gap-3 text-[15px] text-ink-soft"><kbd className="glass px-2 pt-[3px] pb-1 font-mono text-[13px] text-foreground">⌘K</kbd>Search the library</div>
                <pre className="overflow-x-auto bg-paper px-4 py-3 font-mono text-[13px] leading-relaxed shadow-lift"><code>ronda-cli search 'useEffect('</code></pre>
              </div>
            </Specimen>
          </div>
          <Rules items={[
            "Corners are 0 on cards, chips, buttons and inputs; 4px is the ceiling. No pills.",
            "Focus is a 2px paper gap, then a 2px ink ring.",
            "Content sits in a 1240px container with 16px gutters on phones and 24px above.",
          ]} />
        </Section>

        <Section id="pixels" title="Pixel field" lead="The signature graphic: base columns broken by light runs, olive clusters, a checkered trail and warm blocks. Its colours come from the theme, so switch themes in the header to watch it change.">
          <PixelField cols={48} rows={8} seed={7} className="shadow-lift" />
          <PixelStrip cols={96} seed={12} className="mt-4 h-2" />
          <Rules items={[
            "Use it behind the product preview, as a strip above the footer, and around the social card.",
            "Put words on a paper or glass plate above it, never directly on the pixels.",
            "Cells flip every 2.4 seconds, and stay still when reduced motion is on.",
          ]} />
        </Section>

        <Section id="motion" title="Motion" lead="Short, springy and never in the way. Everything settles, nothing bounces, and all of it respects reduced motion.">
          <div className="grid gap-10 sm:grid-cols-2">
            <MotionTable title="curves" rows={easings} />
            <MotionTable title="springs · stiffness / damping / mass" rows={springs} />
          </div>
        </Section>

        <p className="text-[17px] leading-normal tracking-[0.015em] text-ink-soft">
          For brand or press questions, <a href={`${REPO_URL}/issues`} className="text-foreground underline decoration-stone underline-offset-2 hover:decoration-foreground">open an issue on GitHub</a>.
        </p>
      </div>
    </main>
    <SiteFooter />
  </div>;
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid content-start gap-5 bg-canvas p-6 shadow-lift">
    <Label>{label}</Label>
    {children}
  </div>;
}

function MotionTable({ title, rows }: { title: string; rows: [string, string, string][] }) {
  return <div>
    <h3><Label>{title}</Label></h3>
    <ul className="mt-3">
      {rows.map(([name, value, usage]) => <li key={name} className="grid gap-1 border-t border-border py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="label-mono">{name}</span>
          <Label className="tabular-nums">{value}</Label>
        </div>
        <span className="text-[15px] leading-snug text-ink-soft">{usage}</span>
      </li>)}
    </ul>
  </div>;
}
