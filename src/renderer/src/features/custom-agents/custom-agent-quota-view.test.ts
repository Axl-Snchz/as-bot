// @vitest-environment node

import { describe, expect, it } from "vitest";
import { customAgentQuotaView } from "./custom-agent-quota-view";

const NOW_MS = Date.parse("2026-11-04T18:37:13.559-06:00");

describe("customAgentQuotaView", () => {
  it("computes authoritative remaining percent, dollars and neutral tone from counters", () => {
    const quota = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 250_000,
        usedCredits: 4_250,
        overageCredits: 0,
        remainingCredits: 245_750,
        remainingPercentage: 98.3,
        resetDate: "2026-12-01T00:00:00.000Z",
        creditUsd: 0.01,
      },
      NOW_MS,
    );

    expect(quota?.state).toBe("ready");
    if (quota?.state !== "ready") throw new Error("Expected ready state");
    expect(quota.usedPercent).toBeCloseTo(1.7, 4);
    expect(quota.remainingPercent).toBeCloseTo(98.3, 4);
    expect(quota.usedUsd).toBeCloseTo(42.5, 6);
    expect(quota.entitlementUsd).toBeCloseTo(2_500, 6);
    expect(quota.tone).toBe("neutral");
    expect(quota.resetEstimated).toBe(false);
    expect(quota.resetAtMs).toBe(Date.parse("2026-12-01T00:00:00.000Z"));
  });

  it("refreshes denominator-driven remaining percent when entitlement changes", () => {
    const first = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 50_000,
        usedCredits: 4_250,
        overageCredits: 0,
        remainingCredits: 45_750,
        remainingPercentage: 91.5,
        resetDate: "2026-12-01T00:00:00.000Z",
        creditUsd: 0.01,
      },
      NOW_MS,
    );
    const next = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 250_000,
        usedCredits: 4_250,
        overageCredits: 0,
        remainingCredits: 245_750,
        remainingPercentage: 98.3,
        resetDate: "2026-12-01T00:00:00.000Z",
        creditUsd: 0.01,
      },
      NOW_MS,
    );

    expect(first?.state).toBe("ready");
    expect(next?.state).toBe("ready");
    if (first?.state !== "ready" || next?.state !== "ready") throw new Error("Expected ready state");
    expect(first.usedPercent).toBeCloseTo(8.5, 4);
    expect(next.usedPercent).toBeCloseTo(1.7, 4);
    expect(first.remainingPercent).toBeCloseTo(91.5, 4);
    expect(next.remainingPercent).toBeCloseTo(98.3, 4);
    expect(first.usedUsd).toBe(next.usedUsd);
    expect(first.entitlementUsd).toBeCloseTo(500, 6);
    expect(next.entitlementUsd).toBeCloseTo(2_500, 6);
  });

  it.each([
    [704, "neutral"],
    [706, "warning"],
    [904, "warning"],
    [906, "critical"],
  ] as const)("uses the displayed whole-percent tone for %s used credits", (usedCredits, tone) => {
    const quota = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 1_000,
        usedCredits,
        overageCredits: 0,
        remainingCredits: 1_000 - usedCredits,
        remainingPercentage: (1 - usedCredits / 1_000) * 100,
        resetDate: null,
        creditUsd: 0.01,
      },
      NOW_MS,
    );
    expect(quota?.state).toBe("ready");
    if (quota?.state !== "ready") throw new Error("Expected ready state");
    expect(quota.tone).toBe(tone);
  });

  it("estimates day-one reset for missing or past reset dates", () => {
    const missing = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 250_000,
        usedCredits: 0,
        overageCredits: 0,
        remainingCredits: 250_000,
        remainingPercentage: 100,
        resetDate: null,
        creditUsd: 0.01,
      },
      NOW_MS,
    );
    const past = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 250_000,
        usedCredits: 0,
        overageCredits: 0,
        remainingCredits: 250_000,
        remainingPercentage: 100,
        resetDate: "2026-11-01T00:00:00.000Z",
        creditUsd: 0.01,
      },
      NOW_MS,
    );

    expect(missing?.state).toBe("ready");
    expect(past?.state).toBe("ready");
    if (missing?.state !== "ready" || past?.state !== "ready") throw new Error("Expected ready state");
    expect(missing.resetEstimated).toBe(true);
    expect(past.resetEstimated).toBe(true);
    expect(missing.resetAtMs).toBe(Date.parse("2026-12-01T00:00:00.000Z"));
    expect(past.resetAtMs).toBe(Date.parse("2026-12-01T00:00:00.000Z"));
  });

  it("handles overage, zero usage, and error/no-data states", () => {
    const overage = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 2_500,
        usedCredits: 2_800,
        overageCredits: 300,
        remainingCredits: 0,
        remainingPercentage: 0,
        resetDate: "2026-12-01T00:00:00.000Z",
        creditUsd: 0.01,
      },
      NOW_MS,
    );
    const zero = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 250_000,
        usedCredits: 0,
        overageCredits: 0,
        remainingCredits: 250_000,
        remainingPercentage: 100,
        resetDate: "2026-12-01T00:00:00.000Z",
        creditUsd: 0.01,
      },
      NOW_MS,
    );
    const zeroEntitlementUnused = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 0,
        usedCredits: 0,
        overageCredits: 0,
        remainingCredits: 0,
        remainingPercentage: 100,
        resetDate: "2026-12-01T00:00:00.000Z",
        creditUsd: 0.01,
      },
      NOW_MS,
    );
    const zeroEntitlementUsed = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 0,
        usedCredits: 15,
        overageCredits: 15,
        remainingCredits: 0,
        remainingPercentage: 0,
        resetDate: "2026-12-01T00:00:00.000Z",
        creditUsd: 0.01,
      },
      NOW_MS,
    );
    const noData = customAgentQuotaView({ state: "no-data" }, NOW_MS);
    const error = customAgentQuotaView({ state: "error", messageKey: "account.usage.value.unavailable" }, NOW_MS);

    expect(overage?.state).toBe("ready");
    if (overage?.state !== "ready") throw new Error("Expected ready state");
    expect(overage.usedPercent).toBeCloseTo(112, 4);
    expect(overage.remainingPercent).toBe(0);
    expect(overage.overageCredits).toBe(300);
    expect(overage.overageUsd).toBeCloseTo(3, 6);
    expect(overage.tone).toBe("critical");

    expect(zero?.state).toBe("ready");
    if (zero?.state !== "ready") throw new Error("Expected ready state");
    expect(zero.usedPercent).toBe(0);
    expect(zero.remainingPercent).toBe(100);
    expect(zeroEntitlementUnused?.state).toBe("ready");
    expect(zeroEntitlementUsed?.state).toBe("ready");
    if (zeroEntitlementUnused?.state !== "ready" || zeroEntitlementUsed?.state !== "ready")
      throw new Error("Expected ready state");
    expect(zeroEntitlementUnused.remainingPercent).toBe(100);
    expect(zeroEntitlementUsed.remainingPercent).toBe(0);

    expect(noData).toEqual({ state: "no-data" });
    expect(error).toEqual({ state: "error", messageKey: "account.usage.value.unavailable" });
  });

  it("keeps UTC day-1 estimate while local formatting can show previous day", () => {
    const estimated = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 250_000,
        usedCredits: 0,
        overageCredits: 0,
        remainingCredits: 250_000,
        remainingPercentage: 100,
        resetDate: null,
        creditUsd: 0.01,
      },
      NOW_MS,
    );

    expect(estimated?.state).toBe("ready");
    if (estimated?.state !== "ready") throw new Error("Expected ready state");
    expect(estimated.resetAtMs).toBe(Date.parse("2026-12-01T00:00:00.000Z"));
    const localText = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Mexico_City",
    }).format(new Date(estimated.resetAtMs));
    expect(localText).toBe("Nov 30, 18:00");
  });

  it("rolls estimate from UTC December to UTC January while local time can stay on Dec 31", () => {
    const nearUtcYearEnd = Date.parse("2026-12-31T23:50:00.000Z");
    const estimated = customAgentQuotaView(
      {
        state: "ready",
        entitlementCredits: 250_000,
        usedCredits: 0,
        overageCredits: 0,
        remainingCredits: 250_000,
        remainingPercentage: 100,
        resetDate: null,
        creditUsd: 0.01,
      },
      nearUtcYearEnd,
    );

    expect(estimated?.state).toBe("ready");
    if (estimated?.state !== "ready") throw new Error("Expected ready state");
    expect(estimated.resetAtMs).toBe(Date.parse("2027-01-01T00:00:00.000Z"));
    const mexicoDate = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Mexico_City",
    }).format(new Date(estimated.resetAtMs));
    expect(mexicoDate).toBe("Dec 31, 2026, 18:00");
  });
});
