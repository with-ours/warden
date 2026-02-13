/**
 * Phase grouping utility for multi-pass skill execution.
 *
 * Groups triggers by their `phase` field (defaulting to 1)
 * and returns them sorted by phase ascending.
 */

import type { ResolvedTrigger } from '../config/loader.js';

/**
 * Group triggers by execution phase, sorted ascending.
 * Triggers without a phase default to phase 1.
 */
export function groupByPhase(triggers: ResolvedTrigger[]): Map<number, ResolvedTrigger[]> {
  const grouped = new Map<number, ResolvedTrigger[]>();

  for (const trigger of triggers) {
    const phase = trigger.phase ?? 1;
    const existing = grouped.get(phase);
    if (existing) {
      existing.push(trigger);
    } else {
      grouped.set(phase, [trigger]);
    }
  }

  // Return a new Map with keys sorted ascending
  return new Map([...grouped.entries()].sort(([a], [b]) => a - b));
}
