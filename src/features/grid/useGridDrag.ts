import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { GridColumns, LayoutItem, Rect } from '@/src/domain/grid/model';
import type { LayoutCommand, LayoutPreference } from '@/src/domain/grid/solver';
import type { GridMetrics } from '@/src/domain/interaction/dragGeometry';
import { hitCell } from '@/src/domain/interaction/dragGeometry';
import type { DropIntent } from '@/src/domain/interaction/dragIntent';
import {
  commandForIntent,
  intentSignature,
  preferenceForIntent,
  resolveDropIntent,
  shouldResolveIntent,
} from '@/src/domain/interaction/dragIntent';
import { exceedsClickDragThreshold } from '@/src/domain/interaction/pointerIntent';
import { localPointFromEvent, measureGridMetrics } from './gridMetrics';

/**
 * Stage 2B-1 pointer drag. Product baseline 7.1 lets a drag start in normal
 * mode too, so the 6px threshold from stage 1 is reused instead of an explicit
 * drag handle: below the threshold nothing happens and the click still opens
 * the shortcut, above it the drag takes over and the click is suppressed.
 *
 * Two invariants keep the interaction honest:
 * - the grid is measured exactly once, on the first movement past the
 *   threshold, because the preview re-renders the grid underneath the pointer;
 * - hit tests read from the layout snapshot captured at drag start, never from
 *   the preview that is already re-flowing, so the target cannot drift away
 *   from the pointer by following its own rearrangement.
 */

/** Widgets keep their own interaction; a drag must not steal it. */
const INTERACTIVE_SELECTOR = 'input, textarea, select, button, [contenteditable="true"]';

interface DragSession {
  readonly pointerId: number;
  readonly instanceId: string;
  readonly item: LayoutItem;
  readonly origin: Rect;
  readonly layout: readonly LayoutItem[];
  readonly element: HTMLElement;
  readonly startX: number;
  readonly startY: number;
  started: boolean;
  lastSignature: string | undefined;
}

export interface GridDragOptions {
  readonly columns: GridColumns;
  /** Committed layout at drag start; the preview may rearrange it later. */
  readonly layout: readonly LayoutItem[];
  readonly preview: (columns: GridColumns, command: LayoutCommand, preference: LayoutPreference) => boolean;
  readonly commit: () => Promise<void>;
  readonly cancel: () => void;
}

export interface GridDragHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface GridDragController {
  readonly gridRef: React.RefObject<HTMLDivElement | null>;
  readonly instanceId: string | undefined;
  readonly intent: DropIntent | undefined;
  readonly origin: Rect | undefined;
  readonly metrics: GridMetrics | undefined;
  readonly handlers: GridDragHandlers;
  readonly cancelDrag: () => void;
}

