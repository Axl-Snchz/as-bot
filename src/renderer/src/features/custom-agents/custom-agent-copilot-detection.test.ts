// @vitest-environment node

import { describe, expect, it } from "vitest";
import { customAgentCommandBasename, isCopilotCustomAgent } from "./custom-agent-copilot-detection";

describe("custom-agent-copilot-detection", () => {
  it("normalizes command basenames for Windows and POSIX paths", () => {
    expect(customAgentCommandBasename("C:\\Users\\dev\\copilot-enterprise.cmd")).toBe("copilot-enterprise");
    expect(customAgentCommandBasename("/usr/local/bin/copilot")).toBe("copilot");
    expect(customAgentCommandBasename("COPILOT.EXE")).toBe("copilot");
    expect(customAgentCommandBasename("copilot-beta")).toBe("copilot-beta");
  });

  it("matches Copilot by command basename and resolved command fallback", () => {
    expect(
      isCopilotCustomAgent({
        command: "wrapper",
        resolvedCommand: "/opt/bin/copilot-enterprise",
      }),
    ).toBe(true);
    expect(
      isCopilotCustomAgent({
        command: "C:\\tools\\copilot.cmd",
        resolvedCommand: null,
      }),
    ).toBe(true);
    expect(
      isCopilotCustomAgent({
        command: "custom-copilot-helper",
        resolvedCommand: "/tmp/not-copilot",
      }),
    ).toBe(false);
  });
});
