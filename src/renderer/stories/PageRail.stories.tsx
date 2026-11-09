import type { CustomAgentSummary, CustomAgentUsage as CustomAgentUsageState } from "@openbot/contracts/ipc";
import { accountUsageProviderRows, accountUsageRowKey } from "@openbot/ui/features/account/account-usage-view";
import { HelpMenu } from "@openbot/ui/features/updates/HelpMenu";
import {
  type CustomAgentUsageRailRow,
  PageRail,
  type PageRailPage,
  type PageRailPinnablePage,
  type PageRailProps,
} from "@openbot/ui/features/window/PageRail";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { customAgentRailRows } from "../src/features/custom-agents/custom-agent-rail-rows";

const nowSeconds = Math.floor(Date.now() / 1_000);

const usageRows = accountUsageProviderRows({
  limits: [
    {
      id: "codex",
      primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: nowSeconds + 2 * 3_600 },
      secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: nowSeconds + 4 * 86_400 },
    },
    {
      id: "cursor",
      primary: { usedPercent: 37, windowDurationMins: 43_200, resetsAt: nowSeconds + 18 * 86_400 },
      secondary: { usedPercent: 82, windowDurationMins: 43_200, resetsAt: nowSeconds + 18 * 86_400 },
    },
  ],
});

const comparisonUsageRows = accountUsageProviderRows({
  limits: [
    {
      id: "claude",
      primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: nowSeconds + 2 * 3_600 },
      secondary: { usedPercent: 22, windowDurationMins: 10_080, resetsAt: nowSeconds + 22 * 3_600 + 51 * 60 },
    },
    {
      id: "codex",
      primary: { usedPercent: 0, windowDurationMins: 43_200, resetsAt: nowSeconds + 28 * 86_400 + 7 * 3_600 },
      secondary: null,
    },
  ],
});
const builtInCopilotUsageRows = accountUsageProviderRows({
  limits: [
    {
      id: "copilot",
      primary: { usedPercent: 37, windowDurationMins: 43_200, resetsAt: nowSeconds + 11 * 86_400 },
      secondary: null,
    },
  ],
});
const comparisonCodexUsageRow = comparisonUsageRows.find((row) => row.provider === "codex");
const comparisonClaudeUsageRow = comparisonUsageRows.find((row) => row.provider === "claude");
if (!comparisonCodexUsageRow || !comparisonClaudeUsageRow)
  throw new Error("PageRail stories expected codex and claude usage rows for reorder preview.");

/** A merged Cursor plan counts the Grok plan quota: one Grok ring, and its card lists Cursor too. */
const sharedQuotaRows = accountUsageProviderRows({
  limits: [
    {
      id: "grok",
      primary: null,
      secondary: { usedPercent: 64, windowDurationMins: 10_080, resetsAt: nowSeconds + 3 * 86_400 },
    },
    {
      id: "cursor",
      primary: { usedPercent: 64, windowDurationMins: 43_200, resetsAt: nowSeconds + 18 * 86_400 },
      secondary: null,
      sharedQuotaWith: "grok",
    },
  ],
});

/** An example answer. Each agent writes its own text, which the card shows as it is. */
const customAgentUsage: CustomAgentUsageRailRow[] = [
  {
    id: "devin",
    name: "Devin",
    providerLogo: "acp",
    usageText: "Plan: Team\nACUs used this cycle: 42 of 250\nThe cycle resets in 12 days.",
  },
];

function storyAgent(input: {
  id: string;
  name: string;
  command: string;
  usagePrompt: string | null;
  resolvedCommand?: string | null;
}): CustomAgentSummary {
  return {
    id: input.id,
    name: input.name,
    command: input.command,
    args: [],
    envNames: [],
    usagePrompt: input.usagePrompt,
    resolvedCommand: input.resolvedCommand ?? input.command,
  };
}

function storyUsage(id: string, text: string, quota?: CustomAgentUsageState["quota"]): CustomAgentUsageState {
  return { id, text, quota };
}

const customAgentsMixedUsage: CustomAgentUsageRailRow[] = customAgentRailRows(
  [
    storyAgent({ id: "devin", name: "Devin", command: "/tmp/devin", usagePrompt: "/usage" }),
    storyAgent({
      id: "copilot-local",
      name: "Copilot",
      command: "C:\\tools\\copilot-enterprise.cmd",
      usagePrompt: null,
    }),
    storyAgent({
      id: "copilot-experimental",
      name: "Copilot Experimental",
      command: "C:\\tools\\copilot-beta.exe",
      usagePrompt: null,
    }),
    storyAgent({
      id: "copilot-failing",
      name: "Copilot Failing",
      command: "C:\\tools\\copilot-failing.cmd",
      usagePrompt: null,
    }),
  ],
  [
    storyUsage("devin", "Plan: Team\nACUs used this cycle: 42 of 250\nThe cycle resets in 12 days."),
    storyUsage("copilot-local", "", {
      state: "ready",
      entitlementCredits: 250_000,
      usedCredits: 4_250,
      overageCredits: 0,
      remainingCredits: 245_750,
      remainingPercentage: 98.3,
      resetDate: new Date(Date.now() + (26 * 86_400 + 4 * 3_600) * 1_000).toISOString(),
      creditUsd: 0.01,
    }),
    storyUsage("copilot-experimental", "", { state: "no-data" }),
    storyUsage("copilot-failing", "", { state: "error", messageKey: "account.usage.value.unavailable" }),
  ],
  Date.now(),
);

