import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverFixtures,
  loadFixture,
  getFixtureFiles,
  discoverAndLoadFixtures,
} from './loader.js';
import { FixtureSchema } from './types.js';

describe('discoverFixtures', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `warden-eval-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns array of fixture directories', () => {
    // Create fixture directory with _fixture.json
    const fixtureDir = join(tempDir, 'skill', 'case1');
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      join(fixtureDir, '_fixture.json'),
      JSON.stringify({
        skill: 'test-skill',
        description: 'Test fixture',
        expectedBugs: [],
      })
    );

    const fixtures = discoverFixtures(tempDir);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toBe(fixtureDir);
  });

  it('returns empty array for non-existent directory', () => {
    const fixtures = discoverFixtures('/non/existent/path');
    expect(fixtures).toEqual([]);
  });

  it('skips hidden directories', () => {
    const hiddenDir = join(tempDir, '.hidden', 'case');
    mkdirSync(hiddenDir, { recursive: true });
    writeFileSync(
      join(hiddenDir, '_fixture.json'),
      JSON.stringify({
        skill: 'test',
        description: 'Test',
        expectedBugs: [],
      })
    );

    const fixtures = discoverFixtures(tempDir);
    expect(fixtures).toHaveLength(0);
  });

  it('skips baselines directory', () => {
    const baselinesDir = join(tempDir, 'baselines', 'case');
    mkdirSync(baselinesDir, { recursive: true });
    writeFileSync(
      join(baselinesDir, '_fixture.json'),
      JSON.stringify({
        skill: 'test',
        description: 'Test',
        expectedBugs: [],
      })
    );

    const fixtures = discoverFixtures(tempDir);
    expect(fixtures).toHaveLength(0);
  });
});

describe('loadFixture', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `warden-eval-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads and validates _fixture.json', () => {
    writeFileSync(
      join(tempDir, '_fixture.json'),
      JSON.stringify({
        skill: 'eval-test',
        description: 'SQL injection test',
        expectedBugs: [
          {
            id: 'sql-1',
            file: 'db.ts',
            bug: 'SQL injection',
            severity: 'critical',
          },
        ],
      })
    );

    const fixture = loadFixture(tempDir);
    expect(fixture.skill).toBe('eval-test');
    expect(fixture.description).toBe('SQL injection test');
    expect(fixture.expectedBugs).toHaveLength(1);
  });

  it('throws for missing _fixture.json', () => {
    expect(() => loadFixture(tempDir)).toThrow('No _fixture.json found');
  });

  it('throws for invalid fixture schema', () => {
    writeFileSync(
      join(tempDir, '_fixture.json'),
      JSON.stringify({
        skill: 'test',
        // missing description and expectedBugs
      })
    );

    expect(() => loadFixture(tempDir)).toThrow('Invalid _fixture.json');
  });
});

describe('getFixtureFiles', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `warden-eval-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns source files excluding _fixture.json', () => {
    writeFileSync(join(tempDir, '_fixture.json'), '{}');
    writeFileSync(join(tempDir, 'db.ts'), 'content');
    writeFileSync(join(tempDir, 'utils.ts'), 'content');

    const files = getFixtureFiles(tempDir);
    expect(files).toHaveLength(2);
    expect(files.every((f) => !f.endsWith('_fixture.json'))).toBe(true);
  });

  it('excludes hidden files', () => {
    writeFileSync(join(tempDir, '.hidden'), 'content');
    writeFileSync(join(tempDir, 'visible.ts'), 'content');

    const files = getFixtureFiles(tempDir);
    expect(files).toHaveLength(1);
  });
});

describe('discoverAndLoadFixtures', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `warden-eval-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('filters by skill', () => {
    // Create two fixtures with different skills
    const fixture1 = join(tempDir, 'skill1', 'case');
    const fixture2 = join(tempDir, 'skill2', 'case');
    mkdirSync(fixture1, { recursive: true });
    mkdirSync(fixture2, { recursive: true });

    writeFileSync(
      join(fixture1, '_fixture.json'),
      JSON.stringify({
        skill: 'skill-a',
        description: 'Test A',
        expectedBugs: [],
      })
    );
    writeFileSync(
      join(fixture2, '_fixture.json'),
      JSON.stringify({
        skill: 'skill-b',
        description: 'Test B',
        expectedBugs: [],
      })
    );

    const fixtures = discoverAndLoadFixtures({ baseDir: tempDir, skill: 'skill-a' });
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]!.fixture.skill).toBe('skill-a');
  });

  it('filters by tag', () => {
    const fixture1 = join(tempDir, 'case1');
    const fixture2 = join(tempDir, 'case2');
    mkdirSync(fixture1, { recursive: true });
    mkdirSync(fixture2, { recursive: true });

    writeFileSync(
      join(fixture1, '_fixture.json'),
      JSON.stringify({
        skill: 'test',
        description: 'Test 1',
        expectedBugs: [],
        tags: ['security'],
      })
    );
    writeFileSync(
      join(fixture2, '_fixture.json'),
      JSON.stringify({
        skill: 'test',
        description: 'Test 2',
        expectedBugs: [],
        tags: ['performance'],
      })
    );

    const fixtures = discoverAndLoadFixtures({ baseDir: tempDir, tag: 'security' });
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]!.fixture.tags).toContain('security');
  });

  it('skips fixtures with skip reason', () => {
    const fixture = join(tempDir, 'case');
    mkdirSync(fixture, { recursive: true });

    writeFileSync(
      join(fixture, '_fixture.json'),
      JSON.stringify({
        skill: 'test',
        description: 'Test',
        expectedBugs: [],
        skip: 'Temporary skip',
      })
    );

    const fixtures = discoverAndLoadFixtures({ baseDir: tempDir });
    expect(fixtures).toHaveLength(0);
  });
});

describe('FixtureSchema', () => {
  it('validates correct fixture', () => {
    const valid = {
      skill: 'eval-test',
      description: 'Test fixture',
      expectedBugs: [
        {
          id: 'bug-1',
          file: 'test.ts',
          bug: 'Description of bug',
        },
      ],
    };
    const result = FixtureSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('validates with optional fields', () => {
    const valid = {
      skill: 'eval-test',
      description: 'Test fixture',
      expectedBugs: [
        {
          id: 'bug-1',
          file: 'test.ts',
          bug: 'Description',
          severity: 'critical',
          line: 10,
        },
      ],
      tags: ['security'],
      skip: 'Reason to skip',
    };
    const result = FixtureSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects invalid severity', () => {
    const invalid = {
      skill: 'test',
      description: 'Test',
      expectedBugs: [
        {
          id: 'bug-1',
          file: 'test.ts',
          bug: 'Description',
          severity: 'invalid',
        },
      ],
    };
    const result = FixtureSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
