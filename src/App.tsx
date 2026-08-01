import type React from "react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@/lib/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AiBrain01Icon, ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, ChartIcon, Home01Icon,
  Maximize01Icon, MinusSignIcon, PanelLeftIcon, Search01Icon, Settings01Icon,
} from "@hugeicons/core-free-icons";
import { Workbench } from "./workbench/Workbench";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { RondaLockup } from "@/components/brand/pixel-field";
import { MacWindowControls } from "@/components/mac-window-controls";
import { cn } from "@/lib/utils";
import { applyTheme } from "@/lib/theme";

const InsightsView = lazy(() => import("./panels/InsightsView").then(module => ({ default: module.InsightsView })));
const IntelligenceView = lazy(() => import("./panels/IntelligenceView").then(module => ({ default: module.IntelligenceView })));
const SettingsView = lazy(() => import("./panels/SettingsView").then(module => ({ default: module.SettingsView })));

type Page = "workbench" | "insights" | "intelligence" | "settings";

const pages: Page[] = ["workbench", "insights", "intelligence", "settings"];
const icons = { workbench: Home01Icon, insights: ChartIcon, intelligence: AiBrain01Icon, settings: Settings01Icon };
const labels = { workbench: "Sessions", insights: "Insights", intelligence: "Intelligence", settings: "Settings", library: "Library",
    overview: "Overview", preferences: "Preferences", back: "Back", forward: "Forward",
    toggle: "Toggle library sidebar", home: "Home", search: "Search sessions", minimize: "Minimize window",
    maximize: "Maximize or restore window", close: "Close window" };

