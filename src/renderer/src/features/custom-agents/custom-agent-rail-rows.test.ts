// @vitest-environment node

import type { CustomAgentSummary, CustomAgentUsage } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { customAgentRailRows } from "./custom-agent-rail-rows";

function agent(
  row: Pick<CustomAgentSummary, "id" | "name" | "usagePrompt"> & {
    command?: string;
    resolvedCommand?: string | null;
  },
): CustomAgentSummary {
  return {
    id: row.id,
    name: row.name,
    command: row.command ?? "/tmp/fake-agent",
    args: [],
    envNames: [],
    usagePrompt: row.usagePrompt,
    resolvedCommand: row.resolvedCommand ?? "/tmp/fake-agent",
  };
}

function usage(id: string, text: string, quota?: CustomAgentUsage["quota"]): CustomAgentUsage {
  return { id, text, quota };
}

describe("customAgentRailRows", () => {
  it("keeps list order and id identity, even when names repeat", () => {
    const rows = customAgentRailRows(
      [
        agent({ id: "alpha", name: "Copilot", usagePrompt: "/usage" }),
        agent({ id: "beta", name: "Copilot", usagePrompt: "/usage" }),
        agent({ id: "gamma", name: "Devin", usagePrompt: "/usage" }),
      ],
      [usage("beta", "Beta usage"), usage("alpha", "Alpha usage"), usage("gamma", "Gamma usage")],
    );

    expect(rows.map((row) => row.id)).toEqual(["alpha", "beta", "gamma"]);
    expect(rows.map((row) => row.name)).toEqual(["Copilot", "Copilot", "Devin"]);
    expect(rows.map((row) => row.usageText)).toEqual(["Alpha usage", "Beta usage", "Gamma usage"]);
    expect(rows.map((row) => row.providerLogo)).toEqual(["acp", "acp", "acp"]);
  });

  it("hides stale usage when the agent has no usage prompt", () => {
    const rows = customAgentRailRows(
      [agent({ id: "alpha", name: "Alpha", usagePrompt: null })],
      [usage("alpha", "stale usage answer")],
    );

    expect(rows).toEqual([{ id: "alpha", name: "Alpha", providerLogo: "acp", usageText: undefined, quota: undefined }]);
  });

  it("keeps the row and leaves usage empty when prompt exists but no answer exists", () => {
    const rows = customAgentRailRows([agent({ id: "alpha", name: "Alpha", usagePrompt: "/usage" })], []);

    expect(rows).toEqual([{ id: "alpha", name: "Alpha", providerLogo: "acp", usageText: undefined, quota: undefined }]);
  });

  it("keeps the same id and row when prompt is removed after an earlier answer", () => {
    const before = customAgentRailRows(
      [agent({ id: "alpha", name: "Alpha", usagePrompt: "/usage" })],
      [usage("alpha", "42 of 250")],
    );
    const after = customAgentRailRows(
      [agent({ id: "alpha", name: "Alpha", usagePrompt: null })],
      [usage("alpha", "42 of 250")],
    );

    expect(before).toEqual([
      { id: "alpha", name: "Alpha", providerLogo: "acp", usageText: "42 of 250", quota: undefined },
    ]);
    expect(after).toEqual([
      { id: "alpha", name: "Alpha", providerLogo: "acp", usageText: undefined, quota: undefined },
    ]);
  });

  it("updates the name for the same id and drops deleted ids", () => {
    const before = customAgentRailRows(
      [
        agent({ id: "alpha", name: "Alpha", usagePrompt: "/usage" }),
        agent({ id: "beta", name: "Beta", usagePrompt: "/usage" }),
      ],
      [usage("alpha", "Alpha usage"), usage("beta", "Beta usage")],
    );
    const renamedAndDeleted = customAgentRailRows(
      [agent({ id: "beta", name: "Beta Renamed", usagePrompt: "/usage" })],
      [usage("alpha", "Alpha usage"), usage("beta", "Beta usage")],
    );

    expect(before.map((row) => row.id)).toEqual(["alpha", "beta"]);
    expect(renamedAndDeleted).toEqual([
      { id: "beta", name: "Beta Renamed", providerLogo: "acp", usageText: "Beta usage", quota: undefined },
    ]);
  });

  it("keeps Copilot visible with no usage prompt and marks no-data when quota is missing", () => {
    const rows = customAgentRailRows(
      [
        agent({
          id: "copilot",
          name: "Copilot",
          usagePrompt: null,
          command: "C:\\tools\\copilot-enterprise.cmd",
        }),
      ],
      [],
    );

    expect(rows).toEqual([
      { id: "copilot", name: "Copilot", providerLogo: "copilot", usageText: undefined, quota: { state: "no-data" } },
    ]);
  });

  it("maps Copilot quota states by id when names repeat", () => {
    const rows = customAgentRailRows(
      [
        agent({ id: "alpha", name: "Copilot", usagePrompt: null, command: "/usr/local/bin/copilot" }),
        agent({ id: "beta", name: "Copilot", usagePrompt: null, command: "/usr/local/bin/copilot-enterprise" }),
      ],
      [
        usage("beta", "", { state: "error", messageKey: "account.usage.value.unavailable" }),
        usage("alpha", "", { state: "no-data" }),
      ],
    );

    expect(rows.map((row) => row.id)).toEqual(["alpha", "beta"]);
    expect(rows.map((row) => row.name)).toEqual(["Copilot", "Copilot"]);
    expect(rows.map((row) => row.quota?.state)).toEqual(["no-data", "error"]);
  });
});
