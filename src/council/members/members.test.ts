import { describe, it, expect } from 'vitest';
import { fixJudge, duplicateJudge, councilMembers, listCouncilMembers } from './index.js';
import type { FixJudgeContext } from './fix-judge.js';

describe('council members', () => {
  describe('fixJudge', () => {
    it('has correct metadata', () => {
      expect(fixJudge.name).toBe('fix-judge');
      expect(fixJudge.description).toContain('addressed');
    });

    it('builds prompt with comment, changed files, and code before fix', () => {
      const comment = {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'SQL Injection',
        description: 'User input passed to query',
        contentHash: 'abc',
      };
      const changedFiles = ['src/db.ts', 'src/utils.ts'];
      const codeBeforeFix = '42: const query = `SELECT * FROM users WHERE id = ${id}`;';

      const prompt = fixJudge.buildPrompt({ comment, changedFiles, codeBeforeFix });

      expect(prompt).toContain('SQL Injection');
      expect(prompt).toContain('src/db.ts');
      expect(prompt).toContain('near line 42');
      expect(prompt).toContain(codeBeforeFix);
      expect(prompt).toContain('src/utils.ts');
      expect(prompt).toContain('Files Changed');
      expect(prompt).toContain('not_attempted');
      expect(prompt).toContain('attempted_failed');
      expect(prompt).toContain('resolved');
      expect(prompt).toContain('get_file_diff');
      expect(prompt).toContain('get_file_at_commit');
    });

    it('has both tools defined', () => {
      expect(fixJudge.tools).toBeDefined();
      expect(fixJudge.tools).toHaveLength(2);
      const tools = fixJudge.tools;
      const toolNames = tools?.map((t) => t.name) ?? [];
      expect(toolNames).toContain('get_file_diff');
      expect(toolNames).toContain('get_file_at_commit');
    });

    it('has increased maxToolIterations for exploration', () => {
      expect(fixJudge.maxToolIterations).toBe(5);
    });

    describe('get_file_diff tool', () => {
      it('returns patch content from context', async () => {
        const tool = fixJudge.tools?.find((t) => t.name === 'get_file_diff');
        expect(tool).toBeDefined();

        const patches = new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+fixed code']]);
        const context: Partial<FixJudgeContext> = { patches };

        const result = await tool!.execute(
          { path: 'src/db.ts' },
          { comment: {} as never, changedFiles: [], codeBeforeFix: '' },
          context as FixJudgeContext
        );

        expect(result).toBe('@@ -40,5 +40,7 @@\n+fixed code');
      });

      it('returns message when file not in patches', async () => {
        const tool = fixJudge.tools?.find((t) => t.name === 'get_file_diff');
        expect(tool).toBeDefined();

        const patches = new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']]);
        const context: Partial<FixJudgeContext> = { patches };

        const result = await tool!.execute(
          { path: 'src/other.ts' },
          { comment: {} as never, changedFiles: [], codeBeforeFix: '' },
          context as FixJudgeContext
        );

        expect(result).toBe('No changes found for this file');
      });

      it('returns message when patches not in context', async () => {
        const tool = fixJudge.tools?.find((t) => t.name === 'get_file_diff');
        expect(tool).toBeDefined();

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

  describe('duplicateJudge', () => {
    it('has correct metadata', () => {
      expect(duplicateJudge.name).toBe('duplicate-judge');
      expect(duplicateJudge.description).toContain('duplicates');
    });

    it('builds prompt with findings and comments lists', () => {
      const findings = [
        {
          id: 'f1',
          severity: 'high' as const,
          title: 'XSS Vulnerability',
          description: 'Unescaped output',
          location: { path: 'src/render.ts', startLine: 10 },
        },
      ];
      const existingComments = [
        {
          id: 1,
          path: 'src/render.ts',
          line: 12,
          title: 'XSS Issue',
          description: 'Output not escaped',
          contentHash: 'ghi',
        },
      ];

      const prompt = duplicateJudge.buildPrompt({ findings, existingComments });

      expect(prompt).toContain('XSS Vulnerability');
      expect(prompt).toContain('XSS Issue');
      expect(prompt).toContain('src/render.ts:10');
      expect(prompt).toContain('src/render.ts:12');
    });
  });

  describe('councilMembers registry', () => {
    it('contains all members', () => {
      expect(Object.keys(councilMembers)).toEqual(['fixJudge', 'duplicateJudge']);
    });

    it('members have unique names', () => {
      const names = Object.values(councilMembers).map((m) => m.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('listCouncilMembers', () => {
    it('returns metadata for all members', () => {
      const list = listCouncilMembers();

      expect(list).toHaveLength(2);
      expect(list.map((m) => m.name).sort()).toEqual(['duplicate-judge', 'fix-judge']);

      for (const member of list) {
        expect(member.name).toBeTruthy();
        expect(member.description).toBeTruthy();
      }
    });
  });
});
