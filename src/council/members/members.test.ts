import { describe, it, expect } from 'vitest';
import { fixJudge, duplicateJudge, councilMembers, listCouncilMembers } from './index.js';

describe('council members', () => {
  describe('fixJudge', () => {
    it('has correct metadata', () => {
      expect(fixJudge.name).toBe('fix-judge');
      expect(fixJudge.description).toContain('addressed');
    });

    it('builds prompt with comment and before/after code', () => {
      const comment = {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'SQL Injection',
        description: 'User input passed to query',
        contentHash: 'abc',
      };
      const beforeCode = '42: const query = `SELECT * FROM users WHERE id = ${id}`;';
      const afterCode = '42: const query = db.prepare("SELECT * FROM users WHERE id = ?").bind(id);';

      const prompt = fixJudge.buildPrompt({ comment, beforeCode, afterCode });

      expect(prompt).toContain('SQL Injection');
      expect(prompt).toContain('src/db.ts');
      expect(prompt).toContain('near line 42');
      expect(prompt).toContain(beforeCode);
      expect(prompt).toContain(afterCode);
      expect(prompt).toContain('Code BEFORE');
      expect(prompt).toContain('Code AFTER');
      expect(prompt).toContain('not_attempted');
      expect(prompt).toContain('attempted_failed');
      expect(prompt).toContain('resolved');
    });

    it('has tools defined', () => {
      expect(fixJudge.tools).toBeDefined();
      expect(fixJudge.tools).toHaveLength(1);
      const tools = fixJudge.tools;
      if (tools && tools[0]) {
        expect(tools[0].name).toBe('get_file_at_commit');
      }
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
