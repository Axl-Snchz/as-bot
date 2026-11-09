import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import type { CustomAgentQuota, CustomAgentUsage } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentClient } from "../agent-client";
import type { CustomAgentConfig } from "../custom-acp-agents-client";
import type { ProviderClientContext } from "../provider-drivers";
import { COPILOT_ARGV, COPILOT_ENV, customAgentDiscoveryFolder } from "../provider-drivers";
import { ProviderAccountStore } from "./provider-account-store";
import { type ProviderHooks, ProviderRuntime } from "./provider-runtime";

const {
  readCopilotQuotaMock,
  resolveAgentCommandMock,
  agentLaunchPathMock,
  resolveCopilotCliMock,
  startAcpAuthenticationMock,
} = vi.hoisted(() => ({
  readCopilotQuotaMock: vi.fn(),
  resolveAgentCommandMock: vi.fn(),
  agentLaunchPathMock: vi.fn(),
  resolveCopilotCliMock: vi.fn(),
  startAcpAuthenticationMock: vi.fn(),
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
  return { ...actual, agentLaunchPath: agentLaunchPathMock, resolveCopilotCli: resolveCopilotCliMock };
});

vi.mock("../acp-sign-in", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../acp-sign-in")>();
  return { ...actual, startAcpAuthentication: startAcpAuthenticationMock };
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
  clientFactory?: (provider: AgentClient["provider"]) => AgentClient;
  accounts?: ProviderAccountStore;
}): ProviderRuntime {
  const clientFactory = options.clientFactory;
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
    clientFactory: clientFactory ? (provider) => clientFactory(provider) : null,
    bundledExecutables: {},
    credentials,
    redactMcp: (text) => text,
    ...(options.accounts ? { accounts: options.accounts } : {}),
  });
}

function createBuiltInClient(provider: AgentClient["provider"]): AgentClient {
  const client: AgentClient = {
    provider,
    running: false,
    start: () => undefined,
    stop: () => Effect.void,
    request: <T>(method: string, _params: unknown, decoder: (value: unknown) => T) => {
      let response: unknown = {};
      if (method === "initialize") response = {};
      if (method === "account/read")
        response = {
          account: {
            type: "chatgpt",
            email: "copilot@example.com",
            planType: "pro",
          },
          requiresOpenaiAuth: false,
        };
      if (method === "model/list") response = { data: [] };
      return Effect.sync(() => decoder(response));
    },
    notify: () => undefined,
    respond: () => undefined,
    respondError: () => undefined,
    on: () => client,
    once: () => client,
    off: () => client,
  };
  return client;
}

function createBuiltInSignedOutClient(provider: AgentClient["provider"]): AgentClient {
  const client: AgentClient = {
    provider,
    running: false,
    start: () => undefined,
    stop: () => Effect.void,
    request: <T>(method: string, _params: unknown, decoder: (value: unknown) => T) => {
      let response: unknown = {};
      if (method === "initialize") response = {};
      if (method === "account/read") response = { account: null, requiresOpenaiAuth: false };
      if (method === "model/list") response = { data: [] };
      return Effect.sync(() => decoder(response));
    },
    notify: () => undefined,
    respond: () => undefined,
    respondError: () => undefined,
    on: () => client,
    once: () => client,
    off: () => client,
  };
  return client;
}

async function initializeBuiltInCopilot(runtime: ProviderRuntime, launchPath: string | null = null): Promise<void> {
  resolveCopilotCliMock.mockImplementationOnce(() =>
    Effect.succeed({
      executable: "/usr/local/bin/copilot",
      version: "1.0.0",
      source: "system",
      launchPath: launchPath ?? undefined,
    }),
  );
  await Effect.runPromise(runtime.refreshProvider("copilot"));
}

async function readBuiltInUsage(runtime: ProviderRuntime) {
  const usage = await Effect.runPromise(runtime.usage());
  return usage.limits.find((limit) => limit.id === "copilot")?.primary ?? null;
}

