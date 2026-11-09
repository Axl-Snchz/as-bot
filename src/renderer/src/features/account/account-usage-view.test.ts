// @vitest-environment node

import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import { describe, expect, it } from "vitest";

describe("accountUsageProviderRows Copilot mapping", () => {
  it("maps Copilot monthly usage to whole remaining percent", () => {
    const rows = accountUsageProviderRows({
      limits: [
        {
          id: "copilot",
          primary: { usedPercent: 98, windowDurationMins: 43_200, resetsAt: 2_000_000_000 },
          secondary: null,
        },
      ],
    });

    const copilot = rows.find((row) => row.provider === "copilot");
    expect(copilot).toBeDefined();
    expect(copilot?.remainingPercent).toBe(2);
    expect(copilot?.windows[0]?.label).toBe("Monthly");
    expect(copilot?.windows[0]?.remainingPercent).toBe(2);
    expect(copilot?.reportsUsage).toBe(true);
  });

  it("keeps Copilot as usage-reporting when the provider is available but has no limit data", () => {
    const rows = accountUsageProviderRows({ limits: [] }, [{ id: "copilot", state: "available" }]);

    const copilot = rows.find((row) => row.provider === "copilot");
    expect(copilot).toBeDefined();
    expect(copilot?.windows).toEqual([]);
    expect(copilot?.remainingPercent).toBeNull();
    expect(copilot?.reportsUsage).toBe(true);
  });
});
