import type { AccountUsageProviderRow } from "@openbot/ui/features/account/account-usage-view";
import {
  type CustomAgentUsageRailRow,
  mergePageRailReorderableIds,
  PageRail,
} from "@openbot/ui/features/window/PageRail";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

function usageRow(
  id: AccountUsageProviderRow["provider"],
  name: string,
  remainingPercent: number,
): AccountUsageProviderRow {
  const window = {
    label: "Monthly",
    remainingPercent,
    tone: "neutral" as const,
    resetsAt: null,
    resetsAtLabel: null,
  };
  return {
    provider: id,
    accountId: null,
    name,
    remainingPercent,
    tone: "neutral",
    windows: [window],
    ringWindows: [window],
    reportsUsage: true,
    sharedQuotaWith: null,
  };
}

function labelsInRenderOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLButtonElement>("[data-rail-reorder-id]")]
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((label) => label.length > 0);
}

describe("mergePageRailReorderableIds", () => {
  it("keeps surviving saved ids first, appends new ids, and drops removed ids", () => {
    expect(mergePageRailReorderableIds(["a", "b", "c"], ["c", "a", "x"])).toEqual(["c", "a", "b"]);
  });

  it("drops duplicates from saved order and keeps current order for unknown saved ids", () => {
    expect(mergePageRailReorderableIds(["a", "b", "c"], ["b", "b", "d"])).toEqual(["b", "a", "c"]);
  });
});

describe("PageRail reorder", () => {
  it("reorders with Alt+ArrowUp, keeps focus on the moved button, and announces the move", async () => {
    const usageRows = [usageRow("claude", "Alpha", 88), usageRow("codex", "Beta", 61), usageRow("grok", "Gamma", 47)];
    const customAgentUsage: CustomAgentUsageRailRow[] = [
      { id: "delta", name: "Delta", providerLogo: "acp", usageText: "42 of 250" },
    ];
    const [order, setOrder] = createSignal<readonly string[]>([]);

    const view = render(() => (
      <PageRail
        hidden={false}
        current="agents"
        pinned={[]}
        onPinChange={vi.fn()}
        usageRows={usageRows}
        customAgentUsage={customAgentUsage}
        reorderableOrder={order()}
        onReorderableOrderChange={setOrder}
        onAgents={vi.fn()}
        onRoutines={undefined}
        onWorkflows={undefined}
        onTasks={undefined}
        onSchedule={undefined}
        onUsage={vi.fn()}
        onMarketplace={undefined}
        onSettings={vi.fn()}
        help={<div>help</div>}
      />
    ));

    const beta = screen.getByRole("button", { name: /^Beta usage/u });
    beta.focus();
    fireEvent.keyDown(beta, { key: "ArrowUp", altKey: true });

    await waitFor(() => expect(labelsInRenderOrder(view.container)[0]).toMatch(/^Beta usage/u));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Beta usage/u })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("button", { name: /^Beta usage/u }), { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(labelsInRenderOrder(view.container)[1]).toMatch(/^Beta usage/u));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Beta usage/u })).toHaveFocus());
    expect(screen.getByRole("status").textContent ?? "").toContain("Beta");
  });

  it("keeps keyboard reorder focus durable across repeated moves and boundaries", async () => {
    const usageRows = [usageRow("claude", "Alpha", 88), usageRow("codex", "Beta", 61), usageRow("grok", "Gamma", 47)];
    const [order, setOrder] = createSignal<readonly string[]>([]);

    const view = render(() => (
      <PageRail
        hidden={false}
        current="agents"
        pinned={[]}
        onPinChange={vi.fn()}
        usageRows={usageRows}
        customAgentUsage={[]}
        reorderableOrder={order()}
        onReorderableOrderChange={setOrder}
        onAgents={vi.fn()}
        onRoutines={undefined}
        onWorkflows={undefined}
        onTasks={undefined}
        onSchedule={undefined}
        onUsage={vi.fn()}
        onMarketplace={undefined}
        onSettings={vi.fn()}
        help={<div>help</div>}
      />
    ));

    const gamma = screen.getByRole("button", { name: /^Gamma usage/u });
    gamma.focus();
    fireEvent.keyDown(gamma, { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(labelsInRenderOrder(view.container)[1]).toMatch(/^Gamma usage/u));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Gamma usage/u })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole("button", { name: /^Gamma usage/u }), { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(labelsInRenderOrder(view.container)[0]).toMatch(/^Gamma usage/u));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Gamma usage/u })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole("button", { name: /^Gamma usage/u }), { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(labelsInRenderOrder(view.container)[0]).toMatch(/^Gamma usage/u));
    expect(screen.getByRole("button", { name: /^Gamma usage/u })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("button", { name: /^Gamma usage/u }), { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(labelsInRenderOrder(view.container)[1]).toMatch(/^Gamma usage/u));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Gamma usage/u })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole("button", { name: /^Gamma usage/u }), { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(labelsInRenderOrder(view.container)[2]).toMatch(/^Gamma usage/u));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Gamma usage/u })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole("button", { name: /^Gamma usage/u }), { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(labelsInRenderOrder(view.container)[2]).toMatch(/^Gamma usage/u));
    expect(screen.getByRole("button", { name: /^Gamma usage/u })).toHaveFocus();
  });

  it("suppresses only the drag-gesture click and allows later genuine clicks", async () => {
    vi.useFakeTimers();
    try {
      const onUsage = vi.fn();
      const usageRows = [usageRow("claude", "Alpha", 88), usageRow("codex", "Beta", 61)];
      const customAgentUsage: CustomAgentUsageRailRow[] = [
        { id: "gamma", name: "Gamma", providerLogo: "acp", usageText: "42 of 250" },
      ];
      const [order, setOrder] = createSignal<readonly string[]>([]);
      const dataTransferStore = new Map<string, string>();
      const dataTransfer = {
        setData: vi.fn((type: string, value: string) => {
          dataTransferStore.set(type, value);
        }),
        getData: vi.fn((type: string) => dataTransferStore.get(type) ?? ""),
        effectAllowed: "move",
        dropEffect: "move",
      };

      const view = render(() => (
        <PageRail
          hidden={false}
          current="agents"
          pinned={[]}
          onPinChange={vi.fn()}
          usageRows={usageRows}
          customAgentUsage={customAgentUsage}
          reorderableOrder={order()}
          onReorderableOrderChange={setOrder}
          onAgents={vi.fn()}
          onRoutines={undefined}
          onWorkflows={undefined}
          onTasks={undefined}
          onSchedule={undefined}
          onUsage={onUsage}
          onMarketplace={undefined}
          onSettings={vi.fn()}
          help={<div>help</div>}
        />
      ));

      const gamma = screen.getByRole("button", { name: /^Gamma usage/u });
      const alpha = screen.getByRole("button", { name: /^Alpha usage/u });
      fireEvent.dragStart(gamma, { dataTransfer });
      fireEvent.dragOver(alpha, { dataTransfer });
      fireEvent.drop(alpha, { dataTransfer });
      fireEvent.dragEnd(gamma, { dataTransfer });

      await waitFor(() => expect(labelsInRenderOrder(view.container)[0]).toMatch(/^Gamma usage/u));

      const moved = screen.getByRole("button", { name: /^Gamma usage/u });
      fireEvent.click(moved);
      expect(onUsage).toHaveBeenCalledTimes(0);
      await vi.runAllTimersAsync();
      fireEvent.click(moved);
      expect(onUsage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
