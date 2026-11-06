import {
  type AccountUsage,
  type AgentProviderStatus,
  type AgentStatus,
  type ClientAgentModelOption,
  DEFAULT_PROVIDER_ACCOUNT_ID,
} from "@openbot/contracts/ipc";
import {
  ProviderModelPicker,
  type ProviderModelPickerCustomAgentUsageRow,
} from "@openbot/ui/components/ProviderModelPicker";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { STORY_AGENT_STATUS, STORY_MODELS } from "../../../stories/fixtures";

const NOW_SECONDS = Math.floor(Date.now() / 1_000);
const SECOND_CODEX_ACCOUNT_ID = "a1111111111111111";

function statusRow(id: AgentProviderStatus["id"]): AgentProviderStatus {
  return { id, state: "available", version: "1.0.0", message: null };
}

const BASE_MODELS: ClientAgentModelOption[] = [
  ...STORY_MODELS.filter((model) => model.provider === "codex" || model.provider === "grok"),
  {
    provider: "cursor",
    id: "cursor-max",
    name: "Cursor Max",
    description: "Cursor model",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  },
  {
    provider: "acp",
    id: "copilot-ready/github-copilot/gpt-5",
    name: "Copilot Ready/github-copilot/GPT-5",
    description: "Custom agent model",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  },
];

function baseStatus(): AgentStatus {
  return {
    ...STORY_AGENT_STATUS,
    providers: [statusRow("codex"), statusRow("grok"), statusRow("cursor"), statusRow("acp")],
  };
}

async function openPicker(): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>(".provider-model-trigger");
  if (!trigger) throw new Error("ProviderModelPicker trigger not found");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  await waitFor(() => expect(screen.getByRole("tablist")).toBeInTheDocument());
}

function tabByLabel(match: RegExp): HTMLElement {
  const tab = screen.getAllByRole("tab").find((element) => match.test(element.getAttribute("aria-label") ?? ""));
  if (!tab) throw new Error(`Tab not found: ${match.source}`);
  return tab;
}

function tabByLabelStart(start: string): HTMLElement {
  const tab = screen
    .getAllByRole("tab")
    .find((element) => (element.getAttribute("aria-label") ?? "").startsWith(start));
  if (!tab) throw new Error(`Tab not found by start: ${start}`);
  return tab;
}

function panelForTab(tab: HTMLElement): HTMLElement {
  const panelId = tab.getAttribute("aria-controls");
  if (!panelId) throw new Error("Tab panel id missing");
  const panel = document.getElementById(panelId);
  if (!panel) throw new Error(`Panel not found for tab: ${panelId}`);
  return panel;
}

function activePanel(): HTMLElement {
  const tab = screen
    .getAllByRole("tab")
    .find((element) => element.className.includes("provider-model-rail-button-selected"));
  if (!tab) throw new Error("Active tab not found");
  return panelForTab(tab);
}

function previewRegion(): HTMLElement | null {
  const regions = [...document.querySelectorAll<HTMLElement>(".provider-model-usage-preview")];
  return regions.find((region) => !region.closest("[hidden]")) ?? regions[0] ?? null;
}

function arcDasharray(tab: Element): string | null {
  return tab.querySelector<SVGCircleElement>(".account-usage-ring-arc")?.getAttribute("stroke-dasharray") ?? null;
}

function renderPicker(props?: {
  accountUsage?: AccountUsage;
  status?: AgentStatus;
  modelOptions?: ClientAgentModelOption[];
  accountChoice?: boolean;
  providerAccountId?: string | null;
  customAgentUsage?: readonly ProviderModelPickerCustomAgentUsageRow[];
}) {
  return render(() => (
    <ProviderModelPicker
      provider="codex"
      value="gpt-5.6-luna"
      modelOptions={props?.modelOptions ?? BASE_MODELS}
      agentStatus={props?.status ?? baseStatus()}
      accountUsage={props?.accountUsage}
      accountChoice={props?.accountChoice}
      providerAccountId={props?.providerAccountId}
      customAgentUsage={props?.customAgentUsage}
      onChange={vi.fn()}
    />
  ));
}

