import { describe, expect, it } from 'vitest';
import {
  advanceDwell, dwellKeyFor, dwellRemaining, INSERT_DWELL_MS, INSERT_DWELL_SLOP_PX,
} from '@/src/domain/interaction/dragDwell';

/**
 * The dwell rule exists because one-pixel-into-a-gutter used to push.
 * These cases pin the two behaviours that make precise placement possible:
 * sweeping past a gutter never triggers, and holding still does.
 */

type Hit = { cell: { x: number; y: number }; inGapX: boolean; inGapY: boolean };

const inGutterY = (x = 0, y = 0): Hit => ({ cell: { x, y }, inGapX: false, inGapY: true });
const inGutterX = (x = 0, y = 0): Hit => ({ cell: { x, y }, inGapX: true, inGapY: false });
const inCell = (x = 0, y = 0): Hit => ({ cell: { x, y }, inGapX: false, inGapY: false });

describe('dwell key resolution', () => {
  it('reports no key for a cell body, so a body hit never dwells', () => {
    expect(dwellKeyFor(inCell())).toBeUndefined();
  });

  it('distinguishes the two gutter axes at the same cell', () => {
    // A horizontal and a vertical gutter at the same cell are different targets;
    // mixing them would let a corner hover satisfy an unrelated insertion.
    expect(dwellKeyFor(inGutterY())).toEqual({ cellX: 0, cellY: 0, axis: 'y' });
    expect(dwellKeyFor(inGutterX())).toEqual({ cellX: 0, cellY: 0, axis: 'x' });
  });

  it('prefers the vertical gutter when the pointer is in both at a corner', () => {
    const corner: Hit = { cell: { x: 2, y: 3 }, inGapX: true, inGapY: true };
    expect(dwellKeyFor(corner)?.axis).toBe('y');
  });
});

describe('dwell accumulation', () => {
  it('does not fire on the first gutter event', () => {
    const verdict = advanceDwell(undefined, inGutterY(), { x: 10, y: 10 }, 1000);
    expect(verdict.satisfied).toBe(false);
    expect(verdict.state).toBeDefined();
  });

  it('fires only after the full dwell duration has elapsed', () => {
    const first = advanceDwell(undefined, inGutterY(), { x: 10, y: 10 }, 1000);
    // Just short of the threshold: still not satisfied.
    const almost = advanceDwell(first.state, inGutterY(), { x: 10, y: 10 }, 1000 + INSERT_DWELL_MS - 1);
    expect(almost.satisfied).toBe(false);
    const justPast = advanceDwell(almost.state, inGutterY(), { x: 10, y: 10 }, 1000 + INSERT_DWELL_MS);
    expect(justPast.satisfied).toBe(true);
  });

  it('stays satisfied while the pointer keeps holding still', () => {
    // Without this, a held pointer would cancel the preview it just created.
    const first = advanceDwell(undefined, inGutterY(), { x: 10, y: 10 }, 0);
    const held = advanceDwell(first.state, inGutterY(), { x: 10, y: 10 }, INSERT_DWELL_MS + 500);
    expect(held.satisfied).toBe(true);
  });

  it('tolerates sub-slop jitter and keeps the original anchor', () => {
    // A held mouse still emits events with a pixel or two of movement; without
    // the slop radius the timer would restart forever and never complete.
    const first = advanceDwell(undefined, inGutterY(), { x: 10, y: 10 }, 0);
    const jittered = advanceDwell(first.state, inGutterY(), { x: 10 + INSERT_DWELL_SLOP_PX, y: 10 }, INSERT_DWELL_MS);
    expect(jittered.satisfied).toBe(true);
    expect(jittered.state?.anchorX).toBe(10);
  });

  it('restarts when the pointer moves beyond the slop radius', () => {
    const first = advanceDwell(undefined, inGutterY(), { x: 10, y: 10 }, 0);
    const moved = advanceDwell(first.state, inGutterY(), { x: 10 + INSERT_DWELL_SLOP_PX + 1, y: 10 }, INSERT_DWELL_MS);
    expect(moved.satisfied).toBe(false);
    expect(moved.state?.anchorX).toBe(10 + INSERT_DWELL_SLOP_PX + 1);
    expect(moved.state?.since).toBe(INSERT_DWELL_MS);
  });
});

describe('sweeping past a gutter', () => {
  it('drops the dwell as soon as the pointer leaves the gutter', () => {
    const first = advanceDwell(undefined, inGutterY(), { x: 10, y: 10 }, 0);
    const left = advanceDwell(first.state, inCell(0, 1), { x: 10, y: 30 }, INSERT_DWELL_MS * 2);
    // This is the core regression guard: a sweep across a gutter must not
    // accumulate, otherwise aiming at a neighbour would still shove.
    expect(left.satisfied).toBe(false);
    expect(left.state).toBeUndefined();
  });

  it('restarts when the pointer crosses into a different gutter', () => {
    const first = advanceDwell(undefined, inGutterY(0, 0), { x: 10, y: 10 }, 0);
    const other = advanceDwell(first.state, inGutterY(1, 0), { x: 60, y: 10 }, INSERT_DWELL_MS);
    expect(other.satisfied).toBe(false);
    expect(other.state?.key.cellX).toBe(1);
    expect(other.state?.since).toBe(INSERT_DWELL_MS);
  });

  it('does not carry a nearly-complete dwell into the neighbouring cell', () => {
    const first = advanceDwell(undefined, inGutterY(0, 0), { x: 10, y: 10 }, 0);
    const nearly = advanceDwell(first.state, inGutterY(0, 0), { x: 10, y: 10 }, INSERT_DWELL_MS - 10);
    expect(nearly.satisfied).toBe(false);
    // Crossing the cell edge one millisecond later must not inherit progress.
    const next = advanceDwell(nearly.state, inCell(0, 1), { x: 10, y: 25 }, INSERT_DWELL_MS);
    expect(next.state).toBeUndefined();
  });
});

describe('dwell remaining time', () => {
  it('reports the exact time still needed', () => {
    const state = { key: { cellX: 0, cellY: 0, axis: 'y' as const }, anchorX: 0, anchorY: 0, since: 100 };
    expect(dwellRemaining(state, 100)).toBe(INSERT_DWELL_MS);
    expect(dwellRemaining(state, 100 + INSERT_DWELL_MS)).toBe(0);
  });

  it('never returns a negative delay', () => {
    const state = { key: { cellX: 0, cellY: 0, axis: 'y' as const }, anchorX: 0, anchorY: 0, since: 0 };
    expect(dwellRemaining(state, INSERT_DWELL_MS * 3)).toBe(0);
  });
});
