import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import {
  type CustomAgentQuota,
  type CustomAgentQuotaReady,
  customAgentCommandBasename,
  isCopilotAgentCommand,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { cliSpawnTarget } from "./cli";
import { stopProcessTree } from "./windows-process-tree";

const DISABLE_MCP_SERVER = "--disable-mcp-server";
const REQUIRED_FLAGS = [
  "--headless",
  "--no-auto-update",
  "--stdio",
  "--log-level=none",
  "--sync-session=off",
  "--disable-builtin-mcps",
] as const;
const COPILOT_SDK_PROTOCOL_VERSION = 3;

const MAX_STDOUT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 32 * 1024;

export const COPILOT_CREDIT_USD = 0.01;
export const COPILOT_QUOTA_CACHE_MS = 5 * 60_000;
const QUOTA_IDENTITY_SALT = randomBytes(32);
const QUOTA_DECIMAL_SCALE = 1_000_000;

export interface CopilotQuotaSnapshot {
  entitlementRequests: number;
  usedRequests: number;
  overageRequests: number;
  remainingPercentage: number;
  resetDate: string | null;
}

export interface CopilotQuotaLaunchConfig {
  executable: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  launchPath: string | null;
  cwd?: string | null;
  timeoutMs: number;
}

interface CopilotQuotaInvoke {
  ping: unknown;
  quota: unknown;
}

export interface CopilotQuotaRpcDependencies {
  stopProcess?: (child: ReturnType<typeof spawn>) => Effect.Effect<void, unknown>;
}

export interface CopilotQuotaReadOptions extends CopilotQuotaLaunchConfig {
  invoke?: (launch: CopilotQuotaLaunchConfig, signal: AbortSignal) => Promise<CopilotQuotaInvoke>;
  signal?: AbortSignal;
}

function normalizeQuotaValue(value: number): number {
  return Math.round(value * QUOTA_DECIMAL_SCALE) / QUOTA_DECIMAL_SCALE;
}

function saltedQuotaDigest(material: string): string {
  return createHash("sha256").update(QUOTA_IDENTITY_SALT).update(material).digest("hex");
}

export function copilotCommandBasename(command: string): string {
  return customAgentCommandBasename(command);
}

export function isCopilotCommand(command: string, executable?: string): boolean {
  return isCopilotAgentCommand(command, executable);
}

export function sanitizeCopilotQuotaArgs(args: readonly string[]): string[] {
  const disabledMcpServers = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index] ?? "";
    if (current.startsWith(`${DISABLE_MCP_SERVER}=`)) {
      const value = current.slice(`${DISABLE_MCP_SERVER}=`.length).trim();
      if (value.length > 0) disabledMcpServers.add(value);
      continue;
    }
    if (current === DISABLE_MCP_SERVER && index + 1 < args.length) {
      const value = (args[index + 1] ?? "").trim();
      if (value.length > 0) disabledMcpServers.add(value);
      index += 1;
    }
  }
  const disabledServerFlags = [...disabledMcpServers].flatMap((name) => [DISABLE_MCP_SERVER, name]);
  return [...disabledServerFlags, ...REQUIRED_FLAGS];
}

export function quotaIdentity(input: {
  executable: string;
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  launchPath: string | null;
}): string {
  const env = Object.entries(input.env).sort(([left], [right]) => left.localeCompare(right));
  const material = JSON.stringify({
    command: input.command,
    executable: input.executable,
    args: sanitizeCopilotQuotaArgs(input.args),
    env,
    launchPath: input.launchPath,
  });
  return saltedQuotaDigest(material);
}

export function copilotUsageSettingsFingerprint(input: {
  command: string;
  args: readonly string[];
  env: readonly { readonly name: string; readonly value: string }[];
}): string {
  const env = [...input.env]
    .map((pair): [string, string] => [pair.name, pair.value])
    .sort(([left], [right]) => left.localeCompare(right));
  const material = JSON.stringify({ command: input.command, args: [...input.args], env });
  return saltedQuotaDigest(material);
}

