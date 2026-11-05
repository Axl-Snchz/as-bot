import { createMemo } from "solid-js";
import { createUsageRefreshPoll } from "../account/usage-refresh-poll";
import { useServers } from "../servers/servers-context";
import { isCopilotCustomAgent } from "./custom-agent-copilot-detection";
import { useCustomAgents } from "./custom-agents-context";

/**
 * Asks each local custom agent that can report usage for its plan usage, for the rail. The list
 * includes prompt-based agents and detected Copilot agents, which report quota through SDK data with
 * no usage prompt.
 */
export function useCustomAgentUsagePolling() {
  const { customAgents, refreshCustomAgentUsage } = useCustomAgents();
  const { activeServer } = useServers();
  const target = createMemo(() => {
    if (activeServer()?.kind !== "local") return null;
    const prompts = customAgents()
      .flatMap((agent) => {
        const entries = agent.usagePrompt ? [`prompt:${agent.id}=${agent.usagePrompt}`] : [];
        if (isCopilotCustomAgent(agent))
          entries.push(`copilot:${agent.id}=${agent.command}\u0000${agent.resolvedCommand ?? ""}`);
        return entries;
      })
      .join("\n");
    return prompts || null;
  });
  createUsageRefreshPoll({
    target,
    refreshAtStart: true,
    refresh: () => void refreshCustomAgentUsage().catch(() => undefined),
  });
}