export function useGridDrag(options: GridDragOptions): GridDragController {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<DragSession | undefined>(undefined);
  const metricsRef = useRef<GridMetrics | undefined>(undefined);
  const previewActiveRef = useRef(false);
  const suppressClickRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [instanceId, setInstanceId] = useState<string>();
  const [intent, setIntent] = useState<DropIntent>();
  const [origin, setOrigin] = useState<Rect>();
  const [metrics, setMetrics] = useState<GridMetrics>();

  const releaseCapture = (session: DragSession | undefined) => {
    if (!session) return;
    // The element may already be detached by the re-render; releasing is best effort.
    try {
      const grid = gridRef.current;
      if (grid?.hasPointerCapture(session.pointerId)) grid.releasePointerCapture(session.pointerId);
    } catch {
      /* capture already gone */
    }
  };

  const endSession = useCallback((restoreElement: boolean) => {
    const session = sessionRef.current;
    sessionRef.current = undefined;
    if (session && restoreElement) session.element.style.transform = '';
    releaseCapture(session);
    metricsRef.current = undefined;
    setInstanceId(undefined);
    setIntent(undefined);
    setOrigin(undefined);
    setMetrics(undefined);
  }, []);

  const cancelDrag = useCallback(() => {
    const session = sessionRef.current;
    const hadPreview = previewActiveRef.current;
    previewActiveRef.current = false;
    // A cancelled drag is still a movement, so the click that follows must not navigate.
    if (session?.started) suppressClickRef.current = true;
    endSession(true);
    if (hadPreview) optionsRef.current.cancel();
  }, [endSession]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (sessionRef.current) return;
    const target = event.target as Element | null;
    if (!target || target.closest(INTERACTIVE_SELECTOR)) return;
    const element = target.closest('[data-instance-id]');
    if (!(element instanceof HTMLElement)) return;

    const pressedId = element.dataset.instanceId;
    if (!pressedId) return;
    const item = options.layout.find((candidate) => candidate.instanceId === pressedId);
    // Locked items never move, so they must not start a drag at all.
    if (!item || item.locked) return;

    // A leftover preview from the previous interaction would fight this one.
    if (previewActiveRef.current) {
      previewActiveRef.current = false;
      options.cancel();
    }

    sessionRef.current = {
      pointerId: event.pointerId,
      instanceId: item.instanceId,
      item,
      origin: { x: item.x, y: item.y, w: item.w, h: item.h },
      layout: options.layout,
      element,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      lastSignature: undefined,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    if (!session.started) {
      if (!exceedsClickDragThreshold({ x: session.startX, y: session.startY }, { x: event.clientX, y: event.clientY })) return;
      const grid = gridRef.current;
      const measured = grid ? measureGridMetrics(grid, options.columns) : undefined;
      // Not measurable yet (hidden or zero width) means declining the drag instead of guessing.
      if (!grid || !measured) {
        endSession(false);
        return;
      }
      session.started = true;
      metricsRef.current = measured;
      setInstanceId(session.instanceId);
      setOrigin(session.origin);
      setMetrics(measured);
      try {
        grid.setPointerCapture(event.pointerId);
      } catch {
        /* capture is an optimisation, not a requirement */
      }
    }

    const grid = gridRef.current;
    const measured = metricsRef.current;
    if (!grid || !measured) return;

    // The dragged element follows the pointer visually; its grid slot stays on
    // the origin (below/above in HomeGrid) so the preview can move everything else.
    session.element.style.transform = `translate3d(${event.clientX - session.startX}px, ${event.clientY - session.startY}px, 0)`;

    if (measured.columns !== options.columns) return;
    const point = localPointFromEvent(grid, event.clientX, event.clientY);
    const nextIntent = resolveDropIntent(hitCell(point, measured), session.layout, session.item, options.columns);

    // Re-solving on every wobble inside one cell would flood the solver and the save queue.
    if (!shouldResolveIntent(session.lastSignature, nextIntent)) return;
    session.lastSignature = intentSignature(nextIntent);
    setIntent(nextIntent);

    // Dropping exactly where the item already is is not a transaction.
    const unchanged = nextIntent.target.x === session.origin.x &&
      nextIntent.target.y === session.origin.y &&
      nextIntent.target.w === session.origin.w &&
      nextIntent.target.h === session.origin.h;
    if (unchanged) {
      if (previewActiveRef.current) {
        previewActiveRef.current = false;
        options.cancel();
      }
      return;
    }

    const accepted = options.preview(
      options.columns,
      commandForIntent(nextIntent, session.instanceId),
      preferenceForIntent(nextIntent),
    );
    previewActiveRef.current = accepted;
    // Baseline 6.9 does not need a retry at this layer: every move command
    // reaches the solver's own reflow fallback once the push chain gives up,
    // whatever preference produced the command. Retrying here would repeat the
    // same failure and could clear the explanation the solver already wrote.
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const dragged = session.started;
    const hadPreview = previewActiveRef.current;
    previewActiveRef.current = false;
    endSession(true);
    if (!dragged) return; // A plain click: let the link do its job.
    suppressClickRef.current = true;
    if (hadPreview) {
      // Committing is the only write in the whole interaction.
      void options.commit().catch(() => options.cancel());
    }
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    cancelDrag();
  };

  // Esc aborts the in-flight drag before it can commit; capture phase so the
  // app-level Esc handler does not also have to know about the drag.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !sessionRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [cancelDrag]);

  // The click that follows a drag must not navigate. The flag is deliberately
  // narrow: it only swallows a click that lands inside the grid, and any new
  // pointerdown clears it. Chromium does not always dispatch a click after a
  // multi-step drag, so a lingering flag must never be able to eat an
  // unrelated UI click such as the undo button.
  useEffect(() => {
    const clearOnPointerDown = () => {
      suppressClickRef.current = false;
    };
    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      const grid = gridRef.current;
      const target = event.target as Node | null;
      if (!grid || !target || !grid.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('pointerdown', clearOnPointerDown, true);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('pointerdown', clearOnPointerDown, true);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  useEffect(() => {
    // A blur mid-drag means no pointerup will arrive; leaving a preview behind
    // would make the next interaction fight a stale candidate.
    const onBlur = () => {
      if (sessionRef.current) cancelDrag();
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [cancelDrag]);

  return {
    gridRef,
    instanceId,
    intent,
    origin,
    metrics,
    cancelDrag,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
