import type { CustomAgentQuota, CustomAgentQuotaError } from "@openbot/contracts/ipc";
import { type PlanLimitTone, usageTone } from "@openbot/team-client/plan-limits";

export interface CustomAgentQuotaReadyView {
  state: "ready";
  entitlementCredits: number;
  usedCredits: number;
  overageCredits: number;
  remainingCredits: number;
  usedPercent: number;
  remainingPercent: number;
  tone: PlanLimitTone;
  creditUsd: number;
  entitlementUsd: number;
  usedUsd: number;
  overageUsd: number;
  remainingUsd: number;
  resetAtMs: number;
  resetEstimated: boolean;
}

export type CustomAgentQuotaView =
  | CustomAgentQuotaReadyView
  | { state: "no-data" }
  | { state: "error"; messageKey: CustomAgentQuotaError["messageKey"] };

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parseFutureResetMs(resetDate: string | null | undefined, nowMs: number): number | null {
  if (!resetDate) return null;
  const resetAtMs = Date.parse(resetDate);
  if (!Number.isFinite(resetAtMs) || resetAtMs <= nowMs) return null;
  return resetAtMs;
}

function nextMonthlyResetEstimateMs(nowMs: number): number {
  const now = new Date(nowMs);
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  return Date.UTC(nextYear, nextMonth, 1, 0, 0, 0, 0);
}

function resetInfo(
  resetDate: string | null | undefined,
  nowMs: number,
): { resetAtMs: number; resetEstimated: boolean } {
  const reported = parseFutureResetMs(resetDate, nowMs);
  return reported === null
    ? { resetAtMs: nextMonthlyResetEstimateMs(nowMs), resetEstimated: true }
    : { resetAtMs: reported, resetEstimated: false };
}

export function customAgentQuotaView(
  quota: CustomAgentQuota | undefined,
  nowMs = Date.now(),
): CustomAgentQuotaView | undefined {
  if (!quota) return undefined;
  if (quota.state === "no-data") return { state: "no-data" };
  if (quota.state === "error") return { state: "error", messageKey: quota.messageKey };
  const entitlement = quota.entitlementCredits;
  const usedPercent = entitlement > 0 ? (quota.usedCredits / entitlement) * 100 : quota.usedCredits > 0 ? 100 : 0;
  const remainingPercent =
    entitlement > 0
      ? ((entitlement - quota.usedCredits) / entitlement) * 100
      : quota.usedCredits > 0 || quota.overageCredits > 0
        ? 0
        : 100;
  const clampedRemainingPercent = clampPercent(remainingPercent);
  const reset = resetInfo(quota.resetDate, nowMs);
  return {
    state: "ready",
    entitlementCredits: quota.entitlementCredits,
    usedCredits: quota.usedCredits,
    overageCredits: quota.overageCredits,
    remainingCredits: quota.remainingCredits,
    usedPercent,
    remainingPercent: clampedRemainingPercent,
    tone: usageTone(Math.round(clampedRemainingPercent)),
    creditUsd: quota.creditUsd,
    entitlementUsd: quota.entitlementCredits * quota.creditUsd,
    usedUsd: quota.usedCredits * quota.creditUsd,
    overageUsd: quota.overageCredits * quota.creditUsd,
    remainingUsd: quota.remainingCredits * quota.creditUsd,
    resetAtMs: reset.resetAtMs,
    resetEstimated: reset.resetEstimated,
  };
}
