import { render, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it } from "vitest";
import { LayoutProvider, useLayout } from "./layout";
import { RAIL_REORDER_STORAGE_KEY } from "./layout-constants";
import { PlatformProvider } from "./platform";

type LayoutApi = ReturnType<typeof useLayout>;

function LayoutProbe(props: { onReady: (layout: LayoutApi) => void }) {
  const layout = useLayout();
  props.onReady(layout);
  return null;
}

function renderLayoutProbe(onReady: (layout: LayoutApi) => void) {
  return render(() => (
    <PlatformProvider
      appInfo={{
        name: "OpenBot",
        version: "test",
        platform: "darwin",
        variant: "production",
      }}
    >
      <LayoutProvider>
        <LayoutProbe onReady={onReady} />
      </LayoutProvider>
    </PlatformProvider>
  ));
}

describe("layout rail reorder persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reads mixed arrays from storage and keeps valid ids only", async () => {
    window.localStorage.setItem(RAIL_REORDER_STORAGE_KEY, JSON.stringify([" alpha ", 7, "", "beta", "alpha", null]));
    let layout: LayoutApi | undefined;

    renderLayoutProbe((value) => (layout = value));

    await waitFor(() => expect(layout?.railReorder()).toEqual(["alpha", "beta"]));
  });

  it("normalizes and persists rail reorder writes", async () => {
    let layout: LayoutApi | undefined;

    renderLayoutProbe((value) => (layout = value));

    await waitFor(() => expect(layout).toBeDefined());
    layout?.setRailReorder([" beta ", "", "alpha", "beta", "  "]);

    await waitFor(() => expect(layout?.railReorder()).toEqual(["beta", "alpha"]));
    expect(window.localStorage.getItem(RAIL_REORDER_STORAGE_KEY)).toBe(JSON.stringify(["beta", "alpha"]));
  });

  it("applies storage events with per-item filtering", async () => {
    window.localStorage.setItem(RAIL_REORDER_STORAGE_KEY, JSON.stringify(["alpha"]));
    let layout: LayoutApi | undefined;

    renderLayoutProbe((value) => (layout = value));

    await waitFor(() => expect(layout?.railReorder()).toEqual(["alpha"]));
    window.localStorage.setItem(RAIL_REORDER_STORAGE_KEY, JSON.stringify([" gamma ", 3, "", "delta", "gamma"]));
    window.dispatchEvent(new StorageEvent("storage", { key: RAIL_REORDER_STORAGE_KEY }));

    await waitFor(() => expect(layout?.railReorder()).toEqual(["gamma", "delta"]));
  });
});