/** `embedded` hosts the app inside another page: shortcuts stay scoped to its element and it uses macOS window chrome. */
export default function App({ embedded = false }: { embedded?: boolean } = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [navigation, setNavigation] = useState<{ entries: Page[]; index: number }>({ entries: ["workbench"], index: 0 });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mounted, setMounted] = useState<Record<Page, boolean>>({ workbench: true, insights: false, intelligence: false, settings: false });
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [homeToken, setHomeToken] = useState(0);
  const [openRequest, setOpenRequest] = useState<{ key: string; seq: number; token: number } | null>(null);
  const page = navigation.entries[navigation.index];
  const t = labels;
  // Embedded hosts draw macOS window chrome, so reserve the traffic-light space there too.
  const isMac = embedded || navigator.platform.toLowerCase().includes("mac");
  const shortcut = isMac ? "⌘" : "Ctrl+";

  const navigate = useCallback((next: Page) => {
    setMounted(current => current[next] ? current : { ...current, [next]: true });
    setNavigation(current => {
      if (current.entries[current.index] === next) return current;
      const entries = [...current.entries.slice(0, current.index + 1), next];
      return { entries, index: entries.length - 1 };
    });
  }, []);
  const go = useCallback((delta: number) => setNavigation(current => ({
    ...current, index: Math.max(0, Math.min(current.entries.length - 1, current.index + delta)),
  })), []);
  const goHome = useCallback(() => { navigate("workbench"); setHomeToken(value => value + 1); }, [navigate]);
  const openSession = useCallback((key: string, seq: number) => {
    navigate("workbench");
    setOpenRequest(current => ({ key, seq, token: (current?.token ?? 0) + 1 }));
  }, [navigate]);
  const openSearch = useCallback(() => { navigate("workbench"); setSearchFocusToken(value => value + 1); }, [navigate]);

  useEffect(() => {
    const updateTheme = applyTheme;
    void invoke<string | null>("get_pref", { key: "theme" })
      .then(updateTheme)
      .catch(() => updateTheme(null));
    const onTheme = (event: Event) => updateTheme((event as CustomEvent<string>).detail);
    const onSystemTheme = () => {
      void invoke<string | null>("get_pref", { key: "theme" }).then(updateTheme).catch(() => {});
    };
    window.addEventListener("ronda:theme", onTheme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", onSystemTheme);
    return () => {
      window.removeEventListener("ronda:theme", onTheme);
        media.removeEventListener("change", onSystemTheme);
    };
  }, []);

  useEffect(() => {
    const preload = () => { void import("./panels/InsightsView"); void import("./panels/IntelligenceView"); void import("./panels/SettingsView"); };
    const idle = window.requestIdleCallback?.(preload) ?? window.setTimeout(preload, 800);
    return () => { if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (embedded && !(event.target instanceof Node && rootRef.current?.contains(event.target))) return;
      const modifier = event.metaKey || event.ctrlKey;
      const editing = event.target instanceof HTMLElement && (event.target.isContentEditable ||
        event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement);
      if (modifier && event.key.toLowerCase() === "k") { event.preventDefault(); openSearch(); }
      else if (modifier && /^[1-4]$/.test(event.key)) { event.preventDefault(); navigate(pages[Number(event.key) - 1]); }
      else if (modifier && event.key.toLowerCase() === "b" && page === "workbench") { event.preventDefault(); setSidebarOpen(value => !value); }
      else if (!editing && event.altKey && event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
      else if (!editing && event.altKey && event.key === "ArrowRight") { event.preventDefault(); go(1); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [embedded, go, navigate, openSearch, page]);

  return <div ref={rootRef} className={cn("flex h-full w-full min-h-0 flex-col bg-background", isMac && "platform-mac")}>
    <header className="flex h-[52px] flex-none items-stretch border-b border-border bg-paper select-none" data-tauri-drag-region="deep">
      <div className="flex w-[240px] flex-none items-center gap-2.5 border-r border-border pr-2 pl-4 [.platform-mac_&]:pl-0 max-[1100px]:w-[200px]" data-tauri-drag-region="deep">
        {isMac && (embedded ? <span className="h-full w-[78px] flex-none" data-tauri-drag-region="deep" /> : <MacWindowControls />)}
        {/* Same bare lockup as the site header; below 1100px only the mark fits beside the window controls. */}
        <button type="button" className="flex h-9 items-center gap-2 text-foreground transition-opacity hover:opacity-70 [.platform-mac_&]:ml-1" data-tauri-drag-region="false"
          title={t.home} aria-label={t.home} onClick={goHome}>
          <RondaLockup className="text-[21px] max-[1100px]:[&>span:last-child]:hidden" />
        </button>
        <ChromeButton className="ml-auto" label={t.toggle} aria-expanded={sidebarOpen} disabled={page !== "workbench"}
          onClick={() => setSidebarOpen(value => !value)}>
          <HugeiconsIcon icon={PanelLeftIcon} size={16} strokeWidth={1.7} />
        </ChromeButton>
      </div>
      <div className="flex items-center gap-0.5 border-r border-border px-2" data-tauri-drag-region="false">
        <ChromeButton label={t.back} disabled={navigation.index === 0} onClick={() => go(-1)}>
          <HugeiconsIcon icon={ArrowLeft01Icon} size={15} /></ChromeButton>
        <ChromeButton label={t.forward} disabled={navigation.index === navigation.entries.length - 1} onClick={() => go(1)}>
          <HugeiconsIcon icon={ArrowRight01Icon} size={15} /></ChromeButton>
      </div>
      <nav className="flex min-w-0 flex-1 items-center gap-4 px-3" aria-label="Views" data-tauri-drag-region="deep">
        <Tabs variant="segment" value={page} onValueChange={value => navigate(value as Page)} className="flex-none">
          <TabsList className="gap-0 bg-chip">
            {pages.map(item => <TabsTrigger key={item} value={item} data-tauri-drag-region="false"
              aria-current={page === item ? "page" : undefined} title={`${t[item]} (${shortcut}${pages.indexOf(item) + 1})`}
              className={cn("label-mono h-8 gap-1.5 px-3 text-[13px] lowercase", page === item ? "!text-foreground" : "!text-foreground/50 hover:!text-foreground")}
              indicatorClassName="glass !bg-paper">
              <HugeiconsIcon icon={icons[item]} size={14} strokeWidth={1.8} />{t[item]}
            </TabsTrigger>)}
          </TabsList>
        </Tabs>
      </nav>
      <div className="flex items-center gap-2 px-3" data-tauri-drag-region="false">
        <button type="button" title={`${t.search} (${shortcut}K)`} aria-label={t.search} onClick={openSearch}
          className="glass label-mono flex h-8 items-center gap-2 px-3 text-[13px] lowercase text-foreground/50 transition-colors hover:text-foreground">
          <HugeiconsIcon icon={Search01Icon} size={14} strokeWidth={1.8} /><span className="max-[1100px]:hidden">{t.search}</span>
          <kbd className="bg-chip px-1.5 py-px text-[10px] normal-case">{shortcut}K</kbd>
        </button>
      </div>
      {!isMac && <div className="flex items-stretch border-l border-border" data-tauri-drag-region="false">
        {([[t.minimize, MinusSignIcon, () => getCurrentWindow().minimize()], [t.maximize, Maximize01Icon, () => getCurrentWindow().toggleMaximize()],
          [t.close, Cancel01Icon, () => getCurrentWindow().close()]] as const).map(([label, icon, action], index) =>
          <button key={label} type="button" title={label} aria-label={label} onClick={() => void action()}
            className={cn("grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-chip hover:text-foreground",
              index === 2 && "hover:!bg-[#d94f3f] hover:!text-white")}>
            <HugeiconsIcon icon={icon} size={15} />
          </button>)}
      </div>}
    </header>
    <div className="relative min-h-0 min-w-0 flex-1">
      <div className="workspace-view page-layer" {...layer(page === "workbench")}>
        <Workbench sidebarOpen={sidebarOpen} isActive={page === "workbench"}
          searchFocusToken={searchFocusToken} homeToken={homeToken} openRequest={openRequest} />
      </div>
      {mounted.insights && <PageView hidden={page !== "insights"}><InsightsView active={page === "insights"} /></PageView>}
      {mounted.intelligence && <PageView hidden={page !== "intelligence"}><IntelligenceView onOpen={openSession} active={page === "intelligence"} /></PageView>}
      {mounted.settings && <PageView hidden={page !== "settings"}><SettingsView /></PageView>}
    </div>
  </div>;
}

function ChromeButton({ label, className, children, ...props }: Omit<React.ComponentProps<"button">, "title"> & { label: string }) {
  return <button type="button" title={label} aria-label={label} data-tauri-drag-region="false"
    className={cn("grid size-7 flex-none place-items-center text-muted-foreground transition-colors hover:bg-chip hover:text-foreground disabled:pointer-events-none disabled:opacity-40", className)}
    {...props}>{children}</button>;
}

/** Every page stays mounted in the same box. Hidden ones skip rendering via content-visibility,
 * which keeps their scroll position and layout, so switching tabs never reflows or jumps. */
function layer(visible: boolean) {
  return { "data-visible": visible, "aria-hidden": !visible, inert: !visible };
}

function PageView({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  return <main className="page-layer bg-canvas" {...layer(!hidden)}>
    <Suspense fallback={null}>{children}</Suspense>
  </main>;
}
