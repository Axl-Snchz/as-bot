import type { AccountUsageProviderRow } from "@openbot/ui/features/account/account-usage-view";
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

function copilotUsageButton(): HTMLButtonElement {
  const button = screen.getByRole("button", { name: /Copilot usage/u });
  if (!(button instanceof HTMLButtonElement)) throw new Error("Copilot usage button is not a button element");
  return button;
}

function usageArc(button: HTMLElement): SVGCircleElement | null {
  return button.querySelector<SVGCircleElement>(".window-rail-usage-arc");
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

    const noDataButton = copilotUsageButton();
    expect(noDataButton).toHaveAccessibleName("Copilot usage. Open usage");
    expect(usageArc(noDataButton)).toBeNull();

    setRow({
      id: "copilot-local",
      name: "Copilot",
      providerLogo: "copilot",
      quota: { state: "ready", remainingPercent: 98.3, tone: "neutral", resetAtMs: Date.now() + 60_000 },
    });

    await waitFor(() => expect(copilotUsageButton()).toHaveAccessibleName(/Monthly 98% left/u));
    const readyButton = copilotUsageButton();
    const readyArc = usageArc(readyButton);
    expect(readyArc).not.toBeNull();
    expect(readyArc?.getAttribute("stroke-dasharray")).toBe("98 100");
    expect(readyArc?.getAttribute("stroke-dasharray")).not.toBe("2 100");
    expect(readyArc?.getAttribute("data-usage-tone")).toBe("neutral");
    expect(screen.queryByRole("button", { name: /98\.3% left/u })).not.toBeInTheDocument();

    setRow({
      id: "copilot-local",
      name: "Copilot",
      providerLogo: "copilot",
      quota: { state: "error", messageKey: "account.usage.value.unavailable" },
    });

    await waitFor(() => expect(copilotUsageButton()).toHaveAccessibleName("Copilot usage. Open usage"));
    expect(usageArc(copilotUsageButton())).toBeNull();
  });

  it("keeps shared quota rows under the owner ring and uses the lowest remaining percentage", () => {
    const usageRows: AccountUsageProviderRow[] = [
      {
        provider: "grok",
        accountId: null,
        name: "Grok",
        remainingPercent: 64,
        tone: "neutral",
        windows: [{ label: "Monthly", remainingPercent: 64, tone: "neutral", resetsAt: null, resetsAtLabel: null }],
        ringWindows: [{ label: "Monthly", remainingPercent: 64, tone: "neutral", resetsAt: null, resetsAtLabel: null }],
        reportsUsage: true,
        sharedQuotaWith: null,
      },
      {
        provider: "cursor",
        accountId: null,
        name: "Cursor",
        remainingPercent: 18,
        tone: "critical",
        windows: [{ label: "Monthly", remainingPercent: 18, tone: "critical", resetsAt: null, resetsAtLabel: null }],
        ringWindows: [
          { label: "Monthly", remainingPercent: 18, tone: "critical", resetsAt: null, resetsAtLabel: null },
        ],
        reportsUsage: true,
        sharedQuotaWith: "grok",
      },
    ];

    const { container } = render(() => (
      <PageRail
        hidden={false}
        current="agents"
        pinned={[]}
        onPinChange={vi.fn()}
        usageRows={usageRows}
        customAgentUsage={[]}
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

    const usageButtons = container.querySelectorAll(".window-rail-button.window-rail-usage");
    expect(usageButtons).toHaveLength(1);
    expect(usageButtons[0]?.getAttribute("aria-label")).toMatch(/Grok/u);
    expect(usageButtons[0]?.getAttribute("aria-label")).toMatch(/Cursor/u);
    expect(usageButtons[0]?.querySelector(".window-rail-usage-arc")?.getAttribute("stroke-dasharray")).toBe("18 100");
    expect(usageButtons[0]?.querySelector(".window-rail-usage-arc")?.getAttribute("data-usage-tone")).toBe("critical");
  });
});
