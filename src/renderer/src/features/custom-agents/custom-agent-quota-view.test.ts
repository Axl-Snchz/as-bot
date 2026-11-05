// @vitest-environment node

import { describe, expect, it } from "vitest";
import { customAgentQuotaView } from "./custom-agent-quota-view";

const NOW_MS = Date.parse("2026-11-04T18:37:13.559-06:00");
const UTC_TZ = "UTC";

describe("customAgentQuotaView", () => {
  it("computes used percent, ring clamp, dollars and neutral tone from counters", () => {
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
      UTC_TZ,
    );

    expect(quota?.state).toBe("ready");
    if (quota?.state !== "ready") throw new Error("Expected ready state");
    expect(quota.usedPercent).toBeCloseTo(1.7, 4);
    expect(quota.ringPercent).toBeCloseTo(1.7, 4);
    expect(quota.usedUsd).toBeCloseTo(42.5, 6);
    expect(quota.entitlementUsd).toBeCloseTo(2_500, 6);
    expect(quota.tone).toBe("neutral");
    expect(quota.resetEstimated).toBe(false);
    expect(quota.resetAtMs).toBe(Date.parse("2026-12-01T00:00:00.000Z"));
  });

  it("refreshes denominator-driven percent when entitlement changes", () => {
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
      UTC_TZ,
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
      UTC_TZ,
    );

    expect(first?.state).toBe("ready");
    expect(next?.state).toBe("ready");
    if (first?.state !== "ready" || next?.state !== "ready") throw new Error("Expected ready state");
    expect(first.usedPercent).toBeCloseTo(8.5, 4);
    expect(next.usedPercent).toBeCloseTo(1.7, 4);
    expect(first.usedUsd).toBe(next.usedUsd);
    expect(first.entitlementUsd).toBeCloseTo(500, 6);
    expect(next.entitlementUsd).toBeCloseTo(2_500, 6);
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
      UTC_TZ,
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
      UTC_TZ,
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
      UTC_TZ,
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
      UTC_TZ,
    );
    const noData = customAgentQuotaView({ state: "no-data" }, NOW_MS, UTC_TZ);
    const error = customAgentQuotaView(
      { state: "error", messageKey: "account.usage.value.unavailable" },
      NOW_MS,
      UTC_TZ,
    );

    expect(overage?.state).toBe("ready");
    if (overage?.state !== "ready") throw new Error("Expected ready state");
    expect(overage.usedPercent).toBeCloseTo(112, 4);
    expect(overage.ringPercent).toBe(100);
    expect(overage.overageCredits).toBe(300);
    expect(overage.overageUsd).toBeCloseTo(3, 6);
    expect(overage.tone).toBe("critical");

    expect(zero?.state).toBe("ready");
    if (zero?.state !== "ready") throw new Error("Expected ready state");
    expect(zero.usedPercent).toBe(0);
    expect(zero.ringPercent).toBe(0);

    expect(noData).toEqual({ state: "no-data" });
    expect(error).toEqual({ state: "error", messageKey: "account.usage.value.unavailable" });
  });

  it("keeps estimated renewal on day 1 for America/Mexico_City formatting", () => {
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
      "America/Mexico_City",
    );

    expect(estimated?.state).toBe("ready");
    if (estimated?.state !== "ready") throw new Error("Expected ready state");
    const dayText = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      timeZone: "America/Mexico_City",
    }).format(new Date(estimated.resetAtMs));
    const shortDate = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "America/Mexico_City",
    }).format(new Date(estimated.resetAtMs));
    expect(dayText).toBe("1");
    expect(shortDate).not.toContain("30");
    expect(shortDate).not.toContain("31");
  });
});
