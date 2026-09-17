import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { AgentId, ProjectInfo, SearchHit, SessionMeta, SessionQuery, TranscriptMessage } from "@/workbench/api";

/*
 * An in-memory stand-in for the Tauri backend so the real Ronda interface can
 * run on the product site. Everything is sample data; nothing leaves the page.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();

const projects = {
  ronda: "/Users/you/dev/ronda",
  api: "/Users/you/dev/payments-api",
  web: "/Users/you/dev/storefront",
  infra: "/Users/you/dev/infra",
  ml: "/Users/you/dev/ranker",
};

type Script = { title: string; agent: AgentId; project: string; model: string; ago: number; messages: Omit<TranscriptMessage, "seq" | "timestamp">[] };

const text = (role: TranscriptMessage["role"], body: string, extra: Partial<TranscriptMessage> = {}): Omit<TranscriptMessage, "seq" | "timestamp"> =>
  ({ role, kind: "text", text: body, model: null, thinking: null, tool_calls: [], images: [], ...extra });
const tool = (name: string, input: string, output: string, is_error = false) => ({ id: `${name}-${input.length}`, name, input, output, is_error });

const scripts: Script[] = [
  {
    title: "Make session search handle code fragments and any language", agent: "claude-code", project: projects.ronda, model: "claude-opus-5", ago: 2 * HOUR,
    messages: [
      text("user", "Search misses results for queries like `useEffect(`, and for languages that don't put spaces between words. Can you fix the index?"),
      text("assistant", "The FTS5 table uses the default `unicode61` tokenizer, which splits on punctuation and needs a word segmenter it doesn't have. I'll switch it to the **trigram** tokenizer and keep a substring fallback for queries shorter than three characters.\n\n```sql\nCREATE VIRTUAL TABLE message_fts USING fts5(\n  text,\n  tokenize = 'trigram'\n);\n```\n\nTrigram matching gives us:\n\n- exact code fragments such as `useEffect(`\n- prose in any language, with no segmenter to install\n- case-insensitive matches by default",
        { model: "claude-opus-5", thinking: "The unicode61 tokenizer drops '(' and swallows a whole unspaced run as one token. Trigram avoids both, at the cost of a larger index.", tool_calls: [
          tool("Read", "crates/ronda-core/src/store.rs", "812 lines"),
          tool("Edit", "crates/ronda-core/src/store.rs", "Replaced tokenizer and added short-query fallback"),
          tool("Bash", "cargo test -p ronda-core search", "test result: ok. 14 passed; 0 failed"),
        ] }),
      text("user", "How much bigger is the index?"),
      text("assistant", "On the 800 MiB benchmark fixture the index is **263 MiB**, and search stays at **23 ms p50 / 26 ms p95** including process startup. That is well inside the 100 ms target.", { model: "claude-opus-5" }),
    ],
  },
  {
    title: "Idempotency keys for the refunds endpoint", agent: "codex", project: projects.api, model: "gpt-5-codex", ago: 5 * HOUR,
    messages: [
      text("user", "Clients retry `POST /refunds` on timeouts and we issue duplicate refunds. Add idempotency keys."),
      text("assistant", "I added an `Idempotency-Key` header check backed by a unique index. Repeated requests with the same key return the original response instead of creating a second refund.\n\n```ts\nconst existing = await db.refunds.findByKey(req.header(\"Idempotency-Key\"));\nif (existing) return res.status(200).json(existing.response);\n```", { model: "gpt-5-codex", tool_calls: [
        tool("apply_patch", "src/routes/refunds.ts", "1 file changed, 38 insertions(+)"),
        tool("shell", "pnpm test refunds", "Tests: 22 passed, 22 total"),
      ] }),
      text("user", "Keys should expire after 24 hours."),
      text("assistant", "Done. A nightly job deletes keys older than 24 hours, and the migration adds an index on `created_at` so the sweep stays cheap.", { model: "gpt-5-codex" }),
    ],
  },
  {
    title: "Fix hydration mismatch on the product grid", agent: "cursor", project: projects.web, model: "claude-sonnet-5", ago: 9 * HOUR,
    messages: [
      text("user", "React warns about a hydration mismatch on `/products`. It only happens in production."),
      text("assistant", "The grid formats prices with `toLocaleString()` without a locale, so the server (UTC, `en-US`) and the browser render different strings. Passing the store's locale and currency fixes it:\n\n```tsx\nnew Intl.NumberFormat(store.locale, { style: \"currency\", currency: store.currency }).format(price)\n```", { model: "claude-sonnet-5" }),
    ],
  },
  {
    title: "Terraform plan shows drift on the CDN distribution", agent: "gemini", project: projects.infra, model: "gemini-3-pro", ago: 1 * DAY,
    messages: [
      text("user", "Every `terraform plan` wants to update the CDN distribution even when nothing changed."),
      text("assistant", "The provider normalises header names to lowercase, but the config lists `X-Request-Id`. Terraform sees a diff on every plan. Lowercasing the header in `cdn.tf` makes the plan clean.", { model: "gemini-3-pro", tool_calls: [tool("run_shell_command", "terraform plan -target=module.cdn", "No changes. Your infrastructure matches the configuration.")] }),
    ],
  },
  {
    title: "Evaluate the new ranking model against last week's baseline", agent: "opencode", project: projects.ml, model: "claude-sonnet-5", ago: 1.4 * DAY,
    messages: [
      text("user", "Compare `ranker-v7` with the baseline on the held-out set."),
      text("assistant", "| Metric | Baseline | v7 |\n| --- | ---: | ---: |\n| NDCG@10 | 0.412 | 0.437 |\n| MRR | 0.388 | 0.401 |\n| p95 latency | 41 ms | 44 ms |\n\nv7 improves ranking quality by about 6% with a 3 ms latency cost.", { model: "claude-sonnet-5" }),
    ],
  },
  {
    title: "Add remote host sync over SSH", agent: "claude-code", project: projects.ronda, model: "claude-opus-5", ago: 2 * DAY,
    messages: [
      text("user", "I run agents on a build box too. Can Ronda index those sessions?"),
      text("assistant", "Yes. Ronda mirrors an allowlist of session paths with `rsync` into its own data directory and indexes that mirror, so remote files are never modified.\n\n1. Add an SSH alias under **Settings → Remote hosts**.\n2. Make sure SSH connects without prompts.\n3. Press **Sync now**.", { model: "claude-opus-5" }),
    ],
  },
  {
    title: "Rate limiter drops bursts at the minute boundary", agent: "qoder", project: projects.api, model: "qwen3-coder", ago: 3 * DAY,
    messages: [
      text("user", "Customers hit 429s right after the minute rolls over."),
      text("assistant", "The fixed-window limiter resets all counters at `:00`, so synchronized clients burst together. A sliding-window log smooths it out without extra infrastructure.", { model: "qwen3-coder" }),
    ],
  },
  {
    title: "Migrate settings storage to Tauri 2 preferences", agent: "pi", project: projects.ronda, model: "claude-sonnet-5", ago: 4 * DAY,
    messages: [
      text("user", "Move theme and language settings off localStorage."),
      text("assistant", "Preferences now live in the index database through `get_pref` and `set_pref`, so the CLI and desktop app share them.", { model: "claude-sonnet-5" }),
    ],
  },
];

const extraTitles: [string, AgentId, string][] = [
  ["Write the MCP server README", "claude-code", projects.ronda],
  ["Speed up cold start of the checkout page", "cursor", projects.web],
  ["Rotate database credentials without downtime", "codex", projects.infra],
  ["Explain flaky watcher test on Linux", "gemini", projects.ronda],
  ["Add webhook signature verification", "codex", projects.api],
  ["Tune batch size for embedding job", "opencode", projects.ml],
  ["Replace moment.js with date-fns", "cursor", projects.web],
  ["Kubernetes readiness probe keeps failing", "kiro", projects.infra],
  ["Draft release notes for 0.1.0", "claude-code", projects.ronda],
  ["Snapshot tests for invoice PDFs", "copilot", projects.api],
  ["Profile memory growth in the indexer", "codex", projects.ronda],
  ["Accessible focus states for the cart drawer", "claude-code", projects.web],
  ["Backfill missing feature flags", "qoder", projects.ml],
  ["Nightly cost report for the GPU pool", "gemini", projects.infra],
];

let sessions: SessionMeta[] = [];
const transcripts = new Map<string, TranscriptMessage[]>();
let prefs = new Map<string, string>();
let hosts: { host: string; enabled: boolean; last_sync_ms: number | null; last_error: string | null }[] = [];

function meta(key: string, title: string, agent: AgentId, project: string, model: string, updated: number, index: number): SessionMeta {
  return {
    key, native_id: key.split(":")[1], agent, host: null, parent_key: null, title, project_path: project,
    source_path: `${project}/.sessions/${key}.jsonl`, created_at: updated - HOUR, updated_at: updated, model, source: "cli",
    tokens: 4_000 + index * 1_731, archived: false, metadata_only: false, can_delete: true, starred: index % 6 === 0, pinned: index === 1,
  };
}

function reset() {
  sessions = [];
  transcripts.clear();
  prefs = new Map();
  hosts = [{ host: "buildbox", enabled: true, last_sync_ms: now - 3 * HOUR, last_error: null }];
  scripts.forEach((script, index) => {
    const key = `${script.agent}:demo-${index}`;
    const updated = now - script.ago;
    sessions.push(meta(key, script.title, script.agent, script.project, script.model, updated, index));
    transcripts.set(key, script.messages.map((message, seq) => ({ ...message, seq, timestamp: updated - (script.messages.length - seq) * 90_000 })));
  });
  extraTitles.forEach(([title, agent, project], offset) => {
    const index = scripts.length + offset;
    const key = `${agent}:demo-${index}`;
    const updated = now - (4.5 + offset * 0.9) * DAY;
    sessions.push(meta(key, title, agent, project, agent === "codex" ? "gpt-5-codex" : "claude-sonnet-5", updated, index));
    transcripts.set(key, [
      { ...text("user", `${title}.`), seq: 0, timestamp: updated - 120_000 },
      { ...text("assistant", "This is a sample session on the Ronda site. Open **Make session search handle code fragments and any language** at the top of the list for a full transcript.", { model: "claude-sonnet-5" }), seq: 1, timestamp: updated },
    ]);
  });
  sessions.sort((a, b) => b.updated_at - a.updated_at);
}

function listSessions(query: SessionQuery) {
  return sessions.filter(session => (!query.agent || session.agent === query.agent)
    && (!query.project_path || session.project_path === query.project_path)
    && (!query.starred_only || session.starred)
    && (query.include_archived || !session.archived))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at - a.updated_at);
}

function listProjects(): ProjectInfo[] {
  const grouped = new Map<string, ProjectInfo>();
  for (const session of sessions) {
    const path = session.project_path!;
    const current = grouped.get(path) ?? { path, session_count: 0, updated_at: 0 };
    grouped.set(path, { path, session_count: current.session_count + 1, updated_at: Math.max(current.updated_at, session.updated_at) });
  }
  return [...grouped.values()].sort((a, b) => b.updated_at - a.updated_at);
}

function search(query: string, filter: SessionQuery, limit: number): SearchHit[] {
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const session of listSessions({ ...filter, include_archived: true })) {
    for (const message of transcripts.get(session.key) ?? []) {
      const at = message.text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const start = Math.max(0, at - 48);
      const snippet = `${start ? "…" : ""}${message.text.slice(start, at + needle.length + 72).replace(/\s+/g, " ")}…`;
      hits.push({ session, seq: message.seq, snippet });
      break;
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

function insights() {
  const activity: [string, number][] = [];
  for (let day = 0; day < 365; day++) {
    const date = new Date(now - day * DAY);
    const weekday = date.getDay();
    const wave = Math.sin(day / 11) * 3 + Math.sin(day / 3.1) * 2 + (weekday === 0 || weekday === 6 ? -3 : 2);
    const count = Math.max(0, Math.round(wave + ((day * 7919) % 5)));
    if (count) activity.push([`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`, count]);
  }
  const prompts = activity.reduce((sum, [, count]) => sum + count, 0);
  const row = (label: string, weight: number) => ({ label, sessions: Math.round(412 * weight), prompts: Math.round(prompts * weight), tokens: Math.round(61_000_000 * weight) });
  return {
    sessions: 1_284, prompts, tokens: 61_400_000, activity,
    hours: Array.from({ length: 24 }, (_, hour) => [hour, Math.max(2, Math.round(46 + 38 * Math.sin((hour - 8) / 3.6)))]),
    agents: [row("claude-code", 0.41), row("codex", 0.24), row("cursor", 0.14), row("gemini", 0.09), row("opencode", 0.07), row("qoder", 0.05)],
    projects: [row("ronda", 0.36), row("payments-api", 0.24), row("storefront", 0.19), row("infra", 0.12), row("ranker", 0.09)],
    models: [row("claude-opus-5", 0.38), row("gpt-5-codex", 0.26), row("claude-sonnet-5", 0.22), row("gemini-3-pro", 0.09), row("qwen3-coder", 0.05)],
  };
}

function intelligence(args: Args) {
  // Sample figures for the Intelligence view; the range and project filters scale them so the controls respond.
  const span = args.since == null ? 3 : now - (args.since as number) > 8 * DAY ? 1 : 0.28;
  const project = args.project as string | null;
  const scale = span * (project ? 0.35 : 1);
  const n = (value: number) => Math.max(1, Math.round(value * scale));
  const ms = (hoursValue: number) => Math.round(hoursValue * HOUR * scale);
  const evidence = (index: number, seq = 1) => {
    const session = sessions.find(item => item.key.endsWith(`:demo-${index}`))!;
    return { session_key: session.key, seq, title: session.title };
  };
  return {
    since: args.since ?? null, project,
    totals: { sessions: n(142), active_ms: ms(61), recovery_ms: ms(8.5), tool_calls: n(4_310), tool_errors: n(212), failed_sessions: n(18), recurring_bugs: n(7) },
    time: [
      { category: "features", label: "Building features", sessions: n(51), active_ms: ms(23.2) },
      { category: "bugs", label: "Fixing bugs", sessions: n(38), active_ms: ms(16.5) },
      { category: "refactoring", label: "Refactoring", sessions: n(14), active_ms: ms(6.7) },
      { category: "tests", label: "Writing tests", sessions: n(9), active_ms: ms(3.7) },
      { category: "setup", label: "Setup and config", sessions: n(7), active_ms: ms(2.4) },
    ],
    failures: [
      { pattern: "edit_loop", label: "Edit loop: the same file edited five or more times around errors", sessions: n(14), evidence: [evidence(2, 1), evidence(6, 1)] },
      { pattern: "context_exhausted", label: "Context filled up and was compacted", sessions: n(9), evidence: [evidence(0, 2)] },
      { pattern: "tests_failing_at_end", label: "Session ended with tests still failing", sessions: n(8), evidence: [evidence(1, 1)] },
      { pattern: "permission_stall", label: "Blocked by a denied or rejected tool call", sessions: n(6), evidence: [evidence(3, 1)] },
    ],
    recurring: [
      { signature: "a1", message: "Error: Hydration failed because the server rendered HTML didn't match the client", sessions: n(4), agents: ["claude-code", "cursor"], projects: [projects.web], first_seen: now - 20 * DAY, last_seen: now - 9 * HOUR, came_back: true, evidence: [evidence(2, 1)] },
      { signature: "a2", message: "SqliteFailure(Error { code: DatabaseBusy }, Some(\"database is locked\"))", sessions: n(3), agents: ["claude-code", "pi"], projects: [projects.ronda], first_seen: now - 12 * DAY, last_seen: now - 2 * DAY, came_back: false, evidence: [evidence(5, 1)] },
      { signature: "a3", message: "Error: Command not found: plugin:updater|check", sessions: n(3), agents: ["codex", "claude-code"], projects: [projects.ronda], first_seen: now - 9 * DAY, last_seen: now - 4 * DAY, came_back: false, evidence: [evidence(7, 1)] },
    ].slice(0, project ? 1 : 3),
    stack: [
      { tech: "TypeScript", sessions: n(102), share: 72, new: false }, { tech: "Rust", sessions: n(58), share: 41, new: false },
      { tech: "React", sessions: n(54), share: 38, new: false }, { tech: "SQLite", sessions: n(31), share: 22, new: false },
      { tech: "Bun", sessions: n(17), share: 12, new: false }, { tech: "Tauri", sessions: n(9), share: 6, new: span < 1 },
    ],
    outcomes: [
      { outcome: "committed", label: "committed", sessions: n(82), active_ms: ms(31) },
      { outcome: "uncommitted", label: "edited, not committed", sessions: n(34), active_ms: ms(19) },
      { outcome: "failed", label: "ended failing", sessions: n(18), active_ms: ms(9) },
      { outcome: "no_changes", label: "no file changes", sessions: n(8), active_ms: ms(2) },
    ],
    coverage: [{ agent: "claude-code", sessions: n(60), with_tools: n(60), with_time: n(60) }, { agent: "codex", sessions: n(40), with_tools: n(40), with_time: n(40) }],
    callouts: [
      `Recovering from failing commands took ${Math.round(8.5 * scale * 10) / 10} h (14% of active time), more than writing tests and setup combined.`,
      "Sessions that ended failing ran 2.3× longer than committed ones.",
      "“Error: Hydration failed because the server rendered HTML didn't match the client” came back after a session that committed a fix.",
    ],
  };
}

type Args = Record<string, unknown>;

function handle(command: string, args: Args = {}): unknown {
  switch (command) {
    case "get_pref": return prefs.get(args.key as string) ?? null;
    case "set_pref": prefs.set(args.key as string, args.value as string); return null;
    case "list_sessions": return listSessions(args.query as SessionQuery);
    case "list_projects": return listProjects();
    case "get_transcript": return transcripts.get(args.key as string) ?? [];
    case "search_sessions": return search(args.query as string, args.filter as SessionQuery, args.limit as number);
    case "scan": return { discovered: sessions.length, indexed: 0, unchanged: sessions.length, errors: [] };
    case "set_session_flags":
      sessions = sessions.map(session => session.key === args.key ? { ...session, starred: args.starred as boolean, pinned: args.pinned as boolean } : session);
      return null;
    case "trash_session": sessions = sessions.filter(session => session.key !== args.key); return null;
    case "resume_session": return "claude --resume demo";
    case "export_session": return null;
    case "get_insights": return insights();
    case "get_intelligence": return intelligence(args);
    case "get_session": return sessions.find(session => session.key === args.key) ?? null;
    case "list_locations": return [
      { agent: "claude-code", path: "/Users/you/.claude/projects", enabled: true, custom: false },
      { agent: "codex", path: "/Users/you/.codex/sessions", enabled: true, custom: false },
      { agent: "cursor", path: "/Users/you/.cursor/chats", enabled: true, custom: false },
      { agent: "gemini", path: "/Users/you/.gemini/tmp", enabled: false, custom: false },
    ];
    case "list_remote_hosts": return hosts;
    case "set_remote_host": {
      const existing = hosts.find(item => item.host === args.host);
      if (existing) existing.enabled = args.enabled as boolean;
      else hosts.push({ host: args.host as string, enabled: true, last_sync_ms: null, last_error: null });
      return null;
    }
    case "remove_remote_host": hosts = hosts.filter(item => item.host !== args.host); return null;
    case "sync_remote_host": hosts = hosts.map(item => item.host === args.host ? { ...item, last_sync_ms: Date.now() } : item); return null;
    case "app_paths": return ["/Applications/Ronda.app/Contents/MacOS/ronda-mcp", "/Applications/Ronda.app/Contents/MacOS/ronda-cli", "/Users/you/Library/Application Support/ronda/ronda.db"];
    case "check_updates": return "https://github.com/tryronda/ronda/releases";
    default: return null; // plugin:event|listen, plugin:dialog|save, plugin:window|* and friends
  }
}

let installed = false;

/** Install the demo backend. Safe to call more than once. */
export function installDemoBackend() {
  if (installed) return;
  installed = true;
  reset();
  mockWindows("main");
  mockIPC((command, args) => handle(command, args as Args));
}

export function uninstallDemoBackend() {
  if (!installed) return;
  installed = false;
  clearMocks();
}
