import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const controls = [
  { key: "close", label: "Close window", color: "bg-[#ff5f57]", hover: "group-hover/traffic:bg-[#ff5f57]", ring: "ring-[#e0443e]",
    glyph: <path d="M3 3l4 4M7 3l-4 4" /> },
  { key: "minimize", label: "Minimize window", color: "bg-[#febc2e]", hover: "group-hover/traffic:bg-[#febc2e]", ring: "ring-[#dea123]",
    glyph: <path d="M2.5 5h5" /> },
  { key: "zoom", label: "Enter full screen (⌥ click to zoom)", color: "bg-[#28c840]", hover: "group-hover/traffic:bg-[#28c840]", ring: "ring-[#1aab29]",
    glyph: <path d="M3 3.2h2.6L3 5.8zM7 6.8H4.4L7 4.2z" fill="currentColor" stroke="none" /> },
] as const;

/**
 * macOS close / minimize / zoom drawn by the page. The native buttons are hidden in
 * `traffic_lights.rs` because AppKit renders them invisible over the webview once the
 * window loses focus. Mirrors macOS: grey while unfocused, glyphs on hover of the group.
 */
export function MacWindowControls() {
  const [focused, setFocused] = useState(() => document.hasFocus());

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    let unlisten: (() => void) | undefined;
    let live = true;
    if (inTauri()) void getCurrentWindow().onFocusChanged(({ payload }) => setFocused(payload))
      .then(stop => { if (live) unlisten = stop; else stop(); });
    return () => { live = false; unlisten?.(); window.removeEventListener("focus", onFocus); window.removeEventListener("blur", onBlur); };
  }, []);

  const run = async (key: typeof controls[number]["key"], zoomInstead: boolean) => {
    if (!inTauri()) return;
    const win = getCurrentWindow();
    if (key === "close") await win.close();
    else if (key === "minimize") await win.minimize();
    else if (zoomInstead) await win.toggleMaximize();
    else await win.setFullscreen(!(await win.isFullscreen()));
  };

  return <div className="group/traffic flex h-full w-[78px] flex-none items-center gap-2 pl-[18px]" data-tauri-drag-region="false">
    {controls.map(control => <button key={control.key} type="button" aria-label={control.label} title={control.label}
      onClick={event => void run(control.key, event.altKey)}
      className={cn("grid size-3 place-items-center rounded-full ring-[0.5px] ring-inset transition-colors",
        focused ? [control.color, control.ring] : "bg-[#d5d5d5] ring-[#c2c2c2] dark:bg-[#4d4d4f] dark:ring-[#5a5a5c]",
        !focused && control.hover)}>
      <svg viewBox="0 0 10 10" className="size-2 text-black/60 opacity-0 transition-opacity group-hover/traffic:opacity-100" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" aria-hidden="true">
        {control.glyph}
      </svg>
    </button>)}
  </div>;
}
