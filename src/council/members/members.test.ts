import { describe, it, expect } from 'vitest';
import { fixJudge } from './index.js';
import type { FixJudgeContext } from './fix-judge.js';

/**
 * Behavioral tests for council member tools.
 *
 * These tests verify the tools actually work correctly, not just that they exist.
 * For end-to-end behavior verification, see fix-judge.integration.test.ts.
 */
describe('fixJudge tools', () => {
  describe('get_file_diff', () => {
    const tool = fixJudge.tools?.find((t) => t.name === 'get_file_diff');

    it('returns patch content when file has changes', async () => {
      const patches = new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+fixed code']]);
      const context: Partial<FixJudgeContext> = { patches };

      const result = await tool!.execute(
        { path: 'src/db.ts' },
        { comment: {} as never, changedFiles: [], codeBeforeFix: '' },
        context as FixJudgeContext
      );

      expect(result).toBe('@@ -40,5 +40,7 @@\n+fixed code');
    });

    it('returns "No changes found" when file not in patches', async () => {
      const patches = new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']]);
      const context: Partial<FixJudgeContext> = { patches };

      const result = await tool!.execute(
        { path: 'src/other.ts' },
        { comment: {} as never, changedFiles: [], codeBeforeFix: '' },
        context as FixJudgeContext
      );

      expect(result).toBe('No changes found for this file');
    });

    it('returns "No changes found" when patches not in context', async () => {
      const context: Partial<FixJudgeContext> = {};

      const result = await tool!.execute(
        { path: 'src/db.ts' },
        { comment: {} as never, changedFiles: [], codeBeforeFix: '' },
        context as FixJudgeContext
      );

      expect(result).toBe('No changes found for this file');
    });
  });
});
