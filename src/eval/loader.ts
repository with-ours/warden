import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { FixtureSchema } from './types.js';
import type { Fixture, LoadedFixture } from './types.js';

const FIXTURE_FILENAME = '_fixture.json';

/**
 * Get the default evals directory path (repo root/evals).
 */
export function getEvalsDir(): string {
  // This file is at src/eval/loader.ts, so we need to go up to repo root
  return join(import.meta.dirname, '..', '..', 'evals');
}

/**
 * Get the eval skills directory path (evals/skills).
 */
export function getEvalSkillsDir(): string {
  return join(getEvalsDir(), 'skills');
}

/**
 * Discover all fixtures with _fixture.json files.
 * Returns an array of absolute paths to fixture directories.
 *
 * Skips the `skills/` directory which contains skill definitions, not fixtures.
 */
export function discoverFixtures(baseDir?: string): string[] {
  const evalsDir = baseDir ?? getEvalsDir();
  const fixtures: string[] = [];

  if (!existsSync(evalsDir)) {
    return fixtures;
  }

  // Recursively find directories containing _fixture.json
  function scanDir(dir: string, isRoot = false): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      // Skip hidden directories, baselines, and skills/ at root level
      if (entry.startsWith('.') || entry === 'baselines') continue;
      if (isRoot && entry === 'skills') continue;

      const entryPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(entryPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        const fixturePath = join(entryPath, FIXTURE_FILENAME);
        if (existsSync(fixturePath)) {
          fixtures.push(entryPath);
        }
        // Continue scanning subdirectories
        scanDir(entryPath, false);
      }
    }
  }

  scanDir(evalsDir, true);
  return fixtures;
}

/**
 * Load and validate a _fixture.json file from a fixture directory.
 */
export function loadFixture(dir: string): Fixture {
  const fixturePath = join(dir, FIXTURE_FILENAME);

  if (!existsSync(fixturePath)) {
    throw new Error(`No ${FIXTURE_FILENAME} found in ${dir}`);
  }

  let content: string;
  try {
    content = readFileSync(fixturePath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read ${fixturePath}: ${error}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse ${fixturePath}: ${error}`);
  }

  const validated = FixtureSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid ${FIXTURE_FILENAME} in ${dir}: ${issues}`);
  }

  return validated.data;
}

/**
 * Get all source files in a fixture directory (excludes _fixture.json).
 * Returns absolute paths to the files.
 */
export function getFixtureFiles(dir: string): string[] {
  const files: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry === FIXTURE_FILENAME) continue;
    if (entry.startsWith('.')) continue;

    const entryPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(entryPath);
    } catch {
      continue;
    }

    if (stat.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

/**
 * Load a fixture with all its metadata and files.
 */
export function loadFixtureWithFiles(dir: string, baseDir?: string): LoadedFixture {
  const evalsDir = baseDir ?? getEvalsDir();
  const fixture = loadFixture(dir);
  const files = getFixtureFiles(dir);

  // Generate a readable name from the path relative to evals dir
  const relativePath = relative(evalsDir, dir);
  const name = relativePath || basename(dir);

  return {
    path: dir,
    name,
    fixture,
    files,
  };
}

/**
 * Discover and load all fixtures matching optional filters.
 */
export interface DiscoverOptions {
  /** Base directory for fixtures (default: evals/) */
  baseDir?: string;
  /** Filter by skill name */
  skill?: string;
  /** Filter by tag */
  tag?: string;
  /** Load specific fixture by path */
  fixturePath?: string;
}

export function discoverAndLoadFixtures(options: DiscoverOptions = {}): LoadedFixture[] {
  const { baseDir, skill, tag, fixturePath } = options;

  // If specific fixture path provided, load only that one
  if (fixturePath) {
    const resolvedPath = existsSync(fixturePath)
      ? fixturePath
      : join(baseDir ?? getEvalsDir(), fixturePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`Fixture not found: ${fixturePath}`);
    }

    const loaded = loadFixtureWithFiles(resolvedPath, baseDir);
    return [loaded];
  }

  // Discover all fixtures and apply filters
  const fixtureDirs = discoverFixtures(baseDir);

  return fixtureDirs
    .map((dir) => loadFixtureWithFiles(dir, baseDir))
    .filter((loaded) => {
      // Skip if marked as skip
      if (loaded.fixture.skip) return false;
      // Filter by skill
      if (skill && loaded.fixture.skill !== skill) return false;
      // Filter by tag
      if (tag && !loaded.fixture.tags?.includes(tag)) return false;
      return true;
    });
}

/**
 * Fixtures grouped by skill name.
 */
export type SkillFixtures = Record<string, LoadedFixture[]>;

/**
 * Discover and load all fixtures, grouped by skill name.
 * This is useful for organizing tests by skill.
 */
export function discoverSkills(baseDir?: string): SkillFixtures {
  const fixtures = discoverAndLoadFixtures({ baseDir });
  const grouped: SkillFixtures = {};

  for (const fixture of fixtures) {
    const skill = fixture.fixture.skill;
    grouped[skill] ??= [];
    grouped[skill].push(fixture);
  }

  return grouped;
}

/**
 * Load all fixtures for a specific skill.
 * Convenience function for evalite evals.
 */
export function loadSkillFixtures(skillName: string, baseDir?: string): LoadedFixture[] {
  const skills = discoverSkills(baseDir);
  return skills[skillName] ?? [];
}
