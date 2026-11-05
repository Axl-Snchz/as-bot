# Copilot rail quota investigation

Date: 2026-11-04. Base: local `as-bot`, `297d7f2a9`.
Work branch: `feat/copilot-rail-quota`.

## Decision (updated with user contract)

Phase 2 is now implemented across backend adapter, preload/runtime contracts,
renderer/UI, i18n, and docs with the user-supplied billing contract. The
original probe findings stay preserved below as provenance.

Resolved source of truth for this implementation is the user's explicit contract:

> "1 crédito de Copilot = US$0.01. El presupuesto empresarial de John Deere es aparte (tiers hasta US$2,500, reset el día 1 mensualmente) y se comparte con tu trabajo."

This is treated as USER-SUPPLIED product contract, not as official vendor
documentation. Current implementation now:

- uses GitHub-reported limits only (`entitlementRequests`, `usedRequests`,
  `overage`) over a locally implemented SDK RPC protocol and maps them to rail
  credits (`entitlementCredits`, `usedCredits`, `overageCredits`) without
  inferring from percentages;
- computes remaining percent from counters
  (`(1 - usedCredits / entitlementCredits) * 100`);
- refreshes quota every five minutes and accepts dynamic external budget updates;
- keeps runtime free of tier constants (budget amounts are external/user-managed;
  user starts on Standard monthly);
- pins adapter reads to `protocolVersion === 3`; on future mismatch or missing
  payload it returns safe `no-data` instead of stale success;
- includes timeout and logging safety around quota polling failures;
- uses SDK future reset date when valid;
- falls back to estimated next-month day 1 at 00:00 UTC when reset is
  missing/past, then formats that UTC timestamp in local time for display,
  while keeping provider-reported timestamps as authoritative when present;
- keeps no-data/error neutral/error states without stale success ring;
- now reuses the same shared usage row UI as built-in providers (`Usage` header
  + provider row + monthly window), and supersedes the earlier custom Copilot
  popover rows for used credits/USD/shared-note text.
- strengthens shared usage bar legibility in the popover (wider card, 6px bar
  height, neutral track on `--openbot-text-readable`, neutral fill on
  `--openbot-text-primary`) so spent vs left remains visible on dark surfaces.
- rounds Copilot quota remaining labels to whole percentages in shared usage
  rows/aria labels (for example `98% left` instead of `98.3% left`) while
  keeping counter math precision unchanged.

## Original Phase 1 investigation notes (preserved)

## Local checks and actual output

The installed executable reports `GitHub Copilot CLI 1.0.105`.
Both probes used the user's existing `copilot-enterprise.cmd` authentication
wrapper. The probes did not extract, print, or persist its token.

The probe directory was `.openbot-build/copilot-quota-probe`, not a workspace
containing project instructions. No `--allow-all` flag was supplied. Shell,
write, and URL permissions were denied; ACP client permission requests were
cancelled. Built-in MCP servers and Mobbin were disabled, custom instructions
were disabled, account history sync was disabled, and CLI logging was disabled.
ACP sessions received an empty MCP-server list. No agent task or model prompt
was sent. Only the probe-owned child processes were stopped.

### ACP

Initialization returned:

```json
{"protocolVersion":1,"agentInfo":{"name":"Copilot","title":"Copilot","version":"1.0.105"}}
```

The session advertised `usage` in `available_commands_update`. Only after that
check, the probe sent one text block containing exactly `/usage`.

Actual response:

```text
Session Usage

Changes: +0 -0
Requests: 0 AI Credits (2s)
```

Prompt result:

```json
{"stopReason":"end_turn"}
```

Observed update kinds: `agent_message_chunk`, `available_commands_update`.
This output contains no account allowance, account remaining percentage, or reset.
No `usage_update` or account-quota metadata was observed in this probe.
This does not prove that no future CLI version can send such metadata.

### Official SDK RPC

This is a separate protocol, not an ACP extension. A second probe launched the
same wrapper with `--headless --no-auto-update --stdio`. It used the SDK source's
Content-Length framing. It called only `ping` and `account.getQuota` with empty
parameters. It did not create a session.

`ping` returned protocol 3 at `2026-11-04T23:22:32.4143204Z`.
The quota response contained `chat`, `completions`, and `premium_interactions`.
Selected fields from the actual `premium_interactions` snapshot:

