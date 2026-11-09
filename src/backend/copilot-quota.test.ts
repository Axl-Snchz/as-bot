import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COPILOT_CREDIT_USD,
  COPILOT_MONTHLY_WINDOW_MINS,
  copilotCommandBasename,
  copilotUsageWindowFromReady,
  copilotUsedPercentFromRemaining,
  formatCopilotQuotaReady,
  invokeCopilotQuotaRpc,
  isCopilotCommand,
  parseCopilotQuotaSnapshot,
  quotaIdentity,
  readCopilotQuota,
  sanitizeCopilotQuotaArgs,
} from "./copilot-quota";

const { spawnMock, stopProcessTreeMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  stopProcessTreeMock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: Writable & EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
}

function frame(id: number, result: unknown): Buffer {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result }), "utf8");
  return Buffer.from(`Content-Length: ${body.length}\r\n\r\n${body.toString("utf8")}`, "utf8");
}

function methodFrame(id: number, method: string, params: unknown = {}): Buffer {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }), "utf8");
  return Buffer.from(`Content-Length: ${body.length}\r\n\r\n${body.toString("utf8")}`, "utf8");
}

function createChild(onWrite?: (chunk: string, child: FakeChild) => void): FakeChild {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  class FakeStdin extends Writable {
    override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      onWrite?.(chunk.toString(), child);
      callback(null);
    }
  }
  const stdin = new FakeStdin();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin,
    kill: vi.fn(),
    pid: 42,
  }) satisfies FakeChild;
  child.stdin.end = vi.fn();
  return child;
}

