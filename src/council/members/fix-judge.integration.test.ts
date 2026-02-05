/**
 * Integration tests for fix-judge.
 *
 * These tests run against the real Anthropic API when ANTHROPIC_API_KEY is set.
 * Skip these tests in CI by not providing the key.
 *
 * Run locally: ANTHROPIC_API_KEY=sk-... pnpm test fix-judge.integration
 */
import { describe, it, expect } from 'vitest';
import { convene, fixJudge } from '../index.js';
import type { ExistingComment } from '../../output/dedup.js';

const apiKey = process.env['ANTHROPIC_API_KEY'];

// Skip all tests if no API key is available
const describeWithApi = apiKey ? describe : describe.skip;

/**
 * Fixtures representing real-world fix scenarios.
 */
const fixtures = {
  /**
   * SQL injection vulnerability that was properly fixed with parameterized query.
   */
  sqlInjectionFixed: {
    comment: {
      id: 1,
      path: 'src/db.ts',
      line: 42,
      title: 'SQL Injection Vulnerability',
      description:
        'User input is concatenated directly into the SQL query string, allowing attackers to inject malicious SQL.',
      contentHash: 'abc123',
    } as ExistingComment,
    changedFiles: ['src/db.ts'],
    codeBeforeFix: `40: async function getUser(userId: string) {
41:   // Get user by ID from database
42:   const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
43:   return await db.query(query);
44: }`,
    codeAfterFix: `40: async function getUser(userId: string) {
41:   // Get user by ID from database using parameterized query
42:   const query = 'SELECT * FROM users WHERE id = ?';
43:   return await db.query(query, [userId]);
44: }`,
    expectedStatus: 'resolved' as const,
  },

  /**
   * SQL injection vulnerability where fix attempt was incomplete (still vulnerable).
   */
  sqlInjectionIncomplete: {
    comment: {
      id: 2,
      path: 'src/db.ts',
      line: 42,
      title: 'SQL Injection Vulnerability',
      description:
        'User input is concatenated directly into the SQL query string, allowing attackers to inject malicious SQL.',
      contentHash: 'def456',
    } as ExistingComment,
    changedFiles: ['src/db.ts'],
    codeBeforeFix: `40: async function getUser(userId: string) {
41:   // Get user by ID from database
42:   const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
43:   return await db.query(query);
44: }`,
    codeAfterFix: `40: async function getUser(userId: string) {
41:   // Get user by ID from database - added input validation
42:   const safeId = userId.replace(/'/g, "''"); // Escape quotes - STILL VULNERABLE
43:   const query = \`SELECT * FROM users WHERE id = '\${safeId}'\`;
44:   return await db.query(query);
45: }`,
    expectedStatus: 'attempted_failed' as const,
  },

  /**
   * Code issue where the problematic code was removed entirely.
   */
  codeRemoved: {
    comment: {
      id: 3,
      path: 'src/legacy.ts',
      line: 10,
      title: 'Deprecated API Usage',
      description: 'Using deprecated crypto.createCipher which is insecure.',
      contentHash: 'ghi789',
    } as ExistingComment,
    changedFiles: ['src/legacy.ts'],
    codeBeforeFix: `8: import crypto from 'crypto';
9:
10: const cipher = crypto.createCipher('aes-256-cbc', 'secret');
11: export function encrypt(data: string) {
12:   return cipher.update(data, 'utf8', 'hex');
13: }`,
    codeAfterFix: `(file does not exist at this commit)`,
    expectedStatus: 'resolved' as const,
  },

  /**
   * Unrelated changes that don't address the issue.
   */
  unrelatedChanges: {
    comment: {
      id: 4,
      path: 'src/db.ts',
      line: 42,
      title: 'SQL Injection Vulnerability',
      description:
        'User input is concatenated directly into the SQL query string, allowing attackers to inject malicious SQL.',
      contentHash: 'jkl012',
    } as ExistingComment,
    changedFiles: ['src/utils.ts', 'package.json'],
    codeBeforeFix: `40: async function getUser(userId: string) {
41:   // Get user by ID from database
42:   const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
43:   return await db.query(query);
44: }`,
    codeAfterFix: `40: async function getUser(userId: string) {
41:   // Get user by ID from database
42:   const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
43:   return await db.query(query);
44: }`,
    expectedStatus: 'not_attempted' as const,
  },
};