describe("ProviderRuntime customAgentUsage copilot cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T18:00:00.000Z"));
    readCopilotQuotaMock.mockReset();
    resolveAgentCommandMock.mockReset();
    agentLaunchPathMock.mockReset();
    resolveCopilotCliMock.mockReset();
    resolveAgentCommandMock.mockImplementation((command: string) => Effect.succeed(command));
    agentLaunchPathMock.mockImplementation(() => Effect.succeed(null));
    resolveCopilotCliMock.mockImplementation(() =>
      Effect.succeed({
        executable: "/usr/local/bin/copilot",
        version: "1.0.0",
        source: "system",
      }),
    );
    startAcpAuthenticationMock.mockReset();
    startAcpAuthenticationMock.mockImplementation(() => Effect.succeed({ done: Effect.void }));
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

  it("uses built-in Copilot launch config and reuses for five minutes", async () => {
    const runtime = createRuntime({
      customAgents: () => [],
      agentEnvironment: () => ({ COPILOT_PROFILE: "main", EXTRA_FLAG: "1" }),
      clientFactory: createBuiltInClient,
    });
    await initializeBuiltInCopilot(runtime, "/custom/path");
    readCopilotQuotaMock.mockResolvedValue({ quota: readyQuota(), text: null });

    const first = await readBuiltInUsage(runtime);
    expect(first).not.toBeNull();
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);
    expect(readCopilotQuotaMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        executable: "/usr/local/bin/copilot",
        args: COPILOT_ARGV,
        launchPath: "/custom/path",
        timeoutMs: 30_000,
      }),
    );
    expect(readCopilotQuotaMock.mock.calls[0]?.[0]?.env).toMatchObject({
      ...COPILOT_ENV,
      COPILOT_PROFILE: "main",
      EXTRA_FLAG: "1",
    });
    expect(readCopilotQuotaMock.mock.calls[0]?.[0]?.cwd).toBe(customAgentDiscoveryFolder("builtin-copilot-quota"));

    vi.setSystemTime(new Date("2026-11-04T18:03:59.000Z"));
    await readBuiltInUsage(runtime);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-04T18:04:01.000Z"));
    await readBuiltInUsage(runtime);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-04T18:08:02.000Z"));
    await readBuiltInUsage(runtime);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent built-in Copilot polls", async () => {
    vi.useRealTimers();
    const runtime = createRuntime({ customAgents: () => [], clientFactory: createBuiltInClient });
    await initializeBuiltInCopilot(runtime);
    let resolveRead!: (value: { quota: CustomAgentQuota; text: string | null }) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    readCopilotQuotaMock.mockImplementation(
      () =>
        new Promise<{ quota: CustomAgentQuota; text: string | null }>((resolve) => {
          markStarted();
          resolveRead = resolve;
        }),
    );

    const first = readBuiltInUsage(runtime);
    const second = readBuiltInUsage(runtime);
    await started;
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);
    resolveRead({ quota: readyQuota(), text: null });

    const [left, right] = await Promise.all([first, second]);
    expect(left).toEqual(right);
    expect(left).not.toBeNull();
  });

  it("clears built-in Copilot usage on ready→no-data→error after invalidation", async () => {
    const runtime = createRuntime({ customAgents: () => [], clientFactory: createBuiltInClient });
    await initializeBuiltInCopilot(runtime);
    readCopilotQuotaMock
      .mockResolvedValueOnce({ quota: readyQuota(), text: null })
      .mockResolvedValueOnce({ quota: { state: "no-data" }, text: null })
      .mockResolvedValueOnce({
        quota: { state: "error", messageKey: "account.usage.value.unavailable" },
        text: null,
      });

    const first = await Effect.runPromise(runtime.usage());
    expect(first.limits).toHaveLength(1);

    await Effect.runPromise(runtime.reloadAgentEnvironment());
    const second = await Effect.runPromise(runtime.usage());
    expect(second.limits).toEqual([]);

    await Effect.runPromise(runtime.reloadAgentEnvironment());
    const third = await Effect.runPromise(runtime.usage());
    expect(third.limits).toEqual([]);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(3);
  });

  it("keeps built-in Copilot usage cache when only custom agents reload", async () => {
    const runtime = createRuntime({ customAgents: () => [], clientFactory: createBuiltInClient });
    await initializeBuiltInCopilot(runtime);
    readCopilotQuotaMock.mockResolvedValue({ quota: readyQuota(), text: null });

    await readBuiltInUsage(runtime);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);

    await Effect.runPromise(runtime.reloadCustomAgents());
    await readBuiltInUsage(runtime);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);
  });

  it("does not spawn built-in Copilot usage reads while provider is off or signed out", async () => {
    const offRuntime = createRuntime({ customAgents: () => [], clientFactory: createBuiltInClient });
    await initializeBuiltInCopilot(offRuntime);
    readCopilotQuotaMock.mockResolvedValue({ quota: readyQuota(), text: null });
    await readBuiltInUsage(offRuntime);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);

    await Effect.runPromise(offRuntime.setProviderOn("copilot", false));
    const offUsage = await Effect.runPromise(offRuntime.usage());
    expect(offUsage.limits).toEqual([]);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);

    readCopilotQuotaMock.mockReset();
    const signedOutRuntime = createRuntime({ customAgents: () => [], clientFactory: createBuiltInSignedOutClient });
    await initializeBuiltInCopilot(signedOutRuntime);
    const signedOutUsage = await Effect.runPromise(signedOutRuntime.usage());
    expect(signedOutUsage.limits).toEqual([]);
    expect(readCopilotQuotaMock).not.toHaveBeenCalled();
  });

  it("clears built-in Copilot usage after explicit Copilot sign-out transition", async () => {
    const runtime = createRuntime({
      customAgents: () => [],
      clientFactory: createBuiltInClient,
      accounts: new ProviderAccountStore("C:/tmp/provider-runtime-test-accounts.json", "C:/tmp/provider-runtime-test"),
    });
    await initializeBuiltInCopilot(runtime);
    readCopilotQuotaMock.mockResolvedValueOnce({ quota: readyQuota(), text: null });

    const beforeSignOut = await Effect.runPromise(runtime.usage());
    expect(beforeSignOut.limits).toHaveLength(1);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);

    await Effect.runPromise(runtime.signOutProvider("copilot"));

    const afterSignOut = await Effect.runPromise(runtime.usage());
    expect(afterSignOut.limits).toEqual([]);
    expect(startAcpAuthenticationMock).toHaveBeenCalledTimes(1);
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);
  });

  it("keeps Copilot usage-limit diagnostics on upstream path (reportsUsage=false)", () => {
    expect(agentProviderDescriptor("copilot").reportsUsage).toBe(false);
  });

  it("keeps Copilot usage-limit handling upstream by skipping post-limit usage refresh reads", async () => {
    const runtime = createRuntime({ customAgents: () => [] });
    const source = createBuiltInClient("copilot");
    const requestSpy = vi.spyOn(source, "request");

    await Effect.runPromise(runtime.refreshUsageAfterLimit(source));

    expect(requestSpy).not.toHaveBeenCalled();
    expect(readCopilotQuotaMock).not.toHaveBeenCalled();
  });

  it("invalidates built-in Copilot identity on reload and stale in-flight result cannot overwrite fresh identity", async () => {
    vi.useRealTimers();
    let profile = "old";
    const runtime = createRuntime({
      customAgents: () => [],
      agentEnvironment: () => ({ COPILOT_PROFILE: profile }),
      clientFactory: createBuiltInClient,
    });
    await initializeBuiltInCopilot(runtime);

    let resolveStale!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    readCopilotQuotaMock.mockImplementationOnce(
      () =>
        new Promise<{ quota: CustomAgentQuota; text: string | null }>((resolve) => {
          markStarted();
          resolveStale = () => resolve({ quota: readyQuota(), text: "stale" });
        }),
    );
    readCopilotQuotaMock.mockResolvedValueOnce({ quota: readyQuota(), text: "fresh" });

    const pendingStale = readBuiltInUsage(runtime);
    await started;
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(1);
    profile = "new";
    await Effect.runPromise(runtime.reloadAgentEnvironment());
    const pendingFresh = readBuiltInUsage(runtime);
    resolveStale();

    await expect(pendingStale).resolves.toBeNull();
    const fresh = await pendingFresh;
    expect(fresh).not.toBeNull();
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(2);

    const reused = await readBuiltInUsage(runtime);
    expect(reused).not.toBeNull();
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(2);
  });

  it("aborts only custom Copilot quota read when custom agents reload while built-in read is still active", async () => {
    vi.useRealTimers();
    const runtime = createRuntime({
      customAgents: () => [copilotAgent("copilot-1")],
      clientFactory: createBuiltInClient,
    });
    await initializeBuiltInCopilot(runtime);

    let customStarted = false;
    let builtInStarted = false;
    let customAborted = false;
    let builtInAborted = false;
    let resolveBuiltIn!: (value: { quota: CustomAgentQuota; text: string | null }) => void;
    readCopilotQuotaMock.mockImplementation((launch: { cwd: string; signal: AbortSignal }) => {
      const builtIn = launch.cwd === customAgentDiscoveryFolder("builtin-copilot-quota");
      if (builtIn) builtInStarted = true;
      else customStarted = true;
      return new Promise<{ quota: CustomAgentQuota; text: string | null }>((resolve, reject) => {
        const failAbort = () => {
          if (builtIn) builtInAborted = true;
          else customAborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (launch.signal.aborted) return failAbort();
        launch.signal.addEventListener("abort", failAbort, { once: true });
        if (builtIn) resolveBuiltIn = resolve;
      });
    });

    const pendingCustom = runUsage(runtime);
    const pendingBuiltIn = readBuiltInUsage(runtime);
    await vi.waitFor(() => expect(customStarted).toBe(true));
    await vi.waitFor(() => expect(builtInStarted).toBe(true));

    await Effect.runPromise(runtime.reloadCustomAgents());

    expect(customAborted).toBe(true);
    expect(builtInAborted).toBe(false);
    resolveBuiltIn({ quota: readyQuota(), text: null });

    await expect(pendingCustom).resolves.toEqual([]);
    await expect(pendingBuiltIn).resolves.not.toBeNull();
    expect(readCopilotQuotaMock).toHaveBeenCalledTimes(2);
  });
});
