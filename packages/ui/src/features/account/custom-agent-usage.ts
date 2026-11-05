import type { CustomAgentQuotaError } from "@openbot/contracts/ipc";
import type { TextValue } from "../../text";
import type { AccountUsageProviderRow, AccountUsageTone } from "./account-usage-view";
import { formatUsageReset } from "./account-usage-view";

type UsageText = Pick<TextValue, "t" | "format">;

export interface CustomAgentUsageQuotaReady {
  state: "ready";
  remainingPercent: number;
  tone: AccountUsageTone;
  resetAtMs: number;
}

export type CustomAgentUsageQuota =
  | CustomAgentUsageQuotaReady
  | { state: "no-data" }
  | { state: "error"; messageKey: CustomAgentQuotaError["messageKey"] };

/** One saved custom agent row that can carry Copilot quota. */
export interface CustomAgentUsageRow {
  id: string;
  name: string;
  providerLogo: "acp" | "copilot";
  usageText?: string | undefined;
  quota?: CustomAgentUsageQuota | undefined;
}

/** The usage row view for a Copilot custom agent, in the same shape as provider usage rows. */
export function customAgentCopilotUsageRow(row: CustomAgentUsageRow, text: UsageText): AccountUsageProviderRow | null {
  if (row.providerLogo !== "copilot") return null;
  const quota = row.quota?.state === "ready" ? row.quota : null;
  if (!quota) return null;
  const displayRemainingPercent = Math.round(quota.remainingPercent);
  const resetsAt = Number.isFinite(quota.resetAtMs) ? Math.floor(quota.resetAtMs / 1_000) : null;
  const monthlyWindow = {
    label: text.t("account.usage.window.monthly"),
    remainingPercent: displayRemainingPercent,
    tone: quota.tone,
    resetsAt,
    resetsAtLabel: formatUsageReset(resetsAt, text),
  };
  return {
    provider: "acp",
    logo: "copilot",
    accountId: row.id,
    name: row.name,
    remainingPercent: displayRemainingPercent,
    tone: quota.tone,
    windows: [monthlyWindow],
    ringWindows: [monthlyWindow],
    reportsUsage: true,
    sharedQuotaWith: null,
  };
}
