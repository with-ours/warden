import { describe, it, expect } from 'vitest';
import { groupByPhase } from './phase.js';
import type { ResolvedTrigger } from '../config/loader.js';

/** Minimal trigger stub for testing. */
function makeTrigger(name: string, phase?: number): ResolvedTrigger {
  return {
    name,
    skill: name,
    type: '*',
    filters: {},
    phase,
  };
}

describe('groupByPhase', () => {
  it('defaults triggers with no phase to 1', () => {
    const triggers = [makeTrigger('a'), makeTrigger('b')];
    const result = groupByPhase(triggers);

    expect([...result.keys()]).toEqual([1]);
    expect(result.get(1)).toHaveLength(2);
  });

  it('groups mixed phases correctly and sorts ascending', () => {
    const triggers = [
      makeTrigger('p2-a', 2),
      makeTrigger('p1-a', 1),
      makeTrigger('p2-b', 2),
      makeTrigger('p3', 3),
      makeTrigger('default'),
    ];
    const result = groupByPhase(triggers);

    expect([...result.keys()]).toEqual([1, 2, 3]);
    expect(result.get(1)!.map((t) => t.name)).toEqual(['p1-a', 'default']);
    expect(result.get(2)!.map((t) => t.name)).toEqual(['p2-a', 'p2-b']);
    expect(result.get(3)!.map((t) => t.name)).toEqual(['p3']);
  });

  it('returns a single group for single-phase triggers', () => {
    const triggers = [makeTrigger('a', 1), makeTrigger('b', 1)];
    const result = groupByPhase(triggers);

    expect([...result.keys()]).toEqual([1]);
    expect(result.get(1)).toHaveLength(2);
  });

  it('handles empty input', () => {
    const result = groupByPhase([]);
    expect(result.size).toBe(0);
  });
});
