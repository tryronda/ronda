import { useEffect, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

type TerminalEvent = { event: "exit"; code: number | null };

const FONT = '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';

/** ANSI colors tuned per scheme; background, text, cursor and selection come from the theme tokens. */
const ansi = {
  light: {
    black: "#171717", red: "#c2410c", green: "#4d7c0f", yellow: "#a16207", blue: "#1d6fb8", magenta: "#9d3a6b", cyan: "#0e7490", white: "#8a8a8e",
    brightBlack: "#707175", brightRed: "#e36438", brightGreen: "#6f8a1f", brightYellow: "#b7791f", brightBlue: "#2f8bd8", brightMagenta: "#b6497f", brightCyan: "#1592a8", brightWhite: "#3a3a3c",
  },
  dark: {
    black: "#2a2a2c", red: "#f07a5a", green: "#b5c65c", yellow: "#ffd745", blue: "#8bcfff", magenta: "#e38ab4", cyan: "#7fd6cf", white: "#d8d8dc",
    brightBlack: "#6f6f74", brightRed: "#ff9a7d", brightGreen: "#cadb73", brightYellow: "#ffe37a", brightBlue: "#b0defe", brightMagenta: "#f0a8c9", brightCyan: "#a2e6e0", brightWhite: "#ffffff",
  },
} satisfies Record<string, ITheme>;

function readTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const dark = css.colorScheme.includes("dark");
  return {
    ...(dark ? ansi.dark : ansi.light),
    background: token("--paper"),
    foreground: token("--ink"),
    cursor: token("--ink"),
    cursorAccent: token("--paper"),
    selectionBackground: token("--selection"),
    scrollbarSliderBackground: token("--rule"),
    scrollbarSliderHoverBackground: token("--stone"),
    scrollbarSliderActiveBackground: token("--stone"),
  };
}

/**
 * One live terminal resuming a session. It stays mounted while hidden so the agent keeps
 * running; `visible` only controls sizing and focus. Closing the component kills the process.
 */
export function SessionTerminal({ sessionKey, visible, onExit, onError }: {
  sessionKey: string; visible: boolean;
  onExit: (code: number | null) => void; onError: (message: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const callbacks = useRef({ onExit, onError });
  callbacks.current = { onExit, onError };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let id: number | null = null;
    const term = new Terminal({
      fontFamily: FONT, fontSize: 13, lineHeight: 1.3, letterSpacing: 0, fontWeight: 400, fontWeightBold: 600,
      cursorBlink: true, cursorStyle: "bar", cursorWidth: 2, scrollback: 10_000, allowProposedApi: false,
      macOptionIsMeta: true, drawBoldTextInBrightColors: false, minimumContrastRatio: 4.5,
      theme: readTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_event, uri) => void openUrl(uri)));
    termRef.current = term;
    fitRef.current = fit;

    const start = async () => {
      // Measure glyphs with the real font, or the grid is sized for the fallback.
      await document.fonts.load(`13px ${FONT}`).catch(() => {});
      if (disposed) return;
      term.open(host);
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch { /* DOM renderer fallback */ }
      fit.fit();

      // Raw channel payloads arrive as an ArrayBuffer; tolerate a plain byte array too.
      const output = new Channel<ArrayBuffer | number[]>();
      output.onmessage = data => term.write(data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data));
      const events = new Channel<TerminalEvent>();
      events.onmessage = message => {
        if (message.event !== "exit") return;
        term.write(`\r\n\x1b[2m[process exited${message.code === null ? "" : ` with code ${message.code}`}]\x1b[0m\r\n`);
        id = null;
        callbacks.current.onExit(message.code);
      };
      try {
        const opened = await invoke<number>("terminal_open", { key: sessionKey, cols: term.cols, rows: term.rows, output, events });
        if (disposed) { void invoke("terminal_close", { id: opened }); return; }
        id = opened;
        term.focus();
      } catch (cause) {
        callbacks.current.onError(String(cause));
      }
    };
    void start();

    const input = term.onData(data => { if (id !== null) void invoke("terminal_write", { id, data }); });
    const resize = term.onResize(({ cols, rows }) => { if (id !== null) void invoke("terminal_resize", { id, cols, rows }); });
    const observer = new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    });
    observer.observe(host);
    const themeObserver = new MutationObserver(() => { term.options.theme = readTheme(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      disposed = true;
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      resize.dispose();
      if (id !== null) void invoke("terminal_close", { id });
      term.dispose();
      termRef.current = null;
    };
  }, [sessionKey]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      if (hostRef.current?.clientWidth) fitRef.current?.fit();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return <div ref={hostRef} className="session-terminal h-full min-h-0 w-full min-w-0" />;
}
