import type { Accessor } from "solid-js";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

export interface RailReorderEntry {
  id: string;
  label: string;
}

export interface RailButtonNativeProps {
  draggable?: "true" | "false";
  "data-rail-reorder-id"?: string | undefined;
  "data-rail-draggable"?: string | undefined;
  "data-rail-dragging"?: string | undefined;
  "data-rail-drop-target"?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  registerButton?: ((button: HTMLButtonElement | undefined) => void) | undefined;
  onClick?: ((event: MouseEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
  onDragStart?: ((event: DragEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
  onDragOver?: ((event: DragEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
  onDrop?: ((event: DragEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
  onDragEnd?: ((event: DragEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
  onKeyDown?: ((event: KeyboardEvent & { currentTarget: HTMLButtonElement; target: Element }) => void) | undefined;
}

/**
 * Saved entries that still exist keep their saved order. New entries are appended by their current
 * order. Missing entries are dropped.
 */
export function mergePageRailReorderableIds(current: readonly string[], saved: readonly string[]): string[] {
  const currentSet = new Set(current);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of saved) {
    if (!currentSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  for (const id of current) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

/**
 * Keep IDs that are temporarily not rendered in their relative slots while applying a reorder to the
 * currently rendered IDs.
 */
export function mergePageRailPersistedReorderableIds(
  saved: readonly string[],
  current: readonly string[],
  next: readonly string[],
): string[] {
  const savedUnique = mergePageRailReorderableIds(saved, saved);
  const visibleOrder = mergePageRailReorderableIds(current, next);
  const visibleSet = new Set(current);
  const visibleIndexes = savedUnique.flatMap((id, index) => (visibleSet.has(id) ? [index] : []));

  if (visibleIndexes.length === 0) return [...savedUnique, ...visibleOrder.filter((id) => !savedUnique.includes(id))];

  const result = [...savedUnique];
  let cursor = 0;
  const inserted = new Set<string>();
  for (const index of visibleIndexes) {
    const id = visibleOrder[cursor];
    if (id === undefined) break;
    result[index] = id;
    inserted.add(id);
    cursor += 1;
  }
  for (; cursor < visibleOrder.length; cursor += 1) {
    const id = visibleOrder[cursor];
    if (id === undefined) continue;
    if (inserted.has(id)) continue;
    result.push(id);
  }
  return mergePageRailReorderableIds(result, result);
}

export interface CreateRailReorderOptions {
  entries: Accessor<readonly RailReorderEntry[]>;
  controlledOrder: Accessor<readonly string[] | undefined>;
  onOrderChange: ((order: readonly string[]) => void) | undefined;
  reorderShortcutId: Accessor<string>;
  describeMove: (move: { label: string; position: number; total: number }) => string;
}

export function createRailReorder(options: CreateRailReorderOptions) {
  const [draggedId, setDraggedId] = createSignal<string | null>(null);
  const [dragOverId, setDragOverId] = createSignal<string | null>(null);
  const [announcement, setAnnouncement] = createSignal("");
  const [suppressedClickId, setSuppressedClickId] = createSignal<string | null>(null);
  const [focusTooltipSuppressedId, setFocusTooltipSuppressedId] = createSignal<string | null>(null);
  const [localReorderableOrder, setLocalReorderableOrder] = createSignal<readonly string[]>([]);
  const reorderableButtons = new Map<string, HTMLButtonElement>();

  let clearSuppressedClickTimer: number | null = null;
  let clearFocusTooltipSuppressedTimer: number | null = null;

  onCleanup(() => {
    if (clearSuppressedClickTimer !== null && typeof window !== "undefined")
      window.clearTimeout(clearSuppressedClickTimer);
    if (clearFocusTooltipSuppressedTimer !== null && typeof window !== "undefined")
      window.clearTimeout(clearFocusTooltipSuppressedTimer);
    reorderableButtons.clear();
  });

  const orderedIds = createMemo(() => {
    const current = options.entries().map((entry) => entry.id);
    const saved = options.controlledOrder() ?? localReorderableOrder();
    return mergePageRailReorderableIds(current, saved);
  });

  createEffect(
    () => ({ controlled: options.controlledOrder(), current: options.entries().map((entry) => entry.id) }),
    ({ controlled, current }) => {
      if (controlled !== undefined) return;
      setLocalReorderableOrder((saved) => {
        const next = mergePageRailReorderableIds(current, saved);
        return mergePageRailPersistedReorderableIds(saved, current, next);
      });
    },
  );

  createEffect(
    () => options.entries().map((entry) => entry.id),
    (ids) => {
      const visible = new Set(ids);
      for (const id of reorderableButtons.keys()) {
        if (visible.has(id)) continue;
        reorderableButtons.delete(id);
      }
    },
  );

  function setReorderableOrder(next: readonly string[]): void {
    const current = options.entries().map((entry) => entry.id);
    const saved = options.controlledOrder() ?? localReorderableOrder();
    const merged = mergePageRailPersistedReorderableIds(saved, current, next);
    if (options.onOrderChange) options.onOrderChange(merged);
    else setLocalReorderableOrder(merged);
  }

  function moveReorderable(sourceId: string, targetId: string): boolean {
    if (sourceId === targetId) return false;
    const ids = [...orderedIds()];
    const sourceIndex = ids.indexOf(sourceId);
    const targetIndex = ids.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return false;
    ids.splice(sourceIndex, 1);
    ids.splice(targetIndex, 0, sourceId);
    setReorderableOrder(ids);
    const moved = options.entries().find((entry) => entry.id === sourceId);
    setAnnouncement(
      options.describeMove({
        label: moved?.label ?? "",
        position: targetIndex + 1,
        total: ids.length,
      }),
    );
    return true;
  }

  function scheduleFocusTooltipSuppressedClear(id: string): void {
    if (typeof window === "undefined") {
      setFocusTooltipSuppressedId((current) => (current === id ? null : current));
      return;
    }
    if (clearFocusTooltipSuppressedTimer !== null) window.clearTimeout(clearFocusTooltipSuppressedTimer);
    clearFocusTooltipSuppressedTimer = window.setTimeout(() => {
      setFocusTooltipSuppressedId((current) => (current === id ? null : current));
      clearFocusTooltipSuppressedTimer = null;
    }, 300);
  }

  function moveReorderableByStep(id: string, step: -1 | 1): void {
    const ids = [...orderedIds()];
    const index = ids.indexOf(id);
    const target = index + step;
    const targetId = ids[target];
    if (index < 0 || !targetId) return;
    if (!moveReorderable(id, targetId)) return;
    setFocusTooltipSuppressedId(id);
    scheduleFocusTooltipSuppressedClear(id);
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

  function buttonProps(id: string): RailButtonNativeProps {
    return {
      draggable: "true",
      "data-rail-reorder-id": id,
      "data-rail-draggable": "true",
      "data-rail-dragging": draggedId() === id ? "" : undefined,
      "data-rail-drop-target": dragOverId() === id ? "" : undefined,
      "aria-describedby": options.reorderShortcutId(),
      "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
      registerButton: (button) => {
        if (button) reorderableButtons.set(id, button);
        else reorderableButtons.delete(id);
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

  const tooltipSuppressed = (id: string): boolean => Boolean(draggedId()) || focusTooltipSuppressedId() === id;

  return {
    announcement,
    draggedId,
    orderedIds,
    buttonProps,
    tooltipSuppressed,
  };
}
