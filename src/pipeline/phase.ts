/**
 * Phase grouping utility for multi-pass skill execution.
 *
 * Groups items by their `phase` field (defaulting to 1)
 * and returns them sorted by phase ascending.
 */

/**
 * Group items by execution phase, sorted ascending.
 * Items without a phase default to phase 1.
 */
export function groupByPhase<T extends { phase?: number }>(items: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();

  for (const item of items) {
    const phase = item.phase ?? 1;
    const existing = grouped.get(phase);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(phase, [item]);
    }
  }

  return new Map([...grouped.entries()].sort(([a], [b]) => a - b));
}