```json
{
  "entitlementRequests": 250000,
  "usedRequests": 4250,
  "remainingPercentage": 98.3,
  "overage": 0,
  "overageAllowedWithExhaustedQuota": true,
  "resetDate": "2026-11-04T23:07:54.462Z"
}
```

The percentage is arithmetically consistent with the counters. That is not
evidence of their billing unit. The reset date precedes the probe by about
14 minutes 38 seconds. Do not substitute a locally calculated month boundary:
that would hide the disagreement with the provider response.

The `chat` and `completions` snapshots each reported entitlement 0, usage 0,
remaining 100%, and the same past reset date. Do not turn these zero allowances
into usage rings.

### Probe failures

The first ACP launch attempts failed before initialization because
`--deny-tool '*'` is not a valid permission rule. CLI error:
`Invalid --deny-tool value. Error: Invalid rule format: *`.
Replacing it with supported `shell`, `write`, and `url` denial rules allowed
the probe to run. No prompt was sent by the failed launches.

Both completed Python probe commands exited 0. Their source remains as ignored
local artifacts:

- `.openbot-build/copilot-quota-probe/probe.py`
- `.openbot-build/copilot-quota-probe/sdk-probe.py`

## Existing OpenBot path

- `src/backend/acp-client.ts:867-885`: `readUsageText` obtains text from a
  private prompt and redacts it.
- `src/backend/acp-client.ts:897-918`: the private session uses `session/new`
  with no MCP servers, then sends one text block through `session/prompt`.
- `src/backend/custom-acp-agents-client.ts:295-305`: the custom-agent router
  delegates that usage prompt to its child.
- `src/backend/agent/provider-runtime.ts:1188-1258`: custom-agent answers are
  text, not structured quota windows. Polling, caching, and failed-read reuse
  already exist. A failed read can retain the previous text.
- `src/renderer/src/features/custom-agents/custom-agent-usage-polling.ts:10-24`:
  the rail polls configured usage prompts on the local server.
- `src/renderer/src/features/custom-agents/custom-agent-rail-rows.ts:11-18`:
  rows map answer text by saved agent ID.
- `packages/ui/src/features/window/PageRail.tsx:153-162`: the custom-agent
  popover shows that text or `app.rail.customAgentNoUsage`.
- `src/backend/acp-client.ts:2309-2330`: ACP `usage_update.used` and `.size`
  become context-token usage, not account quota.

`usagePrompt: "/usage"` can therefore display the session response as plain
text. It cannot supply a truthful account ring from this observed output.
Do not use a natural-language request to ask the model to invent account usage.
Do not enable background polling of a prompt unless command dispatch and billing
behavior are known for that agent.

## Official evidence

