import type { CustomAgentSummary } from "@openbot/contracts/ipc";

const COPILOT_COMMANDS = new Set(["copilot", "copilot-enterprise"]);
const EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat", ".com", ".ps1"];

/** The command name on disk, normalized for Copilot detection. */
export function customAgentCommandBasename(command: string): string {
  const normalized = command.trim().replace(/\\/gu, "/");
  const slash = normalized.lastIndexOf("/");
  const base = (slash >= 0 ? normalized.slice(slash + 1) : normalized).toLowerCase();
  for (const extension of EXECUTABLE_EXTENSIONS) {
    if (base.endsWith(extension)) return base.slice(0, -extension.length);
  }
  return base;
}

/** Copilot custom agents are matched by command basename, never by display name. */
export function isCopilotCustomAgent(agent: Pick<CustomAgentSummary, "command" | "resolvedCommand">): boolean {
  if (COPILOT_COMMANDS.has(customAgentCommandBasename(agent.command))) return true;
  return Boolean(agent.resolvedCommand && COPILOT_COMMANDS.has(customAgentCommandBasename(agent.resolvedCommand)));
}
