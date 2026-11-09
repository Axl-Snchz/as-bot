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

## 2026-11-09 built-in rail/picker quota fix

Base: `68bb0f067f77cb53e46a4242429a8a47f70ca0f3` (`origin/as-bot`).
Previous fork: `52f6f4c765a80cd14da7b91b2bc7155a101949cb`.
Branch: `fix/copilot-builtin-quota`.
Worktree: `C:\AS_Repos\openbot-wt-copilot`.
Scope: backend quota adapter, renderer/shared UI, tests, stories, and release note.
The upstream provider descriptor and released IPC contracts stay unchanged.

### Root cause in source

1. `packages/contracts/src/agent-providers.ts:452` remains
   `copilot.reportsUsage: false` (upstream default). UI keeps the override in
   `packages/ui/src/features/account/account-usage-view.ts` so built-in Copilot
   still maps monthly usage rows without changing the descriptor contract.
2. Custom-agent Copilot quota rows stayed enabled, so behavior could show
   custom Copilot quota instead of built-in quota (or duplicate both) unless
   rail/picker selection rules are aligned.
3. The built-in driver (`src/backend/provider-drivers.ts:1279-1340` on the
   base commit) did not supply the ACP `readRateLimits` option. The ACP
   `account/rateLimits/read` handler returns empty limits without that option
   (`src/backend/acp-client.ts:1083-1102`). The provider-wide reader also
   skips providers with `reportsUsage: false`.
4. On the base commit, both `PageRail.tsx:435` and
   `ProviderModelPicker.tsx:404-406` filter out rows with no reported usage
   or no windows. This explains the built-in rail omission and missing
   picker quota, but does not prove why a saved custom row was absent.

### Historical comparison requested (`52f6f4c76..origin/as-bot`)

- `src/renderer/src/features/window/WorkspacePageRail.tsx:75` at
  `52f6f4c76` and `:76` at `68bb0f067` keep
  `customAgentUsage={localAgentUsage()}`; only Library wiring changed.
- `packages/ui/src/features/window/PageRail.tsx` keeps
  `customAgentUsage` + reorder wiring in both ranges; only Library page support
  changed in that diff.

This confirms upstream merge did not remove custom usage wiring; built-in
Copilot absence comes from usage-reporting + presentation path, not from removed
rail plumbing.

### Implemented dedup and fallback contract

- Built-in Copilot quota is preferred when provider status is
  `state === "available"` and `off !== true`.
- When built-in is preferred, rail and picker keep the built-in Copilot row
  visible even with no windows (`no-data`/error), as neutral icon state with no
  success arc; custom Copilot quota presentation is hidden.
- When built-in Copilot is signed out, unavailable, or turned off, built-in
  Copilot usage rows are hidden (including stale limits), and one deterministic
  custom Copilot fallback quota row is shown: the first ready Copilot in saved
  order, or the first saved Copilot if none is ready. Other saved agents and
  their model choices stay intact.
- Custom and built-in invalidation paths remain separate; backend batch refresh
  behavior is tracked separately from this UI selection logic.

### Profile-state caveat

Installed profile state (saved agents, credentials, local cache) is unknown in
this repository review. No claim is made here about installed-profile migration
or corruption.

### Built-in adapter and safety

`ProviderRuntime.usage` reads Copilot before the generic descriptor gate.
It uses the built-in provider's resolved executable, launch path, shared
`COPILOT_ARGV`/`COPILOT_ENV`, and configured agent environment. It does not
fall back to a custom command or copy a custom agent's account credentials.
The CLI resolves its own authentication; this code does not read tokens.
An enterprise custom wrapper can therefore use a different account from the
built-in CLI. A signed-in built-in provider still wins the presentation rule.

The quota-only subprocess uses `builtin-copilot-quota` as its isolated folder.
Session confinement and session server-marker variables are not needed for
this no-session read; authentication environment precedence matches the
built-in launch path. The existing reader sanitizes arguments, disables MCP,
logging, updates, and history sync, and calls only `ping` and `account.getQuota`.
It never opens a model session or sends a prompt.

Reads are serialized and cached for five minutes per launch identity. Existing
visible-window polling requests them. Copilot sign-out, turn-off, CLI reload,
and shared environment changes invalidate the built-in cache. Custom-agent
reload clears only the custom cache. Abort and shutdown stop and await only the
quota reader's own Copilot process trees. No Bun or Node process is stopped.
No-data or error clears the success reading and gives a neutral icon.