describe("ProviderModelPicker usage integration", () => {
  it("shows provider rings + compact bars, then switches account-specific rows", async () => {
    const status = baseStatus();
    status.providers = status.providers?.map((provider) =>
      provider.id === "codex"
        ? {
            ...provider,
            accounts: [
              {
                id: DEFAULT_PROVIDER_ACCOUNT_ID,
                label: null,
                email: "owner@example.com",
                state: "connected",
                message: null,
              },
              {
                id: SECOND_CODEX_ACCOUNT_ID,
                label: "Work",
                email: "work@example.com",
                state: "connected",
                message: null,
              },
            ],
          }
        : provider,
    );
    renderPicker({
      status,
      accountChoice: true,
      accountUsage: {
        limits: [
          {
            id: "codex",
            primary: null,
            secondary: { usedPercent: 30, windowDurationMins: 10_080, resetsAt: NOW_SECONDS + 86_400 },
          },
          {
            id: "codex",
            accountId: SECOND_CODEX_ACCOUNT_ID,
            primary: null,
            secondary: { usedPercent: 80, windowDurationMins: 10_080, resetsAt: NOW_SECONDS + 86_400 },
          },
        ],
      },
    });
    await openPicker();

    const defaultCodexTab = tabByLabel(/Codex(?! · Work)/u);
    expect(defaultCodexTab.className).toContain("provider-model-rail-button-usage");
    expect(arcDasharray(defaultCodexTab)).toMatch(/^70(?:\.0+)? 100$/u);
    expect(defaultCodexTab.className).toContain("provider-model-rail-button-selected");
    expect(defaultCodexTab.getAttribute("aria-selected")).toBe("true");

    const defaultPanel = panelForTab(defaultCodexTab);
    const defaultPreview = defaultPanel.querySelector<HTMLElement>(".provider-model-usage-preview");
    if (!defaultPreview) throw new Error("Default preview missing");
    expect(defaultPreview).toBeVisible();
    // The panel header already names the account, so a single row shows its bars and reset only.
    expect(within(defaultPreview).queryByText(/owner@example\.com/u)).toBeNull();
    expect(within(defaultPreview).getByText("70% left")).toBeInTheDocument();
    expect(within(defaultPreview).getByText("1d 0h")).toBeInTheDocument();
    const defaultFills = [...defaultPreview.querySelectorAll<HTMLElement>(".account-usage-window-fill")].map(
      (node) => node.style.inlineSize,
    );
    expect(defaultFills).toContain("70%");

    const namedAccountTab = screen.getAllByRole("tab").find((element) => {
      const label = element.getAttribute("aria-label") ?? "";
      return label.startsWith("ChatGPT") && !label.includes("owner@example.com");
    });
    if (!namedAccountTab) throw new Error("Named ChatGPT account tab not found");
    fireEvent.click(namedAccountTab);
    await waitFor(() => expect(namedAccountTab.className).toContain("provider-model-rail-button-selected"));
    expect(namedAccountTab.getAttribute("aria-selected")).toBe("true");
    expect(defaultCodexTab.className).not.toContain("provider-model-rail-button-selected");
    expect(defaultCodexTab.getAttribute("aria-selected")).toBe("false");
    expect(arcDasharray(namedAccountTab)).toMatch(/^20(?:\.0+)? 100$/u);

    const namedPanel = panelForTab(namedAccountTab);
    const namedPreview = namedPanel.querySelector<HTMLElement>(".provider-model-usage-preview");
    if (!namedPreview) throw new Error("Named preview missing");
    await waitFor(() => expect(namedPreview).toBeVisible());
    expect(within(namedPreview).getByText("20% left")).toBeInTheDocument();
    expect(within(namedPreview).queryByText("70% left")).toBeNull();
    const namedFills = [...namedPreview.querySelectorAll<HTMLElement>(".account-usage-window-fill")].map(
      (node) => node.style.inlineSize,
    );
    expect(namedFills).toContain("20%");
  });

  it("hides usage rings and compact bars when usage data is missing", async () => {
    renderPicker({ accountUsage: { limits: [] } });
    await openPicker();
    for (const tab of screen.getAllByRole("tab")) expect(arcDasharray(tab)).toBeNull();
    const panel = activePanel();
    expect(within(panel).queryByText(/% left/u)).toBeNull();
    expect(previewRegion()).toBeNull();
  });

  it("maps custom-agent quota states and keeps only ready Copilot rows in Custom usage", async () => {
    renderPicker({
      customAgentUsage: [
        {
          id: "copilot-warning",
          name: "Copilot Warning",
          providerLogo: "copilot",
          quota: { state: "ready", remainingPercent: 21, tone: "warning", resetAtMs: Date.now() + 86_400_000 },
        },
        {
          id: "copilot-critical",
          name: "Copilot Critical",
          providerLogo: "copilot",
          quota: { state: "ready", remainingPercent: 3, tone: "critical", resetAtMs: Date.now() + 86_400_000 },
        },
        { id: "copilot-no-data", name: "Copilot No Data", providerLogo: "copilot", quota: { state: "no-data" } },
        {
          id: "copilot-error",
          name: "Copilot Error",
          providerLogo: "copilot",
          quota: { state: "error", messageKey: "account.usage.value.unavailable" },
        },
        { id: "acp-generic", name: "Generic ACP Agent", providerLogo: "acp", usageText: "42 of 250" },
      ],
    });
    await openPicker();

    const customTab = tabByLabel(/Custom/u);
    expect(customTab.className).toContain("provider-model-rail-button-usage");
    const customArc = customTab.querySelector<SVGCircleElement>(".account-usage-ring-arc");
    expect(customArc?.getAttribute("stroke-dasharray")).toMatch(/^3(?:\.0+)? 100$/u);
    expect(customArc?.getAttribute("data-usage-tone")).toBe("critical");

    fireEvent.click(customTab);
    await waitFor(() => expect(previewRegion()).not.toBeNull());

    const preview = previewRegion();
    if (!preview) throw new Error("Custom preview missing");
    expect(within(preview).getByText("Copilot Critical")).toBeInTheDocument();
    expect(within(preview).getByText("Copilot Warning")).toBeInTheDocument();
    expect(within(preview).queryByText("Copilot No Data")).toBeNull();
    expect(within(preview).queryByText("Copilot Error")).toBeNull();
    expect(within(preview).queryByText("Generic ACP Agent")).toBeNull();
    const fills = [...preview.querySelectorAll<HTMLElement>(".account-usage-window-fill")].map(
      (node) => node.style.inlineSize,
    );
    expect(fills).toEqual(expect.arrayContaining(["3%", "21%"]));
  });

  it("keeps Custom ring and preview bars hidden when Copilot rows are no-data or error", async () => {
    renderPicker({
      customAgentUsage: [
        { id: "copilot-no-data", name: "Copilot No Data", providerLogo: "copilot", quota: { state: "no-data" } },
        {
          id: "copilot-error",
          name: "Copilot Error",
          providerLogo: "copilot",
          quota: { state: "error", messageKey: "account.usage.value.unavailable" },
        },
      ],
    });
    await openPicker();

    const customTab = tabByLabel(/Custom/u);
    expect(customTab.className).not.toContain("provider-model-rail-button-usage");
    expect(arcDasharray(customTab)).toBeNull();

    fireEvent.click(customTab);
    await waitFor(() => expect(customTab.className).toContain("provider-model-rail-button-selected"));
    const customPanel = panelForTab(customTab);
    expect(within(customPanel).queryByText(/% left/u)).toBeNull();
  });

  it("applies owner/shared quota semantics and lowest shared ring on the owner provider", async () => {
    renderPicker({
      accountUsage: {
        limits: [
          {
            id: "grok",
            primary: null,
            secondary: { usedPercent: 36, windowDurationMins: 10_080, resetsAt: NOW_SECONDS + 5 * 86_400 },
          },
          {
            id: "cursor",
            primary: null,
            secondary: { usedPercent: 82, windowDurationMins: 43_200, resetsAt: NOW_SECONDS + 12 * 86_400 },
            sharedQuotaWith: "grok",
          },
        ],
      },
    });
    await openPicker();

    const grokTab = tabByLabelStart("Grok");
    const cursorTab = tabByLabelStart("Cursor");
    expect(grokTab.className).toContain("provider-model-rail-button-usage");
    expect(arcDasharray(grokTab)).toMatch(/^18(?:\.0+)? 100$/u);
    expect(cursorTab.className).not.toContain("provider-model-rail-button-usage");

    fireEvent.click(grokTab);
    await waitFor(() => expect(previewRegion()).not.toBeNull());
    const preview = previewRegion();
    if (!preview) throw new Error("Shared quota preview missing");
    expect(within(preview).getByText("Grok")).toBeInTheDocument();
    expect(within(preview).getByText("Cursor")).toBeInTheDocument();
  });
});
