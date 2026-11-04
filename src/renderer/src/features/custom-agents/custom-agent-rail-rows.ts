import type { CustomAgentSummary, CustomAgentUsage } from "@openbot/contracts/ipc";

/** One rail row per saved custom agent. Usage text is present only when a usage answer exists. */
export interface CustomAgentUsageRow {
  id: string;
  name: string;
  usageText?: string | undefined;
}

/** Keeps all saved agents in list order, keyed by id, and maps usage answers when they exist. */
export function customAgentRailRows(
  agents: readonly CustomAgentSummary[],
  usage: readonly CustomAgentUsage[],
): CustomAgentUsageRow[] {
  return agents.map((agent) => {
    const answer = usage.find((row) => row.id === agent.id);
    return { id: agent.id, name: agent.name, usageText: agent.usagePrompt ? answer?.text : undefined };
  });
}
