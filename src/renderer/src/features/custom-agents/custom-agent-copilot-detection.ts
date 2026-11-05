import {
  type CustomAgentSummary,
  isCopilotAgentCommand,
  customAgentCommandBasename as sharedCustomAgentCommandBasename,
} from "@openbot/contracts/ipc";

/** Re-export for renderer tests and callers that use this helper path. */
export const customAgentCommandBasename = sharedCustomAgentCommandBasename;

/** Copilot custom agents are matched by command basename, never by display name. */
export function isCopilotCustomAgent(agent: Pick<CustomAgentSummary, "command" | "resolvedCommand">): boolean {
  return isCopilotAgentCommand(agent.command, agent.resolvedCommand);
}
