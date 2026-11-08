import { describe, expect, it } from 'vitest';
import { exceedsClickDragThreshold } from '@/src/domain/interaction/pointerIntent';

describe('click and drag intent', () => {
  it('keeps small pointer movement as a click', () => {
    expect(exceedsClickDragThreshold({ x: 100, y: 100 }, { x: 103, y: 102 })).toBe(false);
    expect(exceedsClickDragThreshold({ x: 100, y: 100 }, { x: 103, y: 103 })).toBe(false);
    expect(exceedsClickDragThreshold({ x: 100, y: 100 }, { x: 103, y: 104 })).toBe(false);
  });

  it('separates movement beyond the threshold from navigation', () => {
    expect(exceedsClickDragThreshold({ x: 100, y: 100 }, { x: 106, y: 100 })).toBe(true);
    expect(exceedsClickDragThreshold({ x: 100, y: 100 }, { x: 94, y: 100 })).toBe(true);
    expect(exceedsClickDragThreshold({ x: 100, y: 100 }, { x: 104, y: 105 })).toBe(true);
  });
});