describe("copilot quota", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    stopProcessTreeMock.mockReset();
    stopProcessTreeMock.mockReturnValue(Effect.void);
  });

  it("detects recognized command basenames on Windows and POSIX", () => {
    expect(copilotCommandBasename("C:\\Users\\user\\OpenBot\\copilot-enterprise.cmd")).toBe("copilot-enterprise");
    expect(copilotCommandBasename("/usr/local/bin/copilot")).toBe("copilot");
    expect(copilotCommandBasename("COPILOT.EXE")).toBe("copilot");
    expect(copilotCommandBasename("  C:\\tools\\copilot.CMD.EXE  ")).toBe("copilot");
    expect(copilotCommandBasename("copilot-beta")).toBe("copilot-beta");
    expect(isCopilotCommand("copilot")).toBe(true);
    expect(isCopilotCommand("C:\\tools\\copilot-enterprise.cmd")).toBe(true);
    expect(isCopilotCommand("/tmp/wrapper", "/usr/local/bin/copilot")).toBe(true);
    expect(isCopilotCommand("copilot-beta")).toBe(false);
  });

  it("keeps only safe settings flags and required SDK flags", () => {
    expect(
      sanitizeCopilotQuotaArgs([
        "--acp",
        "--agent=spidey-bot",
        "--interactive",
        "-p",
        "--allow-all",
        "--disable-builtin-mcps",
        "--disable-mcp-server",
        "Mobbin",
        "--log-level=debug",
        "--log-format",
        "json",
        "--sync-session=on",
        "--model",
        "gpt-5",
        "--session-id",
        "session-1",
        "--allow-tool",
        "shell",
      ]),
    ).toEqual([
      "--disable-mcp-server",
      "Mobbin",
      "--headless",
      "--no-auto-update",
      "--stdio",
      "--log-level=none",
      "--sync-session=off",
      "--disable-builtin-mcps",
    ]);
  });

  it("parses a valid premium_interactions snapshot", () => {
    expect(
      parseCopilotQuotaSnapshot({
        entitlementRequests: 250000,
        usedRequests: 4250,
        remainingPercentage: 98,
        overage: 0,
        resetDate: "2026-11-04T23:07:54.462Z",
      }),
    ).toEqual({
      entitlementRequests: 250000,
      usedRequests: 4250,
      overageRequests: 0,
      remainingPercentage: 98.3,
      resetDate: "2026-11-04T23:07:54.462Z",
    });
    expect(
      parseCopilotQuotaSnapshot({
        entitlementRequests: 50000,
        usedRequests: 50000,
        remainingPercentage: 0,
        overage: 0.5,
        resetDate: "2026-11-04T23:07:54.462Z",
      }),
    ).toEqual({
      entitlementRequests: 50000,
      usedRequests: 50000,
      overageRequests: 0.5,
      remainingPercentage: 0,
      resetDate: "2026-11-04T23:07:54.462Z",
    });
    expect(
      parseCopilotQuotaSnapshot({
        entitlementRequests: 0,
        usedRequests: 0,
        remainingPercentage: 100,
      }),
    ).toBeNull();
    expect(
      parseCopilotQuotaSnapshot({
        entitlementRequests: 1,
        usedRequests: NaN,
        remainingPercentage: 0,
        resetDate: "2026-11-04T23:07:54.462Z",
      }),
    ).toBeNull();
    expect(
      parseCopilotQuotaSnapshot({
        entitlementRequests: 1,
        usedRequests: 0,
        remainingPercentage: 100,
        resetDate: "invalid",
      }),
    ).toEqual({
      entitlementRequests: 1,
      usedRequests: 0,
      overageRequests: 0,
      remainingPercentage: 100,
      resetDate: null,
    });
    expect(
      parseCopilotQuotaSnapshot({
        entitlementRequests: 50000,
        usedRequests: 50000.5,
        remainingPercentage: 0,
      }),
    ).toEqual({
      entitlementRequests: 50000,
      usedRequests: 50000.5,
      overageRequests: 0,
      remainingPercentage: 0,
      resetDate: null,
    });
    expect(
      parseCopilotQuotaSnapshot({
        entitlementRequests: 50000,
        usedRequests: 55000.75,
        remainingPercentage: 50,
        overage: 5000.75,
      }),
    ).toEqual({
      entitlementRequests: 50000,
      usedRequests: 55000.75,
      overageRequests: 5000.75,
      remainingPercentage: 0,
      resetDate: null,
    });
  });

  it("formats ready state with structured quota only", () => {
    const pastReset = "2021-01-01T00:00:00.000Z";
    const ready = formatCopilotQuotaReady({
      entitlementRequests: 250000,
      usedRequests: 4250,
      overageRequests: 0,
      remainingPercentage: 98.3,
      resetDate: pastReset,
    });

    expect(ready.quota.state).toBe("ready");
    expect(ready.quota.usedCredits).toBe(4250);
    expect(ready.quota.overageCredits).toBe(0);
    expect(ready.quota.remainingCredits).toBe(245750);
    expect(ready.quota.creditUsd).toBe(COPILOT_CREDIT_USD);
    expect(ready.quota.remainingPercentage).toBeCloseTo(98.3, 6);
    expect(ready.quota.resetDate).toBe(pastReset);
    expect(ready.text).toBe("");
  });

  it.each([undefined, 0, -1, Infinity, NaN, "unlimited"])(
    "rejects missing, invalid or unlimited entitlement %s",
    (entitlementRequests) => {
      expect(parseCopilotQuotaSnapshot({ entitlementRequests, usedRequests: 4250 })).toBeNull();
    },
  );

  it("preserves fractional authoritative usage without rounding or adding overage", () => {
    const snapshot = parseCopilotQuotaSnapshot({
      entitlementRequests: 250000,
      usedRequests: 4250.123456789,
      remainingPercentage: 98,
      overage: 12,
    });
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error("expected quota snapshot");
    const { quota } = formatCopilotQuotaReady(snapshot);
    expect(quota.usedCredits).toBe(4250.123456789);
    expect(quota.overageCredits).toBe(12);
  });

  it("keeps overage informational and computes used from SDK usedRequests", () => {
    const ready = formatCopilotQuotaReady({
      entitlementRequests: 50000,
      usedRequests: 50000,
      overageRequests: 0.5,
      remainingPercentage: 0,
      resetDate: "2026-11-04T23:07:54.462Z",
    });
    expect(ready.quota.state).toBe("ready");
    if (ready.quota.state !== "ready") throw new Error("expected ready quota");
    expect(ready.quota.entitlementCredits).toBe(50000);
    expect(ready.quota.usedCredits).toBe(50000);
    expect(ready.quota.overageCredits).toBe(0.5);
    expect(ready.quota.remainingCredits).toBe(0);
    expect(ready.quota.remainingPercentage).toBe(0);
  });

  it("maps remaining percentage to used percentage with clamp and rounding", () => {
    expect(copilotUsedPercentFromRemaining(98.3)).toBe(2);
    expect(copilotUsedPercentFromRemaining(98.6)).toBe(1);
    expect(copilotUsedPercentFromRemaining(0)).toBe(100);
    expect(copilotUsedPercentFromRemaining(100)).toBe(0);
    expect(copilotUsedPercentFromRemaining(-10)).toBe(100);
    expect(copilotUsedPercentFromRemaining(120)).toBe(0);
  });

  it("uses future reset as authoritative and falls back to next month UTC start", () => {
    const now = Date.UTC(2026, 10, 9, 7, 33, 33, 0);
    const nextMonth = Math.floor(Date.UTC(2026, 11, 1, 0, 0, 0, 0) / 1_000);
    const ready = {
      state: "ready",
      entitlementCredits: 100,
      usedCredits: 2,
      overageCredits: 0,
      remainingCredits: 98,
      remainingPercentage: 98.3,
      resetDate: "2026-11-20T00:00:00.000Z",
      creditUsd: 0.01,
    } as const;
    expect(copilotUsageWindowFromReady(ready, now)).toEqual({
      usedPercent: 2,
      windowDurationMins: COPILOT_MONTHLY_WINDOW_MINS,
      resetsAt: Math.floor(Date.parse("2026-11-20T00:00:00.000Z") / 1_000),
    });
    expect(copilotUsageWindowFromReady({ ...ready, resetDate: null }, now)).toEqual({
      usedPercent: 2,
      windowDurationMins: COPILOT_MONTHLY_WINDOW_MINS,
      resetsAt: nextMonth,
    });
    expect(copilotUsageWindowFromReady({ ...ready, resetDate: "2026-11-01T00:00:00.000Z" }, now)).toEqual({
      usedPercent: 2,
      windowDurationMins: COPILOT_MONTHLY_WINDOW_MINS,
      resetsAt: nextMonth,
    });
  });

  it("hashes quota identity with a process-local digest", () => {
    const first = quotaIdentity({
      executable: "copilot",
      command: "copilot-enterprise.cmd",
      args: ["--disable-mcp-server", "Mobbin", "--session-id", "s-1"],
      env: { GITHUB_TOKEN: "secret-token", COPILOT_PROFILE: "team" },
      launchPath: "C:\\tools",
    });
    const second = quotaIdentity({
      executable: "copilot",
      command: "copilot-enterprise.cmd",
      args: ["--disable-mcp-server", "Mobbin", "--session-id", "s-1"],
      env: { GITHUB_TOKEN: "secret-token", COPILOT_PROFILE: "team" },
      launchPath: "C:\\tools",
    });
    const changed = quotaIdentity({
      executable: "copilot",
      command: "copilot-enterprise.cmd",
      args: ["--disable-mcp-server", "Mobbin", "--session-id", "s-1"],
      env: { GITHUB_TOKEN: "other-token", COPILOT_PROFILE: "team" },
      launchPath: "C:\\tools",
    });
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
    expect(first).not.toContain("secret-token");
    expect(first).not.toContain("copilot-enterprise.cmd");
  });

  it("maps missing data to no-data and failures to a generic error state", async () => {
    await expect(
      readCopilotQuota({
        executable: "copilot",
        args: [],
        env: {},
        launchPath: null,
        timeoutMs: 1000,
        invoke: async () => ({
          ping: { protocolVersion: 3 },
          quota: { quotaSnapshots: { premium_interactions: null } },
        }),
      }),
    ).resolves.toEqual({ quota: { state: "no-data" }, text: null });
    await expect(
      readCopilotQuota({
        executable: "copilot",
        args: [],
        env: {},
        launchPath: null,
        timeoutMs: 1000,
        invoke: async () => ({ ping: { protocolVersion: 1 }, quota: {} }),
      }),
    ).resolves.toEqual({ quota: { state: "no-data" }, text: null });
    await expect(
      readCopilotQuota({
        executable: "copilot",
        args: [],
        env: {},
        launchPath: null,
        timeoutMs: 1000,
        invoke: async () => {
          throw new Error("boom");
        },
      }),
    ).resolves.toEqual({ quota: { state: "error", messageKey: "account.usage.value.unavailable" }, text: null });
  });

  it("parses framed ping+quota responses from the SDK stream", async () => {
    const cwd = "C:\\temp\\openbot-custom-agents\\agent-1";
    const child = createChild((chunk) => {
      if (chunk.includes('"id":1')) {
        child.stdout.write(frame(1, { protocolVersion: 3, message: "ok", timestamp: Date.now() }));
        return;
      }
      if (chunk.includes('"id":2')) {
        child.stdout.write(
          frame(2, {
            quotaSnapshots: {
              premium_interactions: {
                entitlementRequests: 10,
                usedRequests: 1,
                remainingPercentage: 90,
                resetDate: "2026-11-04T23:07:54.462Z",
              },
            },
          }),
        );
      }
    });
    spawnMock.mockReturnValue(child);
    await expect(
      invokeCopilotQuotaRpc(
        { executable: "copilot", args: [], env: {}, launchPath: null, cwd, timeoutMs: 1000 },
        new AbortController().signal,
        { stopProcess: stopProcessTreeMock },
      ),
    ).resolves.toEqual({
      ping: expect.objectContaining({ protocolVersion: 3 }),
      quota: {
        quotaSnapshots: {
          premium_interactions: {
            entitlementRequests: 10,
            usedRequests: 1,
            remainingPercentage: 90,
            resetDate: "2026-11-04T23:07:54.462Z",
          },
        },
      },
    });
    expect(spawnMock).toHaveBeenCalledWith("copilot", expect.any(Array), expect.objectContaining({ cwd }));
    expect(stopProcessTreeMock).toHaveBeenCalledTimes(1);
  });

  it("does not treat server method calls as responses for pending requests", async () => {
    const writes: string[] = [];
    const child = createChild((chunk) => {
      writes.push(chunk);
      if (chunk.includes('"id":1')) {
        child.stdout.write(frame(1, { protocolVersion: 3, message: "ok", timestamp: Date.now() }));
        return;
      }
      if (chunk.includes('"id":2')) {
        child.stdout.write(methodFrame(2, "server.push", { payload: "ignored" }));
        child.stdout.write(
          frame(2, {
            quotaSnapshots: {
              premium_interactions: {
                entitlementRequests: 250000,
                usedRequests: 4250,
                remainingPercentage: 99.9,
              },
            },
          }),
        );
      }
    });
    spawnMock.mockReturnValueOnce(child);

    await expect(
      invokeCopilotQuotaRpc(
        { executable: "copilot", args: [], env: {}, launchPath: null, timeoutMs: 1000 },
        new AbortController().signal,
        { stopProcess: stopProcessTreeMock },
      ),
    ).resolves.toEqual({
      ping: expect.objectContaining({ protocolVersion: 3 }),
      quota: {
        quotaSnapshots: {
          premium_interactions: {
            entitlementRequests: 250000,
            usedRequests: 4250,
            remainingPercentage: 99.9,
          },
        },
      },
    });

    expect(writes.join("")).toContain('"error":{"code":-32601');
  });

  it("returns unsupported ping as no-data signal and skips quota request", async () => {
    const writes: string[] = [];
    const child = createChild((chunk) => {
      writes.push(chunk);
      if (chunk.includes('"id":1')) child.stdout.write(frame(1, { protocolVersion: 2 }));
    });
    spawnMock.mockReturnValueOnce(child);
    await expect(
      invokeCopilotQuotaRpc(
        { executable: "copilot", args: [], env: {}, launchPath: null, timeoutMs: 1000 },
        new AbortController().signal,
        { stopProcess: stopProcessTreeMock },
      ),
    ).resolves.toEqual({
      ping: { protocolVersion: 2 },
      quota: null,
    });
    expect(writes.join("")).toContain('"id":1');
    expect(writes.join("")).not.toContain('"id":2');
    expect(stopProcessTreeMock).toHaveBeenCalledTimes(1);
  });

  it("fails on timeout, early exit and stdin stream errors", async () => {
    const timeoutChild = createChild();
    spawnMock.mockReturnValueOnce(timeoutChild);
    await expect(
      invokeCopilotQuotaRpc(
        { executable: "copilot", args: [], env: {}, launchPath: null, timeoutMs: 10 },
        new AbortController().signal,
        { stopProcess: stopProcessTreeMock },
      ),
    ).rejects.toThrow("timed out");

    const exitChild = createChild();
    spawnMock.mockReturnValueOnce(exitChild);
    setImmediate(() => exitChild.emit("exit", 1));
    await expect(
      invokeCopilotQuotaRpc(
        { executable: "copilot", args: [], env: {}, launchPath: null, timeoutMs: 1000 },
        new AbortController().signal,
        { stopProcess: stopProcessTreeMock },
      ),
    ).rejects.toThrow("process stopped");

    const epipeChild = createChild((chunk, child) => {
      if (chunk.includes('"id":1')) child.stdin.emit("error", Object.assign(new Error("epipe"), { code: "EPIPE" }));
    });
    spawnMock.mockReturnValueOnce(epipeChild);
    await expect(
      invokeCopilotQuotaRpc(
        { executable: "copilot", args: [], env: {}, launchPath: null, timeoutMs: 1000 },
        new AbortController().signal,
        { stopProcess: stopProcessTreeMock },
      ),
    ).rejects.toThrow("request stream failed");

    const cleanExitChild = createChild();
    spawnMock.mockReturnValueOnce(cleanExitChild);
    setImmediate(() => cleanExitChild.emit("exit", 0));
    await expect(
      invokeCopilotQuotaRpc(
        { executable: "copilot", args: [], env: {}, launchPath: null, timeoutMs: 30_000 },
        new AbortController().signal,
        { stopProcess: stopProcessTreeMock },
      ),
    ).rejects.toThrow("process stopped");
  });

  it("fails immediately when the process exits between ping and quota reads", async () => {
    const child = createChild((chunk, current) => {
      if (!chunk.includes('"id":1')) return;
      current.stdout.write(frame(1, { protocolVersion: 3 }));
      setImmediate(() => current.emit("exit", 0));
    });
    spawnMock.mockReturnValueOnce(child);

    await expect(
      invokeCopilotQuotaRpc(
        { executable: "copilot", args: [], env: {}, launchPath: null, timeoutMs: 1000 },
        new AbortController().signal,
        { stopProcess: stopProcessTreeMock },
      ),
    ).rejects.toThrow("process stopped");
  });

  it("fails on oversized output and supports cancellation cleanup", async () => {
    const oversizedChild = createChild((chunk, child) => {
      if (!chunk.includes('"id":1')) return;
      child.stdout.write(Buffer.alloc(256 * 1024 + 16, "a"));
    });
    spawnMock.mockReturnValueOnce(oversizedChild);
    await expect(
      invokeCopilotQuotaRpc(
        { executable: "copilot", args: [], env: {}, launchPath: null, timeoutMs: 1000 },
        new AbortController().signal,
        { stopProcess: stopProcessTreeMock },
      ),
    ).rejects.toThrow("exceeded limit");

    const hangingChild = createChild();
    spawnMock.mockReturnValueOnce(hangingChild);
    const controller = new AbortController();
    const pending = invokeCopilotQuotaRpc(
      { executable: "copilot", args: [], env: {}, launchPath: null, timeoutMs: 1000 },
      controller.signal,
      { stopProcess: stopProcessTreeMock },
    );
    controller.abort();
    await expect(pending).rejects.toThrow("Aborted");
    expect(stopProcessTreeMock).toHaveBeenCalled();
  });

  it("waits for process-tree stop completion before settling", async () => {
    let releaseStop!: () => void;
    const stopDone = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    stopProcessTreeMock.mockReturnValue(Effect.promise(() => stopDone));
    const child = createChild((chunk, current) => {
      if (chunk.includes('"id":1')) current.stdout.write(frame(1, { protocolVersion: 2 }));
    });
    spawnMock.mockReturnValueOnce(child);

    let settled = false;
    const pending = invokeCopilotQuotaRpc(
      { executable: "copilot", args: [], env: {}, launchPath: null, timeoutMs: 1000 },
      new AbortController().signal,
      { stopProcess: stopProcessTreeMock },
    ).finally(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseStop();
    await expect(pending).resolves.toEqual({ ping: { protocolVersion: 2 }, quota: null });
    expect(settled).toBe(true);
  });
});
