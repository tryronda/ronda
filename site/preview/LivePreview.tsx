import { useLayoutEffect, useRef, useState } from "react";
import App from "@/App";
import { installDemoBackend, appendDemoMessage, insertEarlierDemoMessage, changeFirstDemoAssistantReply } from "./demo";

// The app is designed for windows of at least 1024 px; render at a fixed desktop
// size and scale the whole window down to fit narrower layouts.
const WIDTH = 1180;
const HEIGHT = 720;

installDemoBackend();

export default function LivePreview() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () => setScale(Math.min(1, host.clientWidth / WIDTH));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return <><div className="mb-3 flex items-center gap-3 text-sm">
    <button type="button" onClick={appendDemoMessage} className="glass px-3 py-2">Append sample message</button>
    <button type="button" onClick={insertEarlierDemoMessage} className="glass px-3 py-2">Insert earlier sample message</button>
    <button type="button" onClick={changeFirstDemoAssistantReply} className="glass px-3 py-2">Change first assistant reply</button>
    <span>Open “Make session search handle code fragments and any language” to watch it update.</span>
  </div><p className="mb-3 text-sm text-muted-foreground">Load more sessions to browse over 600 active samples. Try “browsing sample” for over 500 grouped results, “pagination” for expandable matches, or “useEffect(” for code fragments. Filter by an illustrative model, local sessions, or the buildbox/local remote hosts; Include archived adds more samples. Open the first session and find “navigation marker” to cycle through prose, code, and tool output; try Prompts only. Deliberately scroll a sample transcript, then try Continue reading; the saved marker is synthetic and resets on reload. Use Insert earlier sample message to test that the same assistant reply still resolves after its sequence number changes; Change first assistant reply to see an edited saved reply become stale with no jump. In Settings → Data choose Rebuild index, or use Refresh library: the first fixed local scan example is clean and the next is partial with an aggregate error count. These examples reset on reload and never scan your computer or remote hosts. Use Copy message on a user or assistant message to copy its sample Markdown; system messages, thinking, tools, and images are excluded, and no local transcript is read. Local sessions have an Open project folder action and Copy project path; the sample action reports Desktop required and never opens a visitor folder. Bookmarks includes current, changed, and unavailable samples. Edit a note, browse away, then reopen it to recover the unsaved draft. Cancel or Escape discards it; Save stores the note. Drafts last until the preview reloads. Export/import a backup in Settings → Data. Preview and download a synthetic, allowlisted diagnostics JSON in Settings → Data; it is never uploaded. Select messages or available bookmarks from several sessions, then Preview context to inspect, edit, copy, or download sample Markdown for another agent. Select a project to see recent sessions, bookmarks, recurring errors, and exact sample Intelligence totals. On ronda, narrow to buildbox and open a synthetic error, then return with Back. Choose Find error history and paste “Error: SYNTHETIC_PROJECT_CHECK failed” for 28 previous sample occurrences and twenty-result paging; buildbox or Local sessions narrows to fourteen. Lookup runs only on submission. Expand Subagents / Related sessions on the first search session to open two indexed children or a file-sharing follow-up, then return with Back. Open the synthetic file-sharing follow-up for sample missing-folder readiness. Choose sample folder to see a recovered mapping, then remove it in Settings → Locations. Resume explicitly requires the desktop app. All preview data and changes reset on reload.</p><div ref={hostRef} className="w-full" style={{ height: HEIGHT * scale }}>
    {/* The transform also makes the app's fixed-position toasts anchor to this window, not the page. */}
    <div className="relative origin-top-left overflow-hidden bg-background"
      style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})` }}>
      <div className="pointer-events-none absolute top-[19px] left-4 z-10 flex gap-2" aria-hidden="true">
        <span className="size-3 rounded-full bg-[#ff5f57]" /><span className="size-3 rounded-full bg-[#febc2e]" /><span className="size-3 rounded-full bg-[#28c840]" />
      </div>
      <App embedded />
    </div>
  </div></>;
}
