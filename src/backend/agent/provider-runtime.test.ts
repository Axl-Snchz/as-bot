import type { CustomAgentQuota, CustomAgentUsage } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomAgentConfig } from "../custom-acp-agents-client";
import type { ProviderClientContext } from "../provider-drivers";
import { type ProviderHooks, ProviderRuntime } from "./provider-runtime";

const { readCopilotQuotaMock, resolveAgentCommandMock, agentLaunchPathMock } = vi.hoisted(() => ({
  readCopilotQuotaMock: vi.fn(),
  resolveAgentCommandMock: vi.fn(),
  agentLaunchPathMock: vi.fn(),
}));

vi.mock("../copilot-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../copilot-quota")>();
  return { ...actual, readCopilotQuota: readCopilotQuotaMock };
});

vi.mock("../acp-agent-command", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../acp-agent-command")>();
  return { ...actual, resolveAgentCommand: resolveAgentCommandMock };
});

vi.mock("../cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cli")>();
  return { ...actual, agentLaunchPath: agentLaunchPathMock };
});

function readyQuota(): CustomAgentQuota {
  return {
    state: "ready",
    entitlementCredits: 100,
    usedCredits: 10,
    overageCredits: 0,
    remainingCredits: 90,
    remainingPercentage: 90,
    resetDate: "2026-11-04T23:07:54.462Z",
    creditUsd: 0.01,
  };
}

function copilotAgent(
  id: string,
  options: Partial<Pick<CustomAgentConfig, "args" | "env" | "usagePrompt" | "command">> = {},
): CustomAgentConfig {
  return {
    id,
    name: id,
    command: options.command ?? "copilot",
    args: options.args ?? [],
    env: options.env ?? [],
    usagePrompt: options.usagePrompt ?? null,
  };
}

async function runUsage(runtime: ProviderRuntime): Promise<CustomAgentUsage[]> {
  return Effect.runPromise(runtime.customAgentUsage());
}

function createRuntime(options: {
  customAgents: () => readonly CustomAgentConfig[];
  agentEnvironment?: (inherited?: NodeJS.ProcessEnv) => Readonly<Record<string, string>>;
  isStopping?: () => boolean;
}): ProviderRuntime {
  const hooks: ProviderHooks = {
    bindClient: () => undefined,
    onProvidersReady: () => Effect.void,
    onProviderLost: () => undefined,
    onClientStopped: () => Effect.void,
    isStopping: options.isStopping ?? (() => false),
    isProviderBusy: () => false,
    isAgentBusy: () => false,
    isProviderAssigned: () => false,
    onAgentClientLost: () => Effect.void,
    sharedRoot: () => "C:/tmp",
    onProviderResumed: () => undefined,
    onProviderActivated: () => Effect.void,
    captureConfigRevision: () => 0,
  };
  const credentials: ProviderClientContext = {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
    customAgents: options.customAgents,
    ...(options.agentEnvironment ? { agentEnvironment: options.agentEnvironment } : {}),
  };
  return new ProviderRuntime({
    conversation: Object.create({
      unloadClientThreads: () => undefined,
      clearLoadedThreads: () => undefined,
    }),
    hooks,
    emit: () => undefined,
    emitError: () => undefined,
    requestTimeoutMs: 1_000,
    preferredProvider: "codex",
    clientFactory: null,
    bundledExecutables: {},
    credentials,
    redactMcp: (text) => text,
  });
}

