import type { AgentId } from "@/workbench/api";

export const agentNames: Record<AgentId, string> = {
  "claude-code": "Claude Code", codex: "Codex", grok: "Grok Build", dsh: "DeepSeek Harness",
  cursor: "Cursor", opencode: "OpenCode", pi: "Pi", omp: "Oh My Pi", kiro: "Kiro",
  kimi: "Kimi Code", gemini: "Gemini CLI", copilot: "Copilot CLI",
  antigravity: "Antigravity", qoder: "Qoder", hermes: "Hermes", openclaw: "OpenClaw",
  codebuddy: "CodeBuddy", workbuddy: "WorkBuddy",
};

/** Display name for an agent id, falling back to the id itself. */
export function agentName(id: string): string {
  return (agentNames as Record<string, string>)[id] ?? id;
}
