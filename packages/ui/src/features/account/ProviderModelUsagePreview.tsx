import { For, Show } from "solid-js";
import { AccountUsageWindowList } from "./AccountUsageDetails";
import type { AccountUsageProviderRow } from "./account-usage-view";

/**
 * The usage of the rows of one picker entry. The panel header already names the provider, so a single
 * row shows only its bars. Two or more rows keep their names, which tell the quota groups apart.
 */
export function ProviderModelUsagePreview(props: {
  rows: readonly AccountUsageProviderRow[];
  now: number;
  label: string;
}) {
  return (
    <Show when={props.rows.length > 0}>
      <section class="provider-model-usage-preview" aria-label={props.label}>
        <For each={props.rows}>
          {(usage) => (
            <div class="provider-model-usage-preview-row">
              <Show when={props.rows.length > 1}>
                <strong>{usage.name}</strong>
              </Show>
              <AccountUsageWindowList windows={usage.windows} now={props.now} />
            </div>
          )}
        </For>
      </section>
    </Show>
  );
}