describeWithApi('fix-judge integration', () => {
  it('recognizes a properly fixed SQL injection', async () => {
    const fixture = fixtures.sqlInjectionFixed;

    const result = await convene(
      fixJudge,
      {
        comment: fixture.comment,
        changedFiles: fixture.changedFiles,
        codeBeforeFix: fixture.codeBeforeFix,
        codeAfterFix: fixture.codeAfterFix,
      },
      { apiKey: apiKey!, debug: true }
    );

    if (!result.success) {
      console.error('Test failed with error:', result.error);
    }
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verdict.status).toBe(fixture.expectedStatus);
      expect(result.usage.inputTokens).toBeGreaterThan(0);
    }
  }, 30000);

  it('recognizes an incomplete fix attempt', async () => {
    const fixture = fixtures.sqlInjectionIncomplete;

    const result = await convene(
      fixJudge,
      {
        comment: fixture.comment,
        changedFiles: fixture.changedFiles,
        codeBeforeFix: fixture.codeBeforeFix,
        codeAfterFix: fixture.codeAfterFix,
      },
      { apiKey: apiKey!, debug: true }
    );

    if (!result.success) {
      console.error('Test failed with error:', result.error);
    }
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verdict.status).toBe(fixture.expectedStatus);
    }
  }, 30000);

  it('recognizes code removal as a valid resolution', async () => {
    const fixture = fixtures.codeRemoved;

    const result = await convene(
      fixJudge,
      {
        comment: fixture.comment,
        changedFiles: fixture.changedFiles,
        codeBeforeFix: fixture.codeBeforeFix,
        codeAfterFix: fixture.codeAfterFix,
      },
      { apiKey: apiKey!, debug: true }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verdict.status).toBe(fixture.expectedStatus);
    }
  }, 30000);

  it('recognizes unrelated changes as not_attempted', async () => {
    const fixture = fixtures.unrelatedChanges;

    const result = await convene(
      fixJudge,
      {
        comment: fixture.comment,
        changedFiles: fixture.changedFiles,
        codeBeforeFix: fixture.codeBeforeFix,
        codeAfterFix: fixture.codeAfterFix,
      },
      { apiKey: apiKey!, debug: true }
    );

    if (!result.success) {
      console.error('Test failed with error:', result.error);
    }
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verdict.status).toBe(fixture.expectedStatus);
    }
  }, 30000);
});

// Describe tests that should always run (no API key needed)
describe('fix-judge fixtures', () => {
  it('has valid fixture structure', () => {
    // Validate all fixtures have required fields
    for (const [name, fixture] of Object.entries(fixtures)) {
      expect(fixture.comment.id, `${name}: comment.id`).toBeDefined();
      expect(fixture.comment.path, `${name}: comment.path`).toBeDefined();
      expect(fixture.comment.line, `${name}: comment.line`).toBeDefined();
      expect(fixture.comment.title, `${name}: comment.title`).toBeDefined();
      expect(fixture.comment.description, `${name}: comment.description`).toBeDefined();
      expect(fixture.changedFiles, `${name}: changedFiles`).toBeDefined();
      expect(fixture.codeBeforeFix, `${name}: codeBeforeFix`).toBeDefined();
      expect(fixture.codeAfterFix, `${name}: codeAfterFix`).toBeDefined();
      expect(fixture.expectedStatus, `${name}: expectedStatus`).toMatch(
        /^(resolved|attempted_failed|not_attempted)$/
      );
    }
  });
});
