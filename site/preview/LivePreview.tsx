import { useLayoutEffect, useRef, useState } from "react";
import App from "@/App";
import { installDemoBackend } from "./demo";

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

  return <div ref={hostRef} className="w-full" style={{ height: HEIGHT * scale }}>
    {/* The transform also makes the app's fixed-position toasts anchor to this window, not the page. */}
    <div className="relative origin-top-left overflow-hidden bg-background"
      style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})` }}>
      <div className="pointer-events-none absolute top-[19px] left-4 z-10 flex gap-2" aria-hidden="true">
        <span className="size-3 rounded-full bg-[#ff5f57]" /><span className="size-3 rounded-full bg-[#febc2e]" /><span className="size-3 rounded-full bg-[#28c840]" />
      </div>
      <App embedded />
    </div>
  </div>;
}
