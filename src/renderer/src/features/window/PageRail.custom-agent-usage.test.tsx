import { type CustomAgentUsageRailRow, PageRail } from "@openbot/ui/features/window/PageRail";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

function renderRail(row: () => CustomAgentUsageRailRow) {
  return render(() => (
    <PageRail
      hidden={false}
      current="agents"
      pinned={[]}
      onPinChange={vi.fn()}
      usageRows={[]}
      customAgentUsage={[row()]}
      onAgents={vi.fn()}
      onRoutines={vi.fn()}
      onWorkflows={vi.fn()}
      onTasks={undefined}
      onSchedule={undefined}
      onUsage={vi.fn()}
      onMarketplace={vi.fn()}
      onSettings={vi.fn()}
      help={<div>help</div>}
    />
  ));
}

describe("PageRail custom Copilot usage", () => {
  it("switches the same mounted button between no-data, ready and error states reactively", async () => {
    const [row, setRow] = createSignal<CustomAgentUsageRailRow>({
      id: "copilot-local",
      name: "Copilot",
      providerLogo: "copilot",
      quota: { state: "no-data" },
    });

    renderRail(row);

    expect(screen.getByRole("button", { name: "Copilot usage. Open usage" })).toBeInTheDocument();

    setRow({
      id: "copilot-local",
      name: "Copilot",
      providerLogo: "copilot",
      quota: { state: "ready", remainingPercent: 98.3, tone: "neutral", resetAtMs: Date.now() + 60_000 },
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Copilot usage: Monthly 98% left\. Open usage/u })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /98\.3% left/u })).not.toBeInTheDocument();

    setRow({
      id: "copilot-local",
      name: "Copilot",
      providerLogo: "copilot",
      quota: { state: "error", messageKey: "account.usage.value.unavailable" },
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Copilot usage. Open usage" })).toBeInTheDocument());
  });
});
