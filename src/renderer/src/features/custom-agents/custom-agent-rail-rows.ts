import type { CustomAgentSummary, CustomAgentUsage } from "@openbot/contracts/ipc";
import { isCopilotCustomAgent } from "./custom-agent-copilot-detection";
import { type CustomAgentQuotaView, customAgentQuotaView } from "./custom-agent-quota-view";

/** One rail row per saved custom agent. Usage text is present only when a usage answer exists. */
export interface CustomAgentUsageRow {
  id: string;
  name: string;
  providerLogo: "acp" | "copilot";
  usageText?: string | undefined;
  quota?: CustomAgentQuotaView | undefined;
}

/** Keeps all saved agents in list order, keyed by id, and maps usage answers when they exist. */
export function customAgentRailRows(
  agents: readonly CustomAgentSummary[],
  usage: readonly CustomAgentUsage[],
  nowMs = Date.now(),
): CustomAgentUsageRow[] {
  return agents.map((agent) => {
    const answer = usage.find((row) => row.id === agent.id);
    const copilot = isCopilotCustomAgent(agent);
    const text = answer?.text.trim() ? answer.text : undefined;
    const quota = customAgentQuotaView(answer?.quota, nowMs);
    return {
      id: agent.id,
      name: agent.name,
      providerLogo: copilot ? "copilot" : "acp",
      usageText: copilot || agent.usagePrompt ? text : undefined,
      quota: copilot && !quota ? { state: "no-data" } : quota,
    };
  });
}
