import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { AccountUsageProviderRow, AccountUsageTone } from "./account-usage-view";

/** Two tracks in a 34px box, with 4.5px between their centers. */
const RING = { size: 34, stroke: 2.25, spacing: 4.5 };

export interface AccountUsageRingTrack {
  percent: number;
  tone: AccountUsageTone;
}

export interface AccountUsageRingGroup {
  row: AccountUsageProviderRow;
  shared: readonly AccountUsageProviderRow[];
}

/** Owner rows stay visible; rows that share an owner's quota are grouped under that owner. */
export function accountUsageRingGroups(rows: readonly AccountUsageProviderRow[]): AccountUsageRingGroup[] {
  const owner = (row: AccountUsageProviderRow) =>
    rows.find((other) => other.accountId === null && other.provider === row.sharedQuotaWith);
  return rows
    .filter((row) => !owner(row))
    .map((row) => ({ row, shared: rows.filter((other) => owner(other) === row) }));
}

/** The provider row that has the least left, among a provider and its shared-quota rows. */
export function accountUsageRingRow(rows: readonly AccountUsageProviderRow[]): AccountUsageProviderRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((lowest, row) =>
    (row.remainingPercent ?? 100) < (lowest.remainingPercent ?? 100) ? row : lowest,
  );
}

/** The ring tracks for one provider usage button: outer track is the longest window. */
export function accountUsageRingTracks(rows: readonly AccountUsageProviderRow[]): AccountUsageRingTrack[] {
  const ringRow = accountUsageRingRow(rows);
  if (!ringRow) return [];
  return [...ringRow.ringWindows]
    .reverse()
    .slice(0, 2)
    .map((window) => ({
      percent: window.remainingPercent,
      tone: window.tone,
    }));
}

/** Shared ring drawing for provider usage windows and custom-agent quota usage. */
export function AccountUsageRingIcon(props: {
  tracks: readonly AccountUsageRingTrack[];
  class?: string | undefined;
}): JSX.Element {
  const outerRadius = (RING.size - RING.stroke) / 2;
  return (
    <svg
      class={props.class ? `account-usage-ring-svg ${props.class}` : "account-usage-ring-svg"}
      viewBox={`0 0 ${RING.size} ${RING.size}`}
      fill="none"
      aria-hidden="true"
    >
      <For each={props.tracks} keyed={false}>
        {(track, index) => (
          <g>
            <circle
              class="account-usage-ring-track"
              cx={RING.size / 2}
              cy={RING.size / 2}
              r={outerRadius - index * RING.spacing}
              stroke-width={RING.stroke}
            />
            <Show when={track().percent > 0}>
              <circle
                class="account-usage-ring-arc"
                data-usage-tone={track().tone}
                cx={RING.size / 2}
                cy={RING.size / 2}
                r={outerRadius - index * RING.spacing}
                stroke-width={RING.stroke}
                stroke-linecap="round"
                pathLength={100}
                stroke-dasharray={`${track().percent} 100`}
              />
            </Show>
          </g>
        )}
      </For>
    </svg>
  );
}