The adapter maps monthly counter-derived remaining percentage to the existing
`AccountUsageWindow.usedPercent` complement. A 43,200-minute duration selects
the shared monthly label; it is not a claim that all calendar months have
30 days. A future CLI reset stays authoritative. A missing or past reset uses
the next month's first day at 00:00 UTC. UI labels show whole percent remaining,
not credits or USD.

### Verification and handoff

Integrated targeted command:

```text
bun run test:desktop -- src/backend/copilot-quota.test.ts src/backend/agent/provider-runtime.test.ts src/renderer/src/features/account/account-usage-view.test.ts src/renderer/src/features/window/PageRail.custom-agent-usage.test.tsx src/renderer/src/features/conversation/ProviderModelPickerUsagePreview.test.tsx src/renderer/src/features/custom-agents/custom-agent-copilot-detection.test.ts --maxWorkers=1
```

- Exit 0: 67 tests passed in six files.
- `bun run typecheck`: exit 0, all 15 projects passed.
- Touched-file Biome: exit 0, four module-mocking warnings in runtime tests.
- `bun run i18n:check`: exit 1 on both this fix and an archived base
  `68bb0f067`. The same four Hebrew gaps and stale
  `packages/i18n/untranslated.json` occur on both. No catalog was changed.
- Known Windows baseline files: 96 tests passed, six failed. Four are path
  separators in `scripts/ui-foundation-check.test.ts:30,125,138,156`;
  one is permission mode in `src/backend/openbot-database.test.ts:131`
  (cleanup also reports `EBUSY`); one is separators in
  `src/main/provider-runtime-failure-log.test.ts:51`. These files are unchanged.
  No full suite was run, so this is not a claim that no other failures exist.
- Architect's integrated re-review: Approved.
- Browser verification is blocked: the Windows Storybook supervisor shutdown
  uses process termination, which conflicts with the task's no-Bun/Node-kill
  rule. No server was started and no screenshot was taken. Render tests do
  not replace visual verification.
- Follow-up outside this desktop fix: the web `PageRail` consumer does not
  yet pass the built-in Copilot preference. Its picker can show the quota;
  its rail needs that small hook before claiming web parity.

Design checklist section 12: existing tokens, controls, and states are reused;
no new decorative effects or animation were added. The Copilot logo identifies
the provider, the ring arc reports quota state, and its neutral track preserves
orientation when quota is unavailable. Theme contrast was not checked in a
browser in this task.

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

## Account usage bar contrast (source-resolved, no browser probe)

Measured with `.openbot-build/account-usage-contrast.mjs`, from token sources
(`tokens.css`, `tokens-light.css`, `tokens-native.css`) and explicit compositing:
RGBA track tokens are composited over `--openbot-bg-control`; status tracks use
`color-mix(in srgb, tone 25%, track-base)` with desktop light override
`track-base = --openbot-text-primary`. The translucent dark inset edge is then
composited over its status track, not over the popover surface directly.
Browser measurement is still blocked by
the dev-instance registry permission issue above.

Desktop before (old neutral track for all tones):

- Light warning fill/track: 1.91; light critical fill/track: 1.08.
- Dark warning fill/track: 1.36; dark critical fill/track: 1.23.

Desktop after (implemented):

- Light neutral fill/track 3.83, track/bg 4.81.
- Light warning fill/track 4.76, track/bg 11.97.
- Light critical fill/track 3.30, track/bg 14.74.
- Dark neutral fill/track 3.02, track/bg 5.34.
- Dark warning fill/track (core) 4.09; track body/bg 1.78; dark inset ring edge/bg 6.68.
- Dark critical fill/track (core) 3.05; track body/bg 1.42; dark inset ring edge/bg 6.06.

Known limits kept by product constraint:

- Warning/danger fill hues are unchanged.
- In dark mode, ring edge versus fill is low (warning 1.09, critical 1.40); the
  high-contrast boundary is the track core (fill/core above 3:1).
- Warning fill versus light background remains 2.52 and is unchanged.

Native theoretical rows (not rendered by this desktop path):

- `tokens-native.css` has no `--openbot-text-readable`, so neutral-track recipe
  is unsupported there (`N/A`).
- Native dark status values with border-base match desktop dark theoretical
  status rows: warning 4.09, critical 3.05 fill/track.
- Native light status values are only theoretical:
  - border-base variant: warning 1.69, critical 1.97 fill/track;
  - text-primary-base variant (same recipe intent as desktop light): warning
    4.19, critical 3.64 fill/track.
- Because native uses `@variant light/dark` blocks and this desktop CSS selector
  is `:root[data-openbot-color-scheme="light"]`, the text-primary-base native
  line is documented as theoretical, not as observed cascade behavior.
