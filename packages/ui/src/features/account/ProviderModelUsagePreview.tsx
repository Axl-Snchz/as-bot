import { For, Show } from "solid-js";
import { AccountUsageWindowList } from "./AccountUsageDetails";
import type { AccountUsageProviderRow } from "./account-usage-view";

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
              <strong>{usage.name}</strong>
              <AccountUsageWindowList windows={usage.windows} now={props.now} />
            </div>
          )}
        </For>
      </section>
    </Show>
  );
}
