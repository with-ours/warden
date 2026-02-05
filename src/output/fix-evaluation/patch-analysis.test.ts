import { describe, it, expect } from 'vitest';
import {
  parsePatchHunks,
  didPatchTouchArea,
  findRelevantPatches,
  getPatchLineRange,
} from './patch-analysis.js';
import type { ExistingComment } from '../dedup.js';

describe('parsePatchHunks', () => {
  it('parses single hunk', () => {
    const patch = `@@ -10,5 +10,7 @@ function foo() {
+  const x = 1;
+  const y = 2;
   return x + y;
 }`;

    const hunks = parsePatchHunks(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toEqual({ newStart: 10, newCount: 7 });
  });

  it('parses multiple hunks', () => {
    const patch = `@@ -5,3 +5,4 @@ imports
+import { foo } from './foo';
 import { bar } from './bar';
@@ -20,5 +21,8 @@ function main() {
+  // Added code
+  doSomething();
   return result;
 }`;

    const hunks = parsePatchHunks(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toEqual({ newStart: 5, newCount: 4 });
    expect(hunks[1]).toEqual({ newStart: 21, newCount: 8 });
  });

  it('handles single line hunks without count', () => {
    const patch = '@@ -1 +1 @@\n-old\n+new';

    const hunks = parsePatchHunks(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toEqual({ newStart: 1, newCount: 1 });
  });

  it('returns empty array for empty patch', () => {
    const hunks = parsePatchHunks('');
    expect(hunks).toHaveLength(0);
  });

  it('returns empty array for patch without hunks', () => {
    const patch = 'diff --git a/file.ts b/file.ts\nindex abc..def 100644';
    const hunks = parsePatchHunks(patch);
    expect(hunks).toHaveLength(0);
  });
});

describe('didPatchTouchArea', () => {
  const singleHunkPatch = `@@ -10,5 +10,7 @@ function foo() {
+  const x = 1;
   return x;
 }`;

  it('returns true when line is within hunk', () => {
    expect(didPatchTouchArea(singleHunkPatch, 12)).toBe(true);
  });

  it('returns true when line is within threshold of hunk', () => {
    // Hunk is 10-16, threshold 10 means 0-26 is valid
    expect(didPatchTouchArea(singleHunkPatch, 5, 10)).toBe(true);
    expect(didPatchTouchArea(singleHunkPatch, 20, 10)).toBe(true);
  });

  it('returns false when line is outside threshold', () => {
    // Hunk is 10-16, with threshold 5 means 5-21 is valid
    expect(didPatchTouchArea(singleHunkPatch, 1, 5)).toBe(false);
    expect(didPatchTouchArea(singleHunkPatch, 30, 5)).toBe(false);
  });

  it('handles multiple hunks', () => {
    const multiHunkPatch = `@@ -5,3 +5,4 @@
+line
@@ -50,3 +51,4 @@
+line`;

    // Near first hunk
    expect(didPatchTouchArea(multiHunkPatch, 8, 5)).toBe(true);
    // Near second hunk
    expect(didPatchTouchArea(multiHunkPatch, 55, 5)).toBe(true);
    // Between hunks (too far from both)
    expect(didPatchTouchArea(multiHunkPatch, 30, 5)).toBe(false);
  });

  it('returns false for empty patch', () => {
    expect(didPatchTouchArea('', 10)).toBe(false);
  });
});

describe('findRelevantPatches', () => {
  const patches = new Map([
    ['src/db.ts', '@@ -40,5 +40,7 @@\n+code'],
    ['src/api.ts', '@@ -100,5 +100,7 @@\n+code'],
  ]);

  it('finds patches for comments in touched areas', () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
      },
    ];

    const relevant = findRelevantPatches(patches, comments);
    expect(relevant.has(1)).toBe(true);
    expect(relevant.get(1)).toContain('@@ -40,5 +40,7 @@');
  });

  it('does not include patches for comments outside threshold', () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 100, // Far from hunk at 40-46
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
      },
    ];

    const relevant = findRelevantPatches(patches, comments);
    expect(relevant.has(1)).toBe(false);
  });

  it('does not include patches for files without changes', () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/other.ts', // No patch for this file
        line: 42,
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
      },
    ];

    const relevant = findRelevantPatches(patches, comments);
    expect(relevant.size).toBe(0);
  });

  it('handles multiple comments', () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'Issue 1',
        description: 'Desc',
        contentHash: 'abc',
      },
      {
        id: 2,
        path: 'src/api.ts',
        line: 102,
        title: 'Issue 2',
        description: 'Desc',
        contentHash: 'def',
      },
      {
        id: 3,
        path: 'src/db.ts',
        line: 200, // Not near any hunk
        title: 'Issue 3',
        description: 'Desc',
        contentHash: 'ghi',
      },
    ];

    const relevant = findRelevantPatches(patches, comments);
    expect(relevant.size).toBe(2);
    expect(relevant.has(1)).toBe(true);
    expect(relevant.has(2)).toBe(true);
    expect(relevant.has(3)).toBe(false);
  });

  it('respects custom threshold', () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 55, // 9 lines from hunk end (46)
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
      },
    ];

    // Default threshold (10) should include
    expect(findRelevantPatches(patches, comments, 10).has(1)).toBe(true);
    // Smaller threshold (5) should not include
    expect(findRelevantPatches(patches, comments, 5).has(1)).toBe(false);
  });
});

describe('getPatchLineRange', () => {
  it('returns range for single hunk', () => {
    const patch = '@@ -10,5 +10,7 @@\n+code';
    const range = getPatchLineRange(patch);
    expect(range).toEqual({ start: 10, end: 16 });
  });

  it('returns combined range for multiple hunks', () => {
    const patch = `@@ -5,3 +5,4 @@
+line
@@ -50,3 +50,4 @@
+line`;

    const range = getPatchLineRange(patch);
    expect(range).toEqual({ start: 5, end: 53 });
  });

  it('returns null for empty patch', () => {
    expect(getPatchLineRange('')).toBeNull();
  });

  it('returns null for patch without hunks', () => {
    expect(getPatchLineRange('diff --git a/file.ts b/file.ts')).toBeNull();
  });

  it('handles pure deletion hunk (newCount=0) without inverted range', () => {
    // Regression test: newCount=0 caused end < start
    const patch = '@@ -10,5 +10,0 @@\n-deleted line';
    const range = getPatchLineRange(patch);
    expect(range).toEqual({ start: 10, end: 10 });
    // Verify end >= start
    expect(range!.end).toBeGreaterThanOrEqual(range!.start);
  });
});
