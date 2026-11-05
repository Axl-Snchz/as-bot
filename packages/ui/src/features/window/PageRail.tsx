import { AppLogo, type AppLogoVariant, ProviderLogo } from "@openbot/brand";
import type { CustomAgentQuotaError } from "@openbot/contracts/ipc";
import {
  Bot,
  Button,
  CalendarClock,
  ChartArea,
  DropdownMenu,
  Ellipsis,
  ListChecks,
  MotionTooltip,
  Pin,
  Settings,
  Store,
  Waypoints,
  Workflow,
} from "@openbot/ui";
import { AccountUsageDetails } from "@openbot/ui/features/account/AccountUsageDetails";
import {
  type AccountUsageProviderRow,
  type AccountUsageTone,
  accountUsageRowKey,
  formatUsageReset,
} from "@openbot/ui/features/account/account-usage-view";
import { useText } from "@openbot/ui/text";
import { Dynamic, type JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, Show } from "solid-js";

interface RailButtonNativeProps {
  draggable?: "true" | "false";
  "data-rail-reorder-id"?: string | undefined;
  "data-rail-draggable"?: string | undefined;
  "data-rail-dragging"?: string | undefined;
  "data-rail-drop-target"?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  registerButton?: ((button: HTMLButtonElement) => void) | undefined;
  onClick?: ((event: MouseEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
  onDragStart?: ((event: DragEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
  onDragOver?: ((event: DragEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
  onDrop?: ((event: DragEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
  onDragEnd?: ((event: DragEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
  onKeyDown?: ((event: KeyboardEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
}

/** One rail button. Its name shows as a tooltip, unless it has a `card`: the card shows instead. */
function RailButton(props: {
  label: string;
  /** Renders the card while it is open. */
  card?: () => JSX.Element;
  current?: boolean;
  class?: string;
  tooltipSuppressed?: boolean;
  buttonProps?: RailButtonNativeProps;
  onClick: (button: HTMLElement) => void;
  children: JSX.Element;
}) {
  const button = () => (
    <Button
      variant="ghost"
      type="button"
      class={props.class ? `window-rail-button ${props.class}` : "window-rail-button"}
      aria-label={props.label}
      aria-current={props.current ? "page" : undefined}
      draggable={props.buttonProps?.draggable}
      data-rail-reorder-id={props.buttonProps?.["data-rail-reorder-id"]}
      data-rail-draggable={props.buttonProps?.["data-rail-draggable"]}
      data-rail-dragging={props.buttonProps?.["data-rail-dragging"]}
      data-rail-drop-target={props.buttonProps?.["data-rail-drop-target"]}
      aria-describedby={props.buttonProps?.["aria-describedby"]}
      aria-keyshortcuts={props.buttonProps?.["aria-keyshortcuts"]}
      ref={props.buttonProps?.registerButton}
      onDragStart={props.buttonProps?.onDragStart}
      onDragOver={props.buttonProps?.onDragOver}
      onDrop={props.buttonProps?.onDrop}
      onDragEnd={props.buttonProps?.onDragEnd}
      onKeyDown={props.buttonProps?.onKeyDown}
      onClick={(event: MouseEvent & { currentTarget: HTMLButtonElement; target: Element }) => {
        props.buttonProps?.onClick?.(event);
        if (!event.defaultPrevented) props.onClick(event.currentTarget);
      }}
    >
      {props.children}
    </Button>
  );
  return (
    <Show
      when={props.card}
      fallback={
        <MotionTooltip content={props.label} suppressed={props.tooltipSuppressed}>
          {button()}
        </MotionTooltip>
      }
    >
      {(card) => (
        <MotionTooltip
          content={card()()}
          class="ui-popover-menu-surface account-usage-popover window-rail-usage-card"
          placement="right-end"
          openDelay={250}
          closeDelay={75}
          suppressed={props.tooltipSuppressed}
        >
          {button()}
        </MotionTooltip>
      )}
    </Show>
  );
}

/** Two tracks in a 34px box, with 4.5px between their centers. */
const RING = { size: 34, stroke: 2.25, spacing: 4.5 };

interface UsageRingTrack {
  percent: number;
  tone: AccountUsageTone;
}

/** Shared rail ring drawing for provider usage windows and custom-agent quota usage. */
function UsageRingIcon(props: { tracks: readonly UsageRingTrack[] }) {
  const outerRadius = (RING.size - RING.stroke) / 2;
  return (
    <svg class="window-rail-usage-ring" viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none" aria-hidden="true">
      <For each={props.tracks} keyed={false}>
        {(track, index) => (
          <g>
            <circle
              class="window-rail-usage-track"
              cx={RING.size / 2}
              cy={RING.size / 2}
              r={outerRadius - index * RING.spacing}
              stroke-width={RING.stroke}
            />
            <Show when={track().percent > 0}>
              <circle
                class="window-rail-usage-arc"
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

/**
 * The limits of one provider as concentric rings: the outer ring is the longest window, the inner
 * ring the shortest. Each arc shows how much is left, in the tone of that window. The hover card
 * shows the windows with their reset times. `shared` are the readings that count the same quota, such
 * as Cursor on a merged Grok plan: the card lists them, with no ring of their own. The ring draws the
 * reading with the least left, so a shared reading that runs out first still shows.
 */
function UsageRings(props: {
  row: AccountUsageProviderRow;
  shared: readonly AccountUsageProviderRow[];
  onOpen: (button: HTMLElement) => void;
  buttonProps?: RailButtonNativeProps;
  tooltipSuppressed?: boolean;
}) {
  const { t, format } = useText();
  const rows = () => [props.row, ...props.shared];
  const label = () =>
    t("app.rail.usageRings", {
      name: format.list(rows().map((row) => row.name)),
      windows: rows()
        .flatMap((row) => row.windows)
        .map((window) => t("account.usage.row.window", { window: window.label, percent: window.remainingPercent }))
        .join(", "),
    });
  const ringRow = () =>
    rows().reduce((lowest, row) => ((row.remainingPercent ?? 100) < (lowest.remainingPercent ?? 100) ? row : lowest));
  const windows = () => [...ringRow().ringWindows].reverse().slice(0, 2);
  return (
    <RailButton
      label={label()}
      card={() => (
        <AccountUsageDetails
          rows={rows()}
          loading={false}
          error={null}
          refreshActive={false}
          refreshDisabled
          onRefresh={() => undefined}
          title={<h2 class="account-usage-popover-title">{t("account.usage.title")}</h2>}
        />
      )}
      class="window-rail-usage"
      tooltipSuppressed={props.tooltipSuppressed}
      buttonProps={props.buttonProps}
      onClick={props.onOpen}
    >
      <UsageRingIcon tracks={windows().map((window) => ({ percent: window.remainingPercent, tone: window.tone }))} />
      <ProviderLogo provider={props.row.logo ?? props.row.provider} class="window-rail-usage-logo" />
    </RailButton>
  );
}

interface CustomAgentUsageQuotaReady {
  state: "ready";
  remainingPercent: number;
  tone: AccountUsageTone;
  resetAtMs: number;
}

type CustomAgentUsageQuota =
  | CustomAgentUsageQuotaReady
  | { state: "no-data" }
  | { state: "error"; messageKey: CustomAgentQuotaError["messageKey"] };

/** One saved custom agent row for rail usage. */
export interface CustomAgentUsageRailRow {
  id: string;
  name: string;
  providerLogo: "acp" | "copilot";
  /** The last answer to the usage prompt. Missing when there is no prompt or no answer yet. */
  usageText?: string | undefined;
  quota?: CustomAgentUsageQuota | undefined;
}

/**
 * One saved custom agent in the rail. Copilot quota uses the same ring treatment as built-in providers,
 * with remaining percentage from credits counters.
 */
function CustomAgentUsageButton(props: {
  row: CustomAgentUsageRailRow;
  onOpen: (button: HTMLElement) => void;
  buttonProps?: RailButtonNativeProps;
  tooltipSuppressed?: boolean;
}) {
  const text = useText();
  const { t } = text;
  const readyQuota = () => (props.row.quota?.state === "ready" ? props.row.quota : null);
  const copilotUsageRow = () => {
    if (props.row.providerLogo !== "copilot") return null;
    const quota = readyQuota();
    if (!quota) return null;
    const displayRemainingPercent = Math.round(quota.remainingPercent);
    const resetsAt = Number.isFinite(quota.resetAtMs) ? Math.floor(quota.resetAtMs / 1_000) : null;
    const monthlyWindow = {
      label: t("account.usage.window.monthly"),
      remainingPercent: displayRemainingPercent,
      tone: quota.tone,
      resetsAt,
      resetsAtLabel: formatUsageReset(resetsAt, text),
    };
    return {
      provider: "acp" as const,
      logo: "copilot" as const,
      accountId: props.row.id,
      name: props.row.name,
      remainingPercent: displayRemainingPercent,
      tone: quota.tone,
      windows: [monthlyWindow],
      ringWindows: [monthlyWindow],
      reportsUsage: true,
      sharedQuotaWith: null,
    } satisfies AccountUsageProviderRow;
  };
  const usageLabel = () => {
    return t("app.rail.customAgentUsage", { name: props.row.name });
  };
  const card = () => {
    if (props.row.quota?.state === "error")
      return (
        <div class="window-rail-agent-usage">
          <h2 class="account-usage-popover-title">{props.row.name}</h2>
          <p class="account-usage-popover-error">{t(props.row.quota.messageKey)}</p>
        </div>
      );
    return (
      <div class="window-rail-agent-usage">
        <h2 class="account-usage-popover-title">{props.row.name}</h2>
        <p class="window-rail-agent-usage-text">
          {props.row.quota?.state === "no-data"
            ? t("app.rail.customAgentNoUsage")
            : (props.row.usageText ?? t("app.rail.customAgentNoUsage"))}
        </p>
      </div>
    );
  };
  return (
    <Show
      when={copilotUsageRow()}
      fallback={
        <RailButton
          label={usageLabel()}
          card={card}
          class="window-rail-usage"
          onClick={props.onOpen}
          buttonProps={props.buttonProps}
          tooltipSuppressed={props.tooltipSuppressed}
        >
          <ProviderLogo provider={props.row.providerLogo} class="window-rail-usage-logo window-rail-agent-usage-logo" />
        </RailButton>
      }
    >
      {(row) => (
        <UsageRings
          row={row()}
          shared={[]}
          onOpen={props.onOpen}
          buttonProps={props.buttonProps}
          tooltipSuppressed={props.tooltipSuppressed}
        />
      )}
    </Show>
  );
}

/** The rail pages. Agents and Routines show the same page with a different sidebar list. */
export type PageRailPage =
  | "agents"
  | "routines"
  | "workflows"
  | "tasks"
  | "schedule"
  | "usage"
  | "marketplace"
  | "settings";

/** The pages that the user can pin to the rail, in rail order. Agents always shows. */
export const PAGE_RAIL_PINNABLE_PAGES = [
  "routines",
  "workflows",
  "tasks",
  "schedule",
  "usage",
] as const satisfies readonly PageRailPage[];
export type PageRailPinnablePage = (typeof PAGE_RAIL_PINNABLE_PAGES)[number];

export interface PageRailProps {
  hidden: boolean;
  /** The page in the card, or `null` while a page that the rail does not open shows. */
  current: PageRailPage | null;
  /** The pages that show as rail buttons. The More menu has all pages, with a pin for each one. */
  pinned: readonly PageRailPinnablePage[];
  onPinChange: (page: PageRailPinnablePage, pinned: boolean) => void;
  /** The plan limits of each provider account. Each one with a reported window shows as rings. */
  usageRows: readonly AccountUsageProviderRow[];
  /** The custom agents on this computer, with their last usage answer when one is available. Absent on the web. */
  customAgentUsage?: readonly CustomAgentUsageRailRow[] | undefined;
  /** The saved order of usage and custom-agent buttons in the lower rail group. */
  reorderableOrder?: readonly string[] | undefined;
  /** Saves the order of usage and custom-agent buttons in the lower rail group. */
  onReorderableOrderChange?: ((order: readonly string[]) => void) | undefined;
  onAgents: () => void;
  /** Absent when the server has no routines. */
  onRoutines?: (() => void) | undefined;
  /** Absent when the server has no workflows. */
  onWorkflows?: (() => void) | undefined;
  /** Absent where the server keeps no tasks. */
  onTasks?: ((button: HTMLElement) => void) | undefined;
  /** Absent where there is no schedule page. */
  onSchedule?: ((button: HTMLElement) => void) | undefined;
  onUsage: (button: HTMLElement) => void;
  /** Absent while Marketplace cannot open. */
  onMarketplace?: (() => void) | undefined;
  onSettings: (button: HTMLElement) => void;
  /** A notice for the Settings button, such as an update, when no other place shows it. A dot marks it. */
  settingsNotice?: string | undefined;
  /** The Help menu, between Marketplace and Settings. */
  help: JSX.Element;
  /**
   * The OpenBot logo in the top row, for a window that has no macOS window buttons there. With
   * `href`, the logo is a link to the OpenBot site.
   */
  logo?: { variant: AppLogoVariant; href?: string | undefined } | undefined;
}

type ReorderableRailEntry =
  | {
      id: string;
      kind: "usage";
      label: string;
      row: AccountUsageProviderRow;
      shared: readonly AccountUsageProviderRow[];
    }
  | {
      id: string;
      kind: "custom-agent";
      label: string;
      row: CustomAgentUsageRailRow;
    };

/**
 * Saved entries that still exist keep their saved order. New entries are appended by their current
 * order. Missing entries are dropped.
 */
export function mergePageRailReorderableIds(current: readonly string[], saved: readonly string[]): string[] {
  const currentSet = new Set(current);
  const merged = saved.filter((id, index) => currentSet.has(id) && saved.indexOf(id) === index);
  for (const id of current) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

/** A page that the user can pin to the rail. */
interface RailPage {
  id: PageRailPinnablePage;
  label: string;
  icon: typeof Bot;
  open: (button: HTMLElement) => void;
}

/**
 * The More button of the rail. Its menu lists every page that the user can pin. A row opens its page;
 * the pin at the end of the row pins or unpins it, and the menu stays open. When the open page has no
 * rail button, the More button shows as the current page.
 */
function RailMoreMenu(props: {
  pages: readonly RailPage[];
  current: PageRailPage | null;
  pinned: readonly PageRailPinnablePage[];
  onPinChange: (page: PageRailPinnablePage, pinned: boolean) => void;
}) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLElement | undefined;
  // A pin adds or removes a rail button above More, so the trigger moves. The menu keeps the place
  // where it opened, so the row under the pointer stays the same.
  let anchor: DOMRect | undefined;
  const changeOpen = (next: boolean) => {
    anchor = next ? trigger?.getBoundingClientRect() : undefined;
    setOpen(next);
  };
  const pinned = (page: PageRailPinnablePage) => props.pinned.includes(page);
  const currentInMenu = () => props.pages.some((page) => page.id === props.current && !pinned(page.id));
  return (
    <DropdownMenu.Root
      placement="right-start"
      gutter={10}
      onOpenChange={changeOpen}
      getAnchorRect={(element?: HTMLElement) => anchor ?? element?.getBoundingClientRect()}
    >
      <MotionTooltip content={t("app.rail.more")} suppressed={open()}>
        <DropdownMenu.Trigger
          ref={(element: HTMLElement) => {
            trigger = element;
          }}
          class="window-rail-button"
          aria-label={t("app.rail.more")}
          aria-current={currentInMenu() ? "page" : undefined}
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenu.Trigger>
      </MotionTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-context-menu window-rail-more-menu" aria-label={t("app.rail.more")}>
          <For each={props.pages} keyed={(page) => page.id}>
            {(page) => (
              // The pin is its own menu item beside the page, so the keyboard reaches it.
              <div role="none" class="window-rail-more-row" data-pinned={pinned(page().id) ? "" : undefined}>
                <DropdownMenu.Item onSelectAfterClose={() => trigger && page().open(trigger)}>
                  <Dynamic component={page().icon} class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{page().label}</span>
                </DropdownMenu.Item>
                <DropdownMenu.CheckboxItem
                  class="window-rail-more-pin"
                  closeOnSelect={false}
                  checked={pinned(page().id)}
                  onChange={(checked: boolean) => props.onPinChange(page().id, checked)}
                  aria-label={t("app.rail.pinPage", { name: page().label })}
                >
                  <Pin class="agent-context-icon size-4" aria-hidden="true" />
                </DropdownMenu.CheckboxItem>
              </div>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The logo in the top row of the rail, in line with the icons of the rail and the server logo of the sidebar. */
function RailLogo(props: { variant: AppLogoVariant; href: string | undefined }) {
  const { t } = useText();
  return (
    <div class="window-rail-logo">
      <Show when={props.href} fallback={<AppLogo variant={props.variant} />}>
        {(href) => (
          <MotionTooltip content={t("app.rail.website")}>
            <a
              class="window-rail-logo-link"
              href={href()}
              target="_blank"
              rel="noopener"
              aria-label={t("app.rail.website")}
            >
              <AppLogo variant={props.variant} />
            </a>
          </MotionTooltip>
        )}
      </Show>
    </div>
  );
}

/**
 * The page rail at the left of the window, on desktop and on the web. Its buttons change the page in
 * the card. A usage ring shows the plan limits of one provider and opens the usage page.
 */
export function PageRail(props: PageRailProps) {
  const { t } = useText();
  const reorderShortcutId = `page-rail-reorder-shortcuts-${createUniqueId()}`;
  const [draggedId, setDraggedId] = createSignal<string | null>(null);
  const [dragOverId, setDragOverId] = createSignal<string | null>(null);
  const [announcement, setAnnouncement] = createSignal("");
  const [suppressedClickId, setSuppressedClickId] = createSignal<string | null>(null);
  const [localReorderableOrder, setLocalReorderableOrder] = createSignal<readonly string[]>([]);
  const reorderableButtons = new Map<string, HTMLButtonElement>();
  let clearSuppressedClickTimer: number | null = null;
  onCleanup(() => {
    if (clearSuppressedClickTimer !== null && typeof window !== "undefined")
      window.clearTimeout(clearSuppressedClickTimer);
  });
  /**
   * One ring per reading, except a reading that counts the quota of another provider's own sign-in,
   * such as Cursor on a merged Grok plan: that ring's card lists it instead.
   */
  const rings = createMemo(() => {
    const rows = props.usageRows.filter((row) => row.reportsUsage && row.windows.length > 0);
    const owner = (row: AccountUsageProviderRow) =>
      rows.find((other) => other.accountId === null && other.provider === row.sharedQuotaWith);
    return rows
      .filter((row) => !owner(row))
      .map((row) => ({ row, shared: rows.filter((other) => owner(other) === row) }));
  });
  /** The pages that this server has, in rail order. */
  const pages = createMemo((): RailPage[] => {
    const list: RailPage[] = [];
    const { onRoutines, onWorkflows, onTasks, onSchedule } = props;
    if (onRoutines) {
      list.push({
        id: "routines",
        label: t("sidebar.view.routines"),
        icon: Workflow,
        open: () => onRoutines(),
      });
    }
    if (onWorkflows) {
      list.push({
        id: "workflows",
        label: t("app.rail.workflows"),
        icon: Waypoints,
        open: () => onWorkflows(),
      });
    }
    if (onTasks) {
      list.push({ id: "tasks", label: t("app.rail.tasks"), icon: ListChecks, open: onTasks });
    }
    if (onSchedule) {
      list.push({
        id: "schedule",
        label: t("app.rail.schedule"),
        icon: CalendarClock,
        open: onSchedule,
      });
    }
    list.push({ id: "usage", label: t("app.rail.usage"), icon: ChartArea, open: props.onUsage });
    return list;
  });
  const reorderableEntries = createMemo((): ReorderableRailEntry[] => [
    ...rings().map((ring) => ({
      id: `usage:${accountUsageRowKey(ring.row)}`,
      kind: "usage" as const,
      label: ring.row.name,
      row: ring.row,
      shared: ring.shared,
    })),
    ...(props.customAgentUsage ?? []).map((row) => ({
      id: `custom-agent:${row.id}`,
      kind: "custom-agent" as const,
      label: row.name,
      row,
    })),
  ]);
  const orderedReorderableEntries = createMemo(() => {
    const entries = reorderableEntries();
    const current = entries.map((entry) => entry.id);
    const order = mergePageRailReorderableIds(current, props.reorderableOrder ?? localReorderableOrder());
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return order.flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    });
  });
  createEffect(
    () => ({ controlled: props.reorderableOrder, current: reorderableEntries().map((entry) => entry.id) }),
    ({ controlled, current }) => {
      if (controlled !== undefined) return;
      setLocalReorderableOrder((saved) => mergePageRailReorderableIds(current, saved));
    },
  );
  function setReorderableOrder(next: readonly string[]): void {
    const current = reorderableEntries().map((entry) => entry.id);
    const merged = mergePageRailReorderableIds(current, next);
    if (props.onReorderableOrderChange) props.onReorderableOrderChange(merged);
    else setLocalReorderableOrder(merged);
  }
  function moveReorderable(sourceId: string, targetId: string): boolean {
    if (sourceId === targetId) return false;
    const ids = orderedReorderableEntries().map((entry) => entry.id);
    const sourceIndex = ids.indexOf(sourceId);
    const targetIndex = ids.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return false;
    ids.splice(sourceIndex, 1);
    ids.splice(targetIndex, 0, sourceId);
    setReorderableOrder(ids);
    const moved = orderedReorderableEntries().find((entry) => entry.id === sourceId);
    setAnnouncement(
      t("app.rail.reorderMoved", {
        name: moved?.label ?? "",
        position: targetIndex + 1,
        total: ids.length,
      }),
    );
    return true;
  }
  function moveReorderableByStep(id: string, step: -1 | 1): void {
    const ids = orderedReorderableEntries().map((entry) => entry.id);
    const index = ids.indexOf(id);
    const target = index + step;
    const targetId = ids[target];
    if (index < 0 || !targetId) return;
    if (!moveReorderable(id, targetId)) return;
    queueMicrotask(() => {
      const focusMoved = () => {
        const mappedButton = reorderableButtons.get(id);
        if (mappedButton && document.contains(mappedButton)) {
          mappedButton.focus();
          return;
        }
        for (const button of document.querySelectorAll<HTMLButtonElement>("[data-rail-reorder-id]")) {
          if (button.getAttribute("data-rail-reorder-id") !== id) continue;
          button.focus();
          break;
        }
      };
      if (typeof window !== "undefined" && "requestAnimationFrame" in window) window.requestAnimationFrame(focusMoved);
      else focusMoved();
    });
  }
  function stopDragging(): void {
    setDraggedId(null);
    setDragOverId(null);
  }
  function clearSuppressedClick(id: string): void {
    setSuppressedClickId((current) => (current === id ? null : current));
  }
  function scheduleSuppressedClickClear(id: string): void {
    if (typeof window === "undefined") {
      clearSuppressedClick(id);
      return;
    }
    if (clearSuppressedClickTimer !== null) window.clearTimeout(clearSuppressedClickTimer);
    clearSuppressedClickTimer = window.setTimeout(() => {
      clearSuppressedClick(id);
      clearSuppressedClickTimer = null;
    }, 0);
  }
  function reorderableButtonProps(id: string): RailButtonNativeProps {
    return {
      draggable: "true",
      "data-rail-reorder-id": id,
      "data-rail-draggable": "true",
      "data-rail-dragging": draggedId() === id ? "" : undefined,
      "data-rail-drop-target": dragOverId() === id ? "" : undefined,
      "aria-describedby": reorderShortcutId,
      "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
      registerButton: (button) => {
        reorderableButtons.set(id, button);
      },
      onClick: (event) => {
        if (suppressedClickId() !== id) return;
        event.preventDefault();
        event.stopPropagation();
        setSuppressedClickId(null);
      },
      onDragStart: (event) => {
        if (suppressedClickId() !== null) setSuppressedClickId(null);
        event.dataTransfer?.setData("text/plain", id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        setDraggedId(id);
        setDragOverId(id);
      },
      onDragOver: (event) => {
        const sourceId = draggedId() ?? event.dataTransfer?.getData("text/plain") ?? null;
        if (!sourceId) return;
        if (!draggedId()) setDraggedId(sourceId);
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        if (dragOverId() !== id) setDragOverId(id);
      },
      onDrop: (event) => {
        event.preventDefault();
        const sourceId = draggedId() ?? event.dataTransfer?.getData("text/plain") ?? null;
        if (!sourceId) return;
        if (moveReorderable(sourceId, id)) {
          setSuppressedClickId(sourceId);
          scheduleSuppressedClickClear(sourceId);
        }
        stopDragging();
      },
      onDragEnd: () => {
        const suppressedId = suppressedClickId();
        stopDragging();
        if (suppressedId) scheduleSuppressedClickClear(suppressedId);
      },
      onKeyDown: (event) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        moveReorderableByStep(id, event.key === "ArrowUp" ? -1 : 1);
      },
    };
  }
  return (
    <nav class="window-rail" aria-label={t("app.rail.label")} hidden={props.hidden}>
      <Show when={props.logo}>{(logo) => <RailLogo variant={logo().variant} href={logo().href} />}</Show>
      <div class="window-rail-group">
        <RailButton label={t("app.rail.agents")} current={props.current === "agents"} onClick={props.onAgents}>
          <Bot aria-hidden="true" />
        </RailButton>
        <For each={pages().filter((page) => props.pinned.includes(page.id))} keyed={(page) => page.id}>
          {(page) => (
            <RailButton label={page().label} current={props.current === page().id} onClick={page().open}>
              <Dynamic component={page().icon} aria-hidden="true" />
            </RailButton>
          )}
        </For>
        <RailMoreMenu pages={pages()} current={props.current} pinned={props.pinned} onPinChange={props.onPinChange} />
      </div>
      <div class="window-rail-group window-rail-reorder-group" data-rail-dragging={draggedId() ? "" : undefined}>
        <For each={orderedReorderableEntries()} keyed={(entry) => entry.id}>
          {(entry) => {
            const usage = () => {
              const value = entry();
              return value.kind === "usage" ? value : null;
            };
            const custom = () => {
              const value = entry();
              return value.kind === "custom-agent" ? value : null;
            };
            return (
              <Show
                when={usage()}
                fallback={
                  <Show when={custom()}>
                    {(item) => (
                      <CustomAgentUsageButton
                        row={item().row}
                        onOpen={props.onUsage}
                        buttonProps={reorderableButtonProps(item().id)}
                        tooltipSuppressed={Boolean(draggedId())}
                      />
                    )}
                  </Show>
                }
              >
                {(item) => (
                  <UsageRings
                    row={item().row}
                    shared={item().shared}
                    onOpen={props.onUsage}
                    buttonProps={reorderableButtonProps(item().id)}
                    tooltipSuppressed={Boolean(draggedId())}
                  />
                )}
              </Show>
            );
          }}
        </For>
        <Show when={props.onMarketplace}>
          {(onMarketplace) => (
            <RailButton
              label={t("app.rail.marketplace")}
              current={props.current === "marketplace"}
              onClick={() => onMarketplace()()}
            >
              <Store aria-hidden="true" />
            </RailButton>
          )}
        </Show>
        {props.help}
        <RailButton
          label={
            props.settingsNotice
              ? t("app.rail.settingsNotice", { notice: props.settingsNotice })
              : t("app.rail.settings")
          }
          current={props.current === "settings"}
          onClick={props.onSettings}
        >
          <Settings aria-hidden="true" />
          <Show when={props.settingsNotice}>
            <span class="window-rail-notice" aria-hidden="true" />
          </Show>
        </RailButton>
      </div>
      <span id={reorderShortcutId} class="sr-only">
        {t("app.rail.reorderHint")}
      </span>
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement()}
      </span>
    </nav>
  );
}
