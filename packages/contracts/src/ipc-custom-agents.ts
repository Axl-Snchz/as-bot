// A custom agent is a command that the user names: OpenBot starts it on this computer and talks to
// it over the Agent Client Protocol on stdio. All custom agents are the one provider `acp`, and a
// model id names the agent (`<customAgentId>/<agentModel>`).
//
// The environment values are the secret half. They travel renderer-to-main on `save` and `check`,
// and never come back: the summary has the names only, and its guard refuses a row that has more.

import { isCustomAgentId, isNewCustomAgentId } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isFiniteNumber, isNullableBoundedString } from "./ipc-bounded-values";
import { CUSTOM_PROVIDER_RESTARTS, type CustomProviderRestart } from "./ipc-custom-providers";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

const WINDOWS_COMMAND_EXTENSIONS = [".cmd", ".exe", ".bat", ".com", ".ps1"] as const;
const COPILOT_AGENT_COMMANDS = new Set(["copilot", "copilot-enterprise"]);

export const CUSTOM_AGENT_LIMITS = {
  agents: 16,
  command: 1_024,
  args: 32,
  arg: 1_024,
  env: 16,
  envValue: 4_096,
  capabilities: 32,
  checkModels: 256,
  usagePrompt: 256,
  usageAnswer: 4_000,
} as const;

/** A POSIX environment variable name. */
export const CUSTOM_AGENT_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `value: null` keeps the value that main holds for this name. A new agent has none to keep. */
export interface CustomAgentEnvInput {
  name: string;
  value: string | null;
}

/**
 * Renderer to main. Adds an agent, or replaces the saved agent with this id. Nothing on this path
 * may log an environment value.
 */
export interface SaveCustomAgentInput {
  id: string;
  name: string;
  /** An absolute path, a path in the home folder, or a command name that PATH resolves. */
  command: string;
  args: string[];
  env: CustomAgentEnvInput[];
  /**
   * The prompt that OpenBot sends, in a session that no thread owns, to read the plan usage, such as
   * `/usage`. Null for none. One line.
   */
  usagePrompt: string | null;
}

export interface DeleteCustomAgentInput {
  id: string;
}

/** Main to renderer. The environment values never come back. */
export interface CustomAgentSummary {
  id: string;
  name: string;
  command: string;
  args: string[];
  envNames: string[];
  /**
   * Absent in the result of a registry install from a server: the released `acp-registry-v1` codec
   * keeps only the fields it knew, and the next list carries the value.
   */
  usagePrompt?: string | null | undefined;
  /** The file that the command starts, or null when it cannot be found now. */
  resolvedCommand: string | null;
}

/** Main to renderer. The answer of one agent to its usage prompt, as plain text with secrets redacted. */
export interface CustomAgentUsage {
  id: string;
  text: string;
  quota?: CustomAgentQuota | undefined;
}

export interface CustomAgentQuotaReady {
  state: "ready";
  entitlementCredits: number;
  /** Credits used as reported by SDK usedRequests; overage is reported separately. */
  usedCredits: number;
  /** Additional usage charged after entitlement exhaustion. */
  overageCredits: number;
  remainingCredits: number;
  remainingPercentage: number;
  /** Null or absent means the CLI did not report a usable reset date. */
  resetDate?: string | null | undefined;
  /** Business rule for this custom contract: one Copilot credit equals one cent in USD. */
  creditUsd: number;
}

export interface CustomAgentQuotaError {
  state: "error";
  /** Existing source key that the renderer can localize. */
  messageKey: "account.usage.value.unavailable";
}

export type CustomAgentQuota = CustomAgentQuotaReady | { state: "no-data" } | CustomAgentQuotaError;

export interface CustomAgentResult {
  agents: CustomAgentSummary[];
  restart: CustomProviderRestart;
}

/**
 * One trial start: main runs the command, sends `initialize`, opens one session to read the
 * models, and stops it. `savedAgentId` names the
 * saved agent whose kept environment values a `null` value takes.
 */
export interface CheckCustomAgentInput {
  command: string;
  args: string[];
  env: CustomAgentEnvInput[];
  savedAgentId?: string;
}

/** What the agent said about itself. A failed check rejects with the reason. */
export interface CustomAgentCheckResult {
  agentName: string;
  version: string | null;
  protocolVersion: number;
  /** Capability names as the agent reports them, such as `loadSession` or `image`. */
  capabilities: string[];
  /** The names of the models that a new session lists. Empty when the agent lists none before sign-in. */
  models: string[];
}

/** A known agent command that the scan found on this computer. It was not started. */
export interface DetectedAcpAgent {
  /** A free custom agent id to suggest. */
  id: string;
  name: string;
  /** The full path, so the saved agent does not depend on PATH. */
  command: string;
  args: string[];
}

export function customAgentCommandBasename(command: string): string {
  const normalized = command.trim().replace(/\\/gu, "/").toLowerCase();
  let base = normalized.split("/").at(-1) ?? "";
  while (base.length > 0) {
    const extension = WINDOWS_COMMAND_EXTENSIONS.find((candidate) => base.endsWith(candidate));
    if (!extension || base.length === extension.length) break;
    base = base.slice(0, -extension.length);
  }
  return base;
}