export function parseCopilotQuotaSnapshot(value: unknown): CopilotQuotaSnapshot | null {
  if (!isDynamicRecord(value)) return null;
  const record = value;
  const entitlementRequests = record.entitlementRequests;
  const usedRequests = record.usedRequests;
  const overage = record.overage;
  const resetDate = record.resetDate;
  const normalizedResetDate =
    typeof resetDate === "string" && resetDate.length > 0 && !Number.isNaN(Date.parse(resetDate)) ? resetDate : null;
  const overageRequests = overage === undefined ? 0 : overage;
  if (
    typeof entitlementRequests !== "number" ||
    !Number.isFinite(entitlementRequests) ||
    entitlementRequests <= 0 ||
    typeof usedRequests !== "number" ||
    !Number.isFinite(usedRequests) ||
    usedRequests < 0 ||
    typeof overageRequests !== "number" ||
    !Number.isFinite(overageRequests) ||
    overageRequests < 0
  )
    return null;
  const remainingRequests = Math.max(0, entitlementRequests - usedRequests);
  const normalizedRemainingPercentage = Math.max(
    0,
    Math.min(100, normalizeQuotaValue((remainingRequests / entitlementRequests) * 100)),
  );
  return {
    entitlementRequests,
    usedRequests,
    overageRequests,
    remainingPercentage: normalizedRemainingPercentage,
    resetDate: normalizedResetDate,
  };
}

export function formatCopilotQuotaReady(snapshot: CopilotQuotaSnapshot): {
  quota: CustomAgentQuotaReady;
  text: string;
} {
  const usedCredits = snapshot.usedRequests;
  const remainingCredits = normalizeQuotaValue(Math.max(0, snapshot.entitlementRequests - snapshot.usedRequests));
  return {
    quota: {
      state: "ready",
      entitlementCredits: snapshot.entitlementRequests,
      usedCredits,
      overageCredits: snapshot.overageRequests,
      remainingCredits,
      remainingPercentage: snapshot.remainingPercentage,
      resetDate: snapshot.resetDate,
      creditUsd: COPILOT_CREDIT_USD,
    },
    text: "",
  };
}

export async function readCopilotQuota(
  options: CopilotQuotaReadOptions,
): Promise<{ quota: CustomAgentQuota; text: string | null }> {
  const signal = options.signal ?? new AbortController().signal;
  try {
    const invoke = options.invoke ?? invokeCopilotQuotaRpc;
    const result = await invoke(options, signal);
    if (!isCopilotSdkPing(result.ping)) return { quota: { state: "no-data" }, text: null };
    const quotaResult = parseCopilotQuotaResponse(result.quota);
    if (!quotaResult) return { quota: { state: "no-data" }, text: null };
    const ready = formatCopilotQuotaReady(quotaResult);
    return { quota: ready.quota, text: ready.text };
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    return { quota: { state: "error", messageKey: "account.usage.value.unavailable" }, text: null };
  }
}

function parseCopilotQuotaResponse(value: unknown): CopilotQuotaSnapshot | null {
  if (!isDynamicRecord(value)) return null;
  const quotaSnapshots = value.quotaSnapshots;
  if (!isDynamicRecord(quotaSnapshots)) return null;
  const premium = quotaSnapshots.premium_interactions;
  return parseCopilotQuotaSnapshot(premium);
}

function isCopilotSdkPing(value: unknown): boolean {
  if (!isDynamicRecord(value)) return false;
  return value.protocolVersion === COPILOT_SDK_PROTOCOL_VERSION;
}