/** The page rail as the desktop window shows it. Hover a button, or move to it with Tab, to see its tooltip. */
function RailPreview(props: {
  updateReady?: boolean;
  logo?: PageRailProps["logo"];
  customAgentUsage?: readonly CustomAgentUsageRailRow[];
  usageRows?: PageRailProps["usageRows"];
  reorderableOrder?: readonly string[];
  preferBuiltInCopilotUsage?: boolean;
}) {
  const { t } = useText();
  const [current, setCurrent] = createSignal<PageRailPage | null>("agents");
  const [pinned, setPinned] = createSignal<readonly PageRailPinnablePage[]>(["usage"]);
  const [reorderableOrder, setReorderableOrder] = createSignal<readonly string[]>(props.reorderableOrder ?? []);
  return (
    // The extra box keeps the rail out of the rule that hides it in a narrow window.
    <div class="app-window" style={{ height: "100vh" }}>
      <div style={{ display: "flex" }}>
        <PageRail
          hidden={false}
          current={current()}
          pinned={pinned()}
          onPinChange={(page, pin) =>
            setPinned((pages) => (pin ? [...pages, page] : pages.filter((other) => other !== page)))
          }
          reorderableOrder={reorderableOrder()}
          onReorderableOrderChange={(next) => setReorderableOrder(next)}
          usageRows={props.usageRows ?? usageRows}
          customAgentUsage={props.customAgentUsage}
          preferBuiltInCopilotUsage={props.preferBuiltInCopilotUsage}
          onAgents={() => setCurrent("agents")}
          onRoutines={() => setCurrent("routines")}
          onSchedule={() => setCurrent("schedule")}
          onUsage={() => setCurrent("usage")}
          onMarketplace={fn()}
          onSettings={() => setCurrent("settings")}
          settingsNotice={props.updateReady ? t("account.update.ready") : undefined}
          logo={props.logo}
          help={
            <HelpMenu
              news={[]}
              triggerClass="window-rail-button"
              onOpenWhatsNew={fn()}
              onOpenChangelog={fn()}
              onOpenGuides={fn()}
              onOpenDiscord={fn()}
              onSendFeedback={fn()}
            />
          }
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Window/PageRail",
  component: RailPreview,
} satisfies Meta<typeof RailPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The Settings tooltip also says what the dot stands for. */
export const SettingsNotice: Story = {
  args: { updateReady: true },
};

/** A custom agent with a usage command: its logo with no ring. Hover it to see the answer. */
export const CustomAgentUsage: Story = {
  args: { customAgentUsage },
};

/** Saved custom agents always show. Missing usage answers show "No usage data". */
export const CustomAgentsMixedUsage: Story = {
  args: { customAgentUsage: customAgentsMixedUsage },
};

export const UsageComparisonBuiltInAndCopilot: Story = {
  args: {
    usageRows: builtInCopilotUsageRows,
    customAgentUsage: customAgentsMixedUsage.filter((row) => row.id === "copilot-local"),
    preferBuiltInCopilotUsage: true,
  },
};

export const UsageFallbackToCustomCopilot: Story = {
  args: {
    usageRows: builtInCopilotUsageRows,
    customAgentUsage: [
      ...customAgentsMixedUsage.filter((row) => row.id === "copilot-local"),
      {
        id: "copilot-secondary",
        name: "Copilot Secondary",
        providerLogo: "copilot",
        quota: { state: "ready", remainingPercent: 4, tone: "critical", resetAtMs: Date.now() + 12 * 86_400_000 },
      },
    ],
    preferBuiltInCopilotUsage: false,
  },
};

export const UsageNeutralBuiltInCopilotNoData: Story = {
  args: {
    usageRows: accountUsageProviderRows({ limits: [] }, [{ id: "copilot", state: "available" }]),
    customAgentUsage: customAgentsMixedUsage.filter((row) => row.id === "copilot-local"),
    preferBuiltInCopilotUsage: true,
  },
};

export const ReorderedUsageAndCustomAgents: Story = {
  args: {
    usageRows: comparisonUsageRows,
    customAgentUsage: customAgentsMixedUsage.filter((row) => row.id === "copilot-local" || row.id === "devin"),
    reorderableOrder: [
      "custom-agent:devin",
      `usage:${accountUsageRowKey(comparisonCodexUsageRow)}`,
      `usage:${accountUsageRowKey(comparisonClaudeUsageRow)}`,
      "custom-agent:copilot-local",
    ],
  },
};

/** Grok and a merged Cursor plan share one quota, so the rail shows the Grok ring alone. */
export const SharedQuota: Story = {
  args: { usageRows: sharedQuotaRows },
};

/** The web client: no macOS window buttons, so the logo in the top row links to the OpenBot site. */
export const WebLogo: Story = {
  args: { logo: { variant: "production", href: "/" } },
};

/** Windows and Linux: the logo is in the top row, with no link. */
export const DesktopLogo: Story = {
  args: { logo: { variant: "production" } },
};
