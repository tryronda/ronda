import { invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen as tauriListen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

/** True inside the desktop shell; false when the frontend runs in a plain browser (e.g. `bun run dev`). */
export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Read-only commands resolve to an empty library in a browser so the UI still renders.
const browserDefaults: Record<string, unknown> = {
  get_pref: null, set_pref: null, list_sessions: [], list_projects: [], search_sessions: [], get_transcript: [],
  list_locations: [], list_remote_hosts: [], check_updates: null, app_paths: ["ronda-mcp", "", ""],
  get_insights: { sessions: 0, prompts: 0, tokens: 0, activity: [], agents: [], projects: [], models: [] },
  get_intelligence: { since: null, project: null, time: [], failures: [], recurring: [], stack: [], outcomes: [], coverage: [], callouts: [],
    totals: { sessions: 0, active_ms: 0, recovery_ms: 0, tool_calls: 0, tool_errors: 0, failed_sessions: 0, recurring_bugs: 0 } },
};

export function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  if (inTauri()) return tauriInvoke<T>(command, args);
  if (command in browserDefaults) return Promise.resolve(structuredClone(browserDefaults[command]) as T);
  return Promise.reject(new Error("This action is available in the Ronda desktop app."));
}

export function listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  return inTauri() ? tauriListen(event, handler) : Promise.resolve(() => {});
}