export async function invokeCopilotQuotaRpc(
  launch: CopilotQuotaLaunchConfig,
  signal: AbortSignal,
  dependencies: CopilotQuotaRpcDependencies = {},
): Promise<CopilotQuotaInvoke> {
  const stopProcess = dependencies.stopProcess ?? stopProcessTree;
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const rpc = cliSpawnTarget(launch.executable, sanitizeCopilotQuotaArgs(launch.args));
  const child = spawn(rpc.command, rpc.args, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: rpc.windowsVerbatimArguments,
    cwd: launch.cwd ?? homedir(),
    env: {
      ...process.env,
      ...(launch.launchPath ? { PATH: launch.launchPath } : {}),
      ...launch.env,
    },
  });
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let buffer = Buffer.alloc(0);
  let stopping = false;
  let ended = false;
  let stopPromise: Promise<void> | null = null;
  const stopChild = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    if (stopping) return Promise.resolve();
    stopping = true;
    stopPromise = Effect.runPromise(stopProcess(child).pipe(Effect.catch(() => Effect.void)));
    return stopPromise;
  };
  const pending = new Map<number, { resolve: (value: DynamicRecord | null) => void; reject: (error: Error) => void }>();
  const fail = (error: Error) => {
    ended = true;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    void stopChild();
  };

  const respondMethodNotFound = (id: number): void => {
    if (ended || child.stdin.destroyed || !Number.isInteger(id)) return;
    const body = Buffer.from(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found" },
      }),
      "utf8",
    );
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n${body.toString("utf8")}`);
  };

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      fail(new Error("Copilot quota output exceeded limit."));
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator < 0) return;
      const header = buffer.subarray(0, separator).toString("utf8");
      const contentLengthHeader = header.split("\r\n").find((line) => line.toLowerCase().startsWith("content-length:"));
      if (!contentLengthHeader) {
        fail(new Error("Copilot quota response has no content length."));
        return;
      }
      const contentLength = Number.parseInt(contentLengthHeader.slice("content-length:".length).trim(), 10);
      if (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_STDOUT_BYTES) {
        fail(new Error("Copilot quota response has invalid content length."));
        return;
      }
      const bodyStart = separator + 4;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) return;
      const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.subarray(bodyEnd);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        fail(new Error("Copilot quota response is not JSON."));
        return;
      }
      if (!isDynamicRecord(parsed)) {
        fail(new Error("Copilot quota response is not an object."));
        return;
      }
      const method = parsed.method;
      if (typeof method === "string") {
        if (typeof parsed.id === "number") respondMethodNotFound(parsed.id);
        continue;
      }
      const id = parsed.id;
      if (typeof id === "number") {
        const request = pending.get(id);
        if (!request) continue;
        pending.delete(id);
        if (parsed.error !== undefined) request.reject(new Error("Copilot quota request failed."));
        else request.resolve(isDynamicRecord(parsed.result) ? parsed.result : null);
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes > MAX_STDERR_BYTES) fail(new Error("Copilot quota diagnostics exceeded limit."));
  });

  child.on("error", () => {
    ended = true;
    fail(new Error("Copilot quota launch failed."));
  });
  child.on("exit", () => {
    ended = true;
    if (pending.size > 0) fail(new Error("Copilot quota process stopped."));
  });
  child.stdin.on("error", () => fail(new Error("Copilot quota request stream failed.")));
  const abort = () => fail(new DOMException("Aborted", "AbortError"));
  signal.addEventListener("abort", abort, { once: true });

  const send = (id: number, method: string) => {
    if (ended) throw new Error("Copilot quota process stopped.");
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params: {} }), "utf8");
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n${body.toString("utf8")}`);
  };

  const request = (id: number, method: string): Promise<DynamicRecord | null> =>
    new Promise((resolve, reject) => {
      if (ended) {
        reject(new Error("Copilot quota process stopped."));
        return;
      }
      pending.set(id, { resolve, reject });
      try {
        send(id, method);
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error("Copilot quota process stopped."));
      }
    });

  const timeout = setTimeout(() => fail(new Error("Copilot quota request timed out.")), launch.timeoutMs);
  timeout.unref?.();
  try {
    const ping = await request(1, "ping");
    if (!isCopilotSdkPing(ping)) return { ping, quota: null };
    const quota = await request(2, "account.getQuota");
    return { ping, quota };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    child.stdin.end();
    await stopChild();
  }
}
