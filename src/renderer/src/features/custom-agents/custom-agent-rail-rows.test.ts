// @vitest-environment node

import type { CustomAgentSummary, CustomAgentUsage } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { customAgentRailRows } from "./custom-agent-rail-rows";

function agent(row: Pick<CustomAgentSummary, "id" | "name" | "usagePrompt">): CustomAgentSummary {
  return {
    id: row.id,
    name: row.name,
    command: "/tmp/fake-agent",
    args: [],
    envNames: [],
    usagePrompt: row.usagePrompt,
    resolvedCommand: "/tmp/fake-agent",
  };
}

function usage(id: string, text: string): CustomAgentUsage {
  return { id, text };
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
  });

  it("hides stale usage when the agent has no usage prompt", () => {
    const rows = customAgentRailRows(
      [agent({ id: "alpha", name: "Alpha", usagePrompt: null })],
      [usage("alpha", "stale usage answer")],
    );

    expect(rows).toEqual([{ id: "alpha", name: "Alpha", usageText: undefined }]);
  });

  it("keeps the row and leaves usage empty when prompt exists but no answer exists", () => {
    const rows = customAgentRailRows([agent({ id: "alpha", name: "Alpha", usagePrompt: "/usage" })], []);

    expect(rows).toEqual([{ id: "alpha", name: "Alpha", usageText: undefined }]);
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

    expect(before).toEqual([{ id: "alpha", name: "Alpha", usageText: "42 of 250" }]);
    expect(after).toEqual([{ id: "alpha", name: "Alpha", usageText: undefined }]);
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
    expect(renamedAndDeleted).toEqual([{ id: "beta", name: "Beta Renamed", usageText: "Beta usage" }]);
  });
});
