import type { AccountUsage } from "@openbot/contracts/ipc";
import { AccountUsageDetails } from "@openbot/ui/features/account/AccountUsageDetails";
import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

describe("AccountUsageDetails", () => {
  it("renders the built-in provider row with 42% left", () => {
    const usage: AccountUsage = {
      limits: [
        {
          id: "claude",
          primary: { usedPercent: 58, windowDurationMins: 300, resetsAt: 2_000_000_000 },
          secondary: null,
        },
      ],
    };
    const rows = accountUsageProviderRows(usage);

    render(() => (
      <AccountUsageDetails
        rows={rows}
        loading={false}
        error={null}
        refreshActive={false}
        refreshDisabled={false}
        onRefresh={vi.fn()}
        title={<h2 class="account-usage-popover-title">Usage</h2>}
      />
    ));

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("42% left")).toBeVisible();
  });
});