1. [Copilot ACP slash commands](https://github.com/github/docs/blob/main/content/copilot/reference/copilot-cli-reference/acp-server.md#L196-L206)
   and [command advertisement](https://github.com/github/docs/blob/main/content/copilot/reference/copilot-cli-reference/acp-server.md#L244-L248):
   informational `/usage` returns output without invoking the model. Unsupported
   commands can instead become model prompts. The probe checked advertisement.
   This supports a no-model call; it is not a blanket billing guarantee.
2. [CLI changelog](https://github.com/github/copilot-cli/blob/main/changelog.md#L1879-L1882):
   ACP `/usage` support was added in 1.0.39.
   [1.0.78 notes](https://github.com/github/copilot-cli/blob/main/changelog.md#L653-L664)
   describe token usage in prompt results and `usage_update`.
3. [ACP usage schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.json#L4257-L4292):
   `used` is context tokens, `size` is context capacity, and optional cost is
   cumulative session cost. `_meta` has no generic account-quota meaning.
4. [Official SDK quota guide, pinned source](https://github.com/github/copilot-sdk/blob/c072001600018fe166910cfcb6eb42e769b9209d/docs/features/usage-and-billing.md#L1155-L1199):
   `account.getQuota({})` reads the authenticated user's entitlement. Its
   example calls the category "Premium interactions". The documented fields
   describe requests and a reset date, but do not establish an enterprise
   AI-credit conversion for the observed counters.
5. [Generated reset-date definition, pinned source](https://github.com/github/copilot-sdk/blob/c072001600018fe166910cfcb6eb42e769b9209d/java/sdk/src/generated/java/com/github/copilot/generated/rpc/AccountQuotaSnapshot.java#L25-L40):
   `resetDate` means the date when quota resets, not a snapshot timestamp.
6. [Enterprise AI-credit billing, pinned source](https://github.com/github/docs/blob/58b7b56aa507ad1269b9f8e9e89a172f0976c7ce/content/copilot/concepts/billing-and-usage/organizations-and-enterprises/billing.md#L58-L73):
   enterprise credits are pooled and reset monthly on day 1 at 00:00 UTC.
   This does not explain the returned November 4 date.
7. [SDK cost units, pinned source](https://github.com/github/copilot-sdk/blob/c072001600018fe166910cfcb6eb42e769b9209d/docs/features/usage-and-billing.md#L669-L682):
   session `totalNanoAiu` is a distinct cost field. Its unit does not establish
   the quota counter unit.
8. [SDK CLI launch, pinned source](https://github.com/github/copilot-sdk/blob/9bc718cb608c4cd3b63e0e71c637dcf1ebfd5409/nodejs/src/client.ts#L3186-L3198),
   [framing](https://github.com/github/copilot-sdk/blob/9bc718cb608c4cd3b63e0e71c637dcf1ebfd5409/go/internal/jsonrpc2/frame.go#L49-L91),
   and [quota result schema](https://github.com/github/copilot-sdk/blob/9bc718cb608c4cd3b63e0e71c637dcf1ebfd5409/nodejs/src/generated/rpc.ts#L8116-L8164):
   the transport and method have official source evidence, but the quota
   surface is experimental. The original probe above was diagnostic-only; the
   current branch now uses this official experimental RPC in production code
   with protocol pinning and safe fallback behavior.
9. [Personal usage monitoring](https://github.com/github/docs/blob/main/content/copilot/how-tos/manage-and-track-spending/monitor-ai-usage.md#L15-L22):
   Business and Enterprise users can view individual AI-credit consumption
   in personal Copilot settings.
10. [Official REST billing reports](https://docs.github.com/en/rest/billing/usage):
    organization reports require administrator access. User billing-report
    permissions do not prove access to an enterprise-funded seat's allowance.
    No REST billing request was attempted.

## Remaining open contract questions

1. Ask GitHub for the documented enterprise meaning of these quota counters
   and the stale `resetDate`. Include CLI version and sanitized values.
2. Treat request→credit conversion as USER-SUPPLIED mapping only until GitHub
   publishes official enterprise billing-unit documentation.
3. Keep personal Copilot settings and admin billing reports as external checks.

No private GitHub endpoint, `gh api`, GitHub write operation, fetch, reset, push,
PR, or merge was used. The dev stack and `%APPDATA%\OpenBot` were not touched.
No SDK session was created, and no model inference was requested. The observed
ACP command reported 0 AI Credits. This investigation did not poll either source.

## Verification scope

Latest shared-UI follow-up: seven targeted files passed (150 tests), plus four
new whole-percent warning-cutoff cases passed in a ten-test quota-view rerun.
Node/renderer typechecks, `i18n:check`, 45-file scoped Biome, and whitespace
checks passed. The same-mount regression covers no-data, ready, and error states.
The display rounds remaining share and selects warning tone from that same
whole percentage, as built-in providers do.

Copilot now uses the actual built-in usage components, with a Monthly row and
compact countdown. All providers show a translated percent-left value. The
credits/USD/shared-budget rows and their unused strings were removed. The
optional native credits/USD tooltip was not added.

This report documents both preserved probe provenance and the current production
integration choice (locally implemented SDK RPC protocol + safeguards). Code/test
verification for implementation files is tracked in the task handoff.

The six affected test files passed (148 tests). Node and renderer typechecks,
`i18n:check`, file-scoped Biome, and whitespace checks passed. Biome retains
three dependency-injection warnings in the new runtime regression test: the
test replaces module-level command resolution, launch-path lookup, and quota
reads because the runtime has no injectable seam for those operations.
No lint suppression or production-only test hook was added.

Architecture review approved the integrated changes after cache-generation,
shutdown-race, counter-authority, and date-format corrections, including UTC
day-1 estimation with local-time rendering for `America/Mexico_City`.

Live browser verification is blocked: `bun run dev:automation instances` could
not read permissions on the dev-instance registry. No screenshot was captured,
no permissions were changed, and the running dev stack was not stopped.
The logo, ring, and popover still need a live visual check when registry access
is available. No claim of live visual approval is made.

Contrast caveat for unchanged warning/danger fills: those status hues are kept
as-is per product requirement and do not reach a 3:1 ratio against the neutral
track in all themes; percent text duplicates the state value.
