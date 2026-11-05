import type { AccountUsageProviderRow } from "@openbot/ui/features/account/account-usage-view";
import {
  type CustomAgentUsageRailRow,
  mergePageRailPersistedReorderableIds,
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

function namesInRenderOrder(container: HTMLElement): string[] {
  return labelsInRenderOrder(container)
    .map((label) => label.match(/^(.+?) usage/u)?.[1] ?? "")
    .filter((name) => name.length > 0);
}

describe("mergePageRailReorderableIds", () => {
  it("keeps surviving saved ids first, appends new ids, and drops removed ids", () => {
    expect(mergePageRailReorderableIds(["a", "b", "c"], ["c", "a", "x"])).toEqual(["c", "a", "b"]);
  });

  it("drops duplicates from saved order and keeps current order for unknown saved ids", () => {
    expect(mergePageRailReorderableIds(["a", "b", "c"], ["b", "b", "d"])).toEqual(["b", "a", "c"]);
  });
});

describe("mergePageRailPersistedReorderableIds", () => {
  it("keeps hidden saved ids in place when visible ids are reordered", () => {
    expect(mergePageRailPersistedReorderableIds(["a", "b", "c"], ["a", "c"], ["c", "a"])).toEqual(["c", "b", "a"]);
  });

  it("keeps hidden ids while inserting new visible ids", () => {
    expect(mergePageRailPersistedReorderableIds(["a", "b", "c"], ["a", "c", "d"], ["d", "c", "a"])).toEqual([
      "d",
      "b",
      "c",
      "a",
    ]);
  });
});

describe("PageRail reorder", () => {
  it("keeps drag source and target button nodes connected during drag-over updates", async () => {
    const usageRows = [usageRow("claude", "Alpha", 88), usageRow("codex", "Beta", 61), usageRow("grok", "Gamma", 47)];
    const customAgentUsage: CustomAgentUsageRailRow[] = [
      { id: "delta", name: "Delta", providerLogo: "acp", usageText: "42 of 250" },
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

    render(() => (
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

    const source = screen.getByRole("button", { name: /^Gamma usage/u });
    const target = screen.getByRole("button", { name: /^Alpha usage/u });

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });

    const sourceAfter = screen.getByRole("button", { name: /^Gamma usage/u });
    const targetAfter = screen.getByRole("button", { name: /^Alpha usage/u });
    expect(sourceAfter).toBe(source);
    expect(targetAfter).toBe(target);
    expect(sourceAfter.isConnected).toBe(true);
    expect(targetAfter.isConnected).toBe(true);
  });

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

  it("keeps uncontrolled local order across entry changes, including hidden ids and appended new ids", async () => {
    const [usageRows, setUsageRows] = createSignal([usageRow("claude", "Alpha", 88), usageRow("codex", "Beta", 61)]);
    const [customAgentUsage, setCustomAgentUsage] = createSignal<CustomAgentUsageRailRow[]>([
      { id: "gamma", name: "Gamma", providerLogo: "acp", usageText: "42 of 250" },
    ]);
    const view = render(() => (
      <PageRail
        hidden={false}
        current="agents"
        pinned={[]}
        onPinChange={vi.fn()}
        usageRows={usageRows()}
        customAgentUsage={customAgentUsage()}
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
    fireEvent.keyDown(screen.getByRole("button", { name: /^Gamma usage/u }), { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(labelsInRenderOrder(view.container)[0]).toMatch(/^Gamma usage/u));

    setCustomAgentUsage([]);
    setUsageRows([usageRow("claude", "Alpha", 88), usageRow("codex", "Beta", 61), usageRow("grok", "Delta", 44)]);

    await waitFor(() => expect(namesInRenderOrder(view.container)).toEqual(["Alpha", "Beta", "Delta"]));

    setCustomAgentUsage([{ id: "gamma", name: "Gamma", providerLogo: "acp", usageText: "42 of 250" }]);

    await waitFor(() => expect(namesInRenderOrder(view.container)).toEqual(["Gamma", "Alpha", "Beta", "Delta"]));
  });

  it("keeps hidden controlled ids while keyboard reordering visible entries", async () => {
    const onReorderableOrderChange = vi.fn();

    render(() => (
      <PageRail
        hidden={false}
        current="agents"
        pinned={[]}
        onPinChange={vi.fn()}
        usageRows={[usageRow("claude", "Alpha", 88), usageRow("grok", "Gamma", 47)]}
        customAgentUsage={[]}
        reorderableOrder={["usage:claude\u0000", "custom-agent:beta", "usage:grok\u0000"]}
        onReorderableOrderChange={onReorderableOrderChange}
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

    await waitFor(() => expect(onReorderableOrderChange).toHaveBeenCalled());
    expect(onReorderableOrderChange).toHaveBeenLastCalledWith([
      "usage:grok\u0000",
      "custom-agent:beta",
      "usage:claude\u0000",
    ]);
  });

  it("keeps usage-card tooltip closed during keyboard reorder focus handoff", async () => {
    vi.useFakeTimers();
    try {
      const usageRows = [usageRow("claude", "Alpha", 88), usageRow("codex", "Beta", 61)];
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

      const beta = screen.getByRole("button", { name: /^Beta usage/u });
      beta.focus();
      fireEvent.keyDown(beta, { key: "ArrowUp", altKey: true });
      await waitFor(() => expect(labelsInRenderOrder(view.container)[0]).toMatch(/^Beta usage/u));
      await vi.advanceTimersByTimeAsync(16);
      const moved = screen.getByRole("button", { name: /^Beta usage/u });
      await waitFor(() => expect(moved).toHaveFocus());

      fireEvent.mouseEnter(moved);
      await vi.advanceTimersByTimeAsync(260);
      expect(screen.queryByRole("tooltip")).toBeNull();
      expect(moved).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});
