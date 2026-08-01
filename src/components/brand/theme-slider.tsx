import { useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { resolveTheme, saveTheme, themes, type ThemeName } from "@/lib/theme";
import { cn } from "@/lib/utils";

const current = (): ThemeName => resolveTheme(document.documentElement.dataset.theme);
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};
// The prerendered site has no document; render the light default and settle on the real theme after hydration.
const serverTheme = (): ThemeName => "morning";

/** Sun, four ticks, moon: step through dawn → morning → dusk → night. */
export function ThemeSlider({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, current, serverTheme);
  const index = themes.indexOf(theme);
  const choose = (next: ThemeName) => { void saveTheme(next).catch(() => {}); };

  return <div role="radiogroup" aria-label="Theme" data-tauri-drag-region="false"
    className={cn("glass flex h-8 items-center px-0.5 text-muted-foreground", className)}>
    <button type="button" title="Lighter theme" aria-label="Lighter theme" disabled={index === 0}
      className="grid size-7 place-items-center transition-colors hover:text-foreground disabled:opacity-40"
      onClick={() => choose(themes[Math.max(0, index - 1)])}><HugeiconsIcon icon={Sun03Icon} size={14} strokeWidth={1.8} /></button>
    {themes.map(name => <button key={name} type="button" role="radio" aria-checked={theme === name} title={name} aria-label={name}
      className="group grid h-6 w-3 place-items-center" onClick={() => choose(name)}>
      <span className={cn("block w-px transition-all duration-150",
        theme === name ? "h-4 bg-foreground" : "h-2.5 bg-foreground/20 group-hover:bg-foreground/50")} />
    </button>)}
    <button type="button" title="Darker theme" aria-label="Darker theme" disabled={index === themes.length - 1}
      className="grid size-7 place-items-center transition-colors hover:text-foreground disabled:opacity-40"
      onClick={() => choose(themes[Math.min(themes.length - 1, index + 1)])}><HugeiconsIcon icon={Moon02Icon} size={14} strokeWidth={1.8} /></button>
  </div>;
}
