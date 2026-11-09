import type { AgentProviderStatus } from "@openbot/contracts/ipc";
import type { AccountUsageProviderRow } from "./account-usage-view";
import type { CustomAgentUsageRow } from "./custom-agent-usage";

/** Built-in Copilot wins over custom Copilot usage when it is available and not turned off. */
export function isBuiltInCopilotUsagePreferred(providers: readonly AgentProviderStatus[] | undefined): boolean {
  const copilot = providers?.find((provider) => provider.id === "copilot");
  return Boolean(copilot && !copilot.off && copilot.state === "available");
}

/** Built-in Copilot rows show only while built-in usage is preferred, including no-data neutral state. */
export function dedupeCopilotUsageRows(
  rows: readonly AccountUsageProviderRow[] | undefined,
  preferBuiltInCopilotUsage: boolean,
): readonly AccountUsageProviderRow[] {
  if (!rows) return [];
  return rows.filter((row) => {
    if (!row.reportsUsage) return false;
    if (row.provider === "copilot") return preferBuiltInCopilotUsage;
    return row.windows.length > 0;
  });
}

/** Hide custom Copilot usage rows while built-in Copilot usage is preferred. */
export function dedupeCopilotCustomUsageRows<T extends CustomAgentUsageRow>(
  rows: readonly T[] | undefined,
  preferBuiltInCopilotUsage: boolean,
): readonly T[] {
  if (!rows) return [];
  if (preferBuiltInCopilotUsage) return rows.filter((row) => row.providerLogo !== "copilot");
  const firstReadyCopilot = rows.findIndex((row) => row.providerLogo === "copilot" && row.quota?.state === "ready");
  const firstCopilot = rows.findIndex((row) => row.providerLogo === "copilot");
  const keptCopilot = firstReadyCopilot >= 0 ? firstReadyCopilot : firstCopilot;
  return rows.filter((row, index) => row.providerLogo !== "copilot" || index === keptCopilot);
}