describe("ProviderRuntime customAgentUsage copilot cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T18:00:00.000Z"));
    readCopilotQuotaMock.mockReset();
    resolveAgentCommandMock.mockReset();
    agentLaunchPathMock.mockReset();
    resolveAgentCommandMock.mockImplementation((command: string) => Effect.succeed(command));
    agentLaunchPathMock.mockImplementation(() => Effect.succeed(null));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { state: "ready", quota: readyQuota(), text: "ready text" },
    {
      state: "error",
      quota: { state: "error", messageKey: "account.usage.value.unavailable" } as const,
      text: null,
    },
    { state: "no-data", quota: { state: "no-data" } as const, text: null },
  ])("reuses $state quota for five minutes, then reads again", async ({ quota, text }) => {
    const agents: CustomAgentConfig[] = [copilotAgent("copilot-1")];
    const runtime = createRuntime({ customAgents: () => agents });
    readCopilotQuotaMock.mockResolvedValue({ quota, text });

    const first = await runUsage(runtime);
    expect(first).toHaveLength(1);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-04T18:04:59.000Z"));
    const second = await runUsage(runtime);
    expect(second).toEqual(first);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-04T18:05:01.000Z"));
    const third = await runUsage(runtime);
    expect(third).toHaveLength(1);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates cache when agent settings fingerprint changes", async () => {
    let agents: CustomAgentConfig[] = [copilotAgent("copilot-1", { args: ["--one"] })];
    const runtime = createRuntime({ customAgents: () => agents });
    readCopilotQuotaMock.mockResolvedValue({ quota: readyQuota(), text: "first" });

    await runUsage(runtime);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);

    agents = [copilotAgent("copilot-1", { args: ["--two"] })];
    readCopilotQuotaMock.mockResolvedValue({ quota: readyQuota(), text: "second" });
    const usage = await runUsage(runtime);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(2);
    expect(usage[0]?.text).toContain("second");
  });

  it("invalidates cache when auth settings in agent env change", async () => {
    let token = "token-a";
    const runtime = createRuntime({
      customAgents: () => [copilotAgent("copilot-1", { env: [{ name: "GITHUB_TOKEN", value: token }] })],
    });
    readCopilotQuotaMock.mockResolvedValue({ quota: readyQuota(), text: "first" });

    await runUsage(runtime);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);

    token = "token-b";
    readCopilotQuotaMock.mockResolvedValue({ quota: readyQuota(), text: "second" });
    const usage = await runUsage(runtime);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(2);
    expect(usage[0]?.text).toContain("second");
  });

  it("refreshes entitlement after TTL without restart", async () => {
    const runtime = createRuntime({ customAgents: () => [copilotAgent("copilot-1")] });
    readCopilotQuotaMock
      .mockResolvedValueOnce({
        quota: {
          state: "ready",
          entitlementCredits: 50000,
          usedCredits: 50,
          overageCredits: 0,
          remainingCredits: 49950,
          remainingPercentage: 99.9,
          resetDate: null,
          creditUsd: 0.01,
        },
        text: "",
      })
      .mockResolvedValueOnce({
        quota: {
          state: "ready",
          entitlementCredits: 250000,
          usedCredits: 50,
          overageCredits: 0,
          remainingCredits: 249950,
          remainingPercentage: 99.98,
          resetDate: null,
          creditUsd: 0.01,
        },
        text: "",
      });

    const first = await runUsage(runtime);
    expect(first[0]?.quota?.state).toBe("ready");
    if (first[0]?.quota?.state !== "ready") throw new Error("expected ready quota");
    expect(first[0].quota.entitlementCredits).toBe(50000);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-04T18:05:01.000Z"));
    const second = await runUsage(runtime);
    expect(second[0]?.quota?.state).toBe("ready");
    if (second[0]?.quota?.state !== "ready") throw new Error("expected ready quota");
    expect(second[0].quota.entitlementCredits).toBe(250000);
    expect(second[0].quota.usedCredits).toBe(50);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight read per identity and keeps distinct identities separate", async () => {
    const resolvers: Array<(value: { quota: CustomAgentQuota; text: string | null }) => void> = [];
    readCopilotQuotaMock.mockImplementation(
      () =>
        new Promise<{ quota: CustomAgentQuota; text: string | null }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const runtime = createRuntime({
      customAgents: () => [
        copilotAgent("same-1"),
        copilotAgent("same-2"),
        copilotAgent("other", { env: [{ name: "COPILOT_PROFILE", value: "other" }] }),
      ],
    });

    const pending = runUsage(runtime);
    await vi.waitFor(() => expect(readCopilotQuotaMock).toHaveBeenCalledTimes(2));
    for (const resolve of resolvers) resolve({ quota: readyQuota(), text: "shared" });
    const usage = await pending;
    expect(usage.map((item) => item.id).sort()).toEqual(["other", "same-1", "same-2"]);
  });

  it("does not keep stale success text after an invalidated read returns error", async () => {
    let agents: CustomAgentConfig[] = [copilotAgent("copilot-1", { args: ["--a"] })];
    const runtime = createRuntime({ customAgents: () => agents });
    readCopilotQuotaMock.mockResolvedValueOnce({ quota: readyQuota(), text: "success text" });

    const first = await runUsage(runtime);
    expect(first[0]?.quota?.state).toBe("ready");
    expect(first[0]?.text).toContain("success text");

    agents = [copilotAgent("copilot-1", { args: ["--b"] })];
    readCopilotQuotaMock.mockResolvedValueOnce({
      quota: { state: "error", messageKey: "account.usage.value.unavailable" },
      text: null,
    });
    const second = await runUsage(runtime);
    expect(second[0]?.quota?.state).toBe("error");
    expect(second[0]?.text).not.toContain("success text");
  });

  it("uses Copilot quota path with or without usagePrompt and does not start ACP for Copilot-only", async () => {
    const runtime = createRuntime({
      customAgents: () => [copilotAgent("with-prompt", { usagePrompt: "ignored" }), copilotAgent("without-prompt")],
    });
    readCopilotQuotaMock.mockResolvedValue({ quota: readyQuota(), text: "copilot text" });
    const ensureProviderSpy = vi.spyOn(runtime, "ensureProvider");

    const usage = await runUsage(runtime);
    expect(usage.map((item) => item.id).sort()).toEqual(["with-prompt", "without-prompt"]);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);
    expect(ensureProviderSpy).not.toHaveBeenCalled();
  });

  it("routes resolved Copilot aliases to quota reads and never sends usagePrompt", async () => {
    const runtime = createRuntime({
      customAgents: () => [copilotAgent("alias", { command: "copilot-alias", usagePrompt: "do not send" })],
    });
    resolveAgentCommandMock.mockImplementation((command: string) =>
      Effect.succeed(command === "copilot-alias" ? "/usr/local/bin/copilot" : command),
    );
    readCopilotQuotaMock.mockResolvedValue({ quota: readyQuota(), text: "copilot text" });
    const ensureProviderSpy = vi.spyOn(runtime, "ensureProvider");

    const usage = await runUsage(runtime);
    expect(usage.map((item) => item.id)).toEqual(["alias"]);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);
    expect(ensureProviderSpy).not.toHaveBeenCalled();
  });

  it("keeps non-Copilot prompt behavior", async () => {
    const runtime = createRuntime({
      customAgents: () => [
        copilotAgent("no-prompt-noncopilot", { command: "not-copilot", usagePrompt: null }),
        copilotAgent("with-prompt-noncopilot", { command: "not-copilot", usagePrompt: "plan usage" }),
      ],
    });
    const ensureProviderSpy = vi
      .spyOn(runtime, "ensureProvider")
      .mockImplementation(() => Effect.succeed<undefined>(undefined));

    const usage = await runUsage(runtime);
    expect(usage).toEqual([]);
    expect(ensureProviderSpy).toHaveBeenCalledWith("acp");
    expect(readCopilotQuotaMock).not.toHaveBeenCalled();
  });

  it.each(["resolve", "result"])("does not cache a stale %s after auth environment reload", async (phase) => {
    let release!: () => void;
    if (phase === "resolve") {
      resolveAgentCommandMock.mockImplementationOnce(() =>
        Effect.promise(
          () =>
            new Promise<string>((resolve) => {
              release = () => resolve("copilot");
            }),
        ),
      );
    } else {
      readCopilotQuotaMock.mockImplementationOnce(
        () =>
          new Promise<{ quota: CustomAgentQuota; text: string }>((resolve) => {
            release = () => resolve({ quota: readyQuota(), text: "stale" });
          }),
      );
    }
    readCopilotQuotaMock.mockResolvedValue({ quota: readyQuota(), text: "fresh" });
    const runtime = createRuntime({ customAgents: () => [copilotAgent("copilot-1")] });
    const pending = runUsage(runtime);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await Effect.runPromise(runtime.reloadAgentEnvironment());
    release();
    await expect(pending).resolves.toEqual([]);
    const fresh = await runUsage(runtime);
    expect(fresh[0]?.text).toBe("fresh");
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(phase === "resolve" ? 1 : 2);
    await runUsage(runtime);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(phase === "resolve" ? 1 : 2);
  });

  it.each(["copilot", "copilot-alias"])(
    "does not spawn %s quota reads after dispose while command resolution is pending",
    async (command) => {
      let releaseResolve!: (value: string | null) => void;
      resolveAgentCommandMock.mockImplementation(() =>
        Effect.promise(
          () =>
            new Promise<string | null>((resolve) => {
              releaseResolve = resolve;
            }),
        ),
      );
      const runtime = createRuntime({
        customAgents: () => [copilotAgent("copilot-1", { command })],
      });
      const pendingUsage = runUsage(runtime);

      await vi.waitFor(() => expect(resolveAgentCommandMock).toHaveBeenCalledTimes(1));
      await Effect.runPromise(runtime.dispose());
      releaseResolve("copilot");

      await expect(pendingUsage).resolves.toEqual([]);
      expect(readCopilotQuotaMock).not.toHaveBeenCalled();
    },
  );
});
