import type { ExistingComment } from '../dedup.js';

/**
 * Parsed hunk from a unified diff patch.
 */
export interface PatchHunk {
  /** New file start line */
  newStart: number;
  /** New file line count */
  newCount: number;
}

/**
 * Parse patch hunks from a unified diff string.
 * Extracts line ranges from @@ headers.
 */
export function parsePatchHunks(patch: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  const lines = patch.split('\n');

  for (const line of lines) {
    // Match @@ -oldStart,oldCount +newStart,newCount @@
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (match && match[1]) {
      hunks.push({
        newStart: parseInt(match[1], 10),
        newCount: parseInt(match[2] ?? '1', 10),
      });
    }
  }

  return hunks;
}

/**
 * Check if a patch touched a specific line area.
 * Returns true if any hunk in the patch overlaps with the target line
 * within the given threshold.
 */
export function didPatchTouchArea(
  patch: string,
  targetLine: number,
  threshold = 10
): boolean {
  return parsePatchHunks(patch).some((hunk) => {
    const expandedStart = Math.max(1, hunk.newStart - threshold);
    const expandedEnd = hunk.newStart + hunk.newCount - 1 + threshold;
    return targetLine >= expandedStart && targetLine <= expandedEnd;
  });
}

/**
 * Find comments that have relevant patches (patches that touch the comment's location).
 * Returns a map of comment ID to the patch content.
 */
export function findRelevantPatches(
  patches: Map<string, string>,
  comments: ExistingComment[],
  threshold = 10
): Map<number, string> {
  const relevantPatches = new Map<number, string>();

  for (const comment of comments) {
    const patch = patches.get(comment.path);
    if (!patch) {
      continue;
    }

    if (didPatchTouchArea(patch, comment.line, threshold)) {
      relevantPatches.set(comment.id, patch);
    }
  }

  return relevantPatches;
}

/**
 * Get the line range covered by all hunks in a patch.
 */
export function getPatchLineRange(patch: string): { start: number; end: number } | null {
  const hunks = parsePatchHunks(patch);
  if (hunks.length === 0) {
    return null;
  }

  let start = Infinity;
  let end = 0;

  for (const hunk of hunks) {
    start = Math.min(start, hunk.newStart);
    end = Math.max(end, hunk.newStart + hunk.newCount - 1);
  }

  return { start, end };
}
