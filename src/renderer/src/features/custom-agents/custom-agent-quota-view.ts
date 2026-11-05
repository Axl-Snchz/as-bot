import type { CustomAgentQuota, CustomAgentQuotaError } from "@openbot/contracts/ipc";
import { type PlanLimitTone, usageTone } from "@openbot/team-client/plan-limits";

export interface CustomAgentQuotaReadyView {
  state: "ready";
  entitlementCredits: number;
  usedCredits: number;
  overageCredits: number;
  remainingCredits: number;
  usedPercent: number;
  ringPercent: number;
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

function localYearMonthParts(nowMs: number, timeZone: string): { year: number; month: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
  });
  const parts = formatter.formatToParts(new Date(nowMs));
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    const now = new Date(nowMs);
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  }
  return { year, month };
}

function localDateParts(atMs: number, timeZone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(new Date(atMs));
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "NaN"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "NaN"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "NaN"),
  };
}

function utcMsForLocalDayOne(year: number, month1Based: number, timeZone: string): number {
  for (let hour = 0; hour < 24; hour += 1) {
    const candidate = Date.UTC(year, month1Based - 1, 1, hour);
    const parts = localDateParts(candidate, timeZone);
    if (parts.year === year && parts.month === month1Based && parts.day === 1) return candidate;
  }
  return Date.UTC(year, month1Based - 1, 1);
}

function nextMonthlyResetEstimateMs(nowMs: number, timeZone: string): number {
  const { year, month } = localYearMonthParts(nowMs, timeZone);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return utcMsForLocalDayOne(nextYear, nextMonth, timeZone);
}

function resetInfo(
  resetDate: string | null | undefined,
  nowMs: number,
  timeZone: string,
): { resetAtMs: number; resetEstimated: boolean } {
  const reported = parseFutureResetMs(resetDate, nowMs);
  return reported === null
    ? { resetAtMs: nextMonthlyResetEstimateMs(nowMs, timeZone), resetEstimated: true }
    : { resetAtMs: reported, resetEstimated: false };
}

export function customAgentQuotaView(
  quota: CustomAgentQuota | undefined,
  nowMs = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
): CustomAgentQuotaView | undefined {
  if (!quota) return undefined;
  if (quota.state === "no-data") return { state: "no-data" };
  if (quota.state === "error") return { state: "error", messageKey: quota.messageKey };
  const entitlement = quota.entitlementCredits;
  const usedPercent = entitlement > 0 ? (quota.usedCredits / entitlement) * 100 : 0;
  const remainingPercent = entitlement > 0 ? ((entitlement - quota.usedCredits) / entitlement) * 100 : 0;
  const reset = resetInfo(quota.resetDate, nowMs, timeZone);
  return {
    state: "ready",
    entitlementCredits: quota.entitlementCredits,
    usedCredits: quota.usedCredits,
    overageCredits: quota.overageCredits,
    remainingCredits: quota.remainingCredits,
    usedPercent,
    ringPercent: clampPercent(usedPercent),
    tone: usageTone(remainingPercent),
    creditUsd: quota.creditUsd,
    entitlementUsd: quota.entitlementCredits * quota.creditUsd,
    usedUsd: quota.usedCredits * quota.creditUsd,
    overageUsd: quota.overageCredits * quota.creditUsd,
    remainingUsd: quota.remainingCredits * quota.creditUsd,
    resetAtMs: reset.resetAtMs,
    resetEstimated: reset.resetEstimated,
  };
}