export function isCopilotAgentCommand(command: string, resolvedCommand?: string | null): boolean {
  if (COPILOT_AGENT_COMMANDS.has(customAgentCommandBasename(command))) return true;
  return resolvedCommand ? COPILOT_AGENT_COMMANDS.has(customAgentCommandBasename(resolvedCommand)) : false;
}

function isArgs(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= CUSTOM_AGENT_LIMITS.args &&
    value.every((arg) => isBoundedString(arg, CUSTOM_AGENT_LIMITS.arg))
  );
}

/** One line: the prompt goes to the agent as it is, so a line break would send a second instruction. */
export function isCustomAgentUsagePrompt(value: unknown): value is string {
  return isBoundedString(value, CUSTOM_AGENT_LIMITS.usagePrompt) && value.trim().length > 0 && !/[\0\r\n]/.test(value);
}

export function isCustomAgentEnvName(value: unknown): value is string {
  return isBoundedString(value, INPUT_LIMITS.identifier) && CUSTOM_AGENT_ENV_NAME_PATTERN.test(value);
}

/** Fails closed: a row with an `env`, `secret` or `value` key is refused, and so is the whole list. */
export function isCustomAgentSummary(value: unknown): value is CustomAgentSummary {
  return (
    isDynamicRecord(value) &&
    !("env" in value) &&
    !("secret" in value) &&
    !("value" in value) &&
    isString(value.id) &&
    isCustomAgentId(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.command, CUSTOM_AGENT_LIMITS.command) &&
    isArgs(value.args) &&
    Array.isArray(value.envNames) &&
    value.envNames.length <= CUSTOM_AGENT_LIMITS.env &&
    value.envNames.every(isCustomAgentEnvName) &&
    (value.usagePrompt === undefined || value.usagePrompt === null || isCustomAgentUsagePrompt(value.usagePrompt)) &&
    isNullableBoundedString(value.resolvedCommand, CUSTOM_AGENT_LIMITS.command)
  );
}

export function isCustomAgentResult(value: unknown): value is CustomAgentResult {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.agents) &&
    value.agents.length <= CUSTOM_AGENT_LIMITS.agents &&
    value.agents.every(isCustomAgentSummary) &&
    isOneOf(CUSTOM_PROVIDER_RESTARTS, value.restart)
  );
}

export function isCustomAgentUsage(value: unknown): value is CustomAgentUsage {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isCustomAgentId(value.id) &&
    isBoundedString(value.text, CUSTOM_AGENT_LIMITS.usageAnswer) &&
    (value.quota === undefined || isCustomAgentQuota(value.quota))
  );
}

function isCustomAgentQuotaReady(value: unknown): value is CustomAgentQuotaReady {
  return (
    isDynamicRecord(value) &&
    value.state === "ready" &&
    isFiniteNumber(value.entitlementCredits) &&
    value.entitlementCredits >= 0 &&
    isFiniteNumber(value.usedCredits) &&
    value.usedCredits >= 0 &&
    isFiniteNumber(value.overageCredits) &&
    value.overageCredits >= 0 &&
    isFiniteNumber(value.remainingCredits) &&
    value.remainingCredits >= 0 &&
    isFiniteNumber(value.remainingPercentage) &&
    (value.resetDate === undefined ||
      value.resetDate === null ||
      (isBoundedString(value.resetDate, 80) && !/[\0\r\n]/.test(value.resetDate))) &&
    isFiniteNumber(value.creditUsd) &&
    value.creditUsd > 0
  );
}

function isCustomAgentQuotaError(value: unknown): value is CustomAgentQuotaError {
  return isDynamicRecord(value) && value.state === "error" && value.messageKey === "account.usage.value.unavailable";
}

export function isCustomAgentQuota(value: unknown): value is CustomAgentQuota {
  return (
    (isDynamicRecord(value) && value.state === "no-data") ||
    isCustomAgentQuotaReady(value) ||
    isCustomAgentQuotaError(value)
  );
}

export function isCustomAgentCheckResult(value: unknown): value is CustomAgentCheckResult {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.agentName, INPUT_LIMITS.agentName) &&
    isNullableBoundedString(value.version, 160) &&
    typeof value.protocolVersion === "number" &&
    Number.isInteger(value.protocolVersion) &&
    Array.isArray(value.capabilities) &&
    value.capabilities.length <= CUSTOM_AGENT_LIMITS.capabilities &&
    value.capabilities.every((name) => isBoundedString(name, INPUT_LIMITS.identifier)) &&
    Array.isArray(value.models) &&
    value.models.length <= CUSTOM_AGENT_LIMITS.checkModels &&
    value.models.every((name) => isBoundedString(name, INPUT_LIMITS.modelName))
  );
}

export function isDetectedAcpAgent(value: unknown): value is DetectedAcpAgent {
  return (
    isDynamicRecord(value) &&
    !("env" in value) &&
    isString(value.id) &&
    isNewCustomAgentId(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.command, CUSTOM_AGENT_LIMITS.command) &&
    isArgs(value.args)
  );
}
