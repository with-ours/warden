import { describe, it, expect } from 'vitest';
import { FLAKE8_CATALOG, lookupRule, getRulesByPlugin, formatCatalogForPrompt } from './flake8.js';

describe('flake8 catalog', () => {
  it('contains rules from multiple plugins', () => {
    const plugins = new Set(FLAKE8_CATALOG.map((r) => r.plugin));
    expect(plugins.size).toBeGreaterThan(5);
    expect(plugins).toContain('pycodestyle');
    expect(plugins).toContain('pyflakes');
    expect(plugins).toContain('flake8-bugbear');
  });

  it('has no duplicate rule codes', () => {
    const codes = FLAKE8_CATALOG.map((r) => r.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});

describe('lookupRule', () => {
  it('finds E722 (bare except)', () => {
    const rule = lookupRule('E722');
    expect(rule).toBeDefined();
    expect(rule?.description).toContain('bare');
  });

  it('finds B006 (mutable defaults)', () => {
    const rule = lookupRule('B006');
    expect(rule).toBeDefined();
    expect(rule?.plugin).toBe('flake8-bugbear');
  });

  it('returns undefined for unknown codes', () => {
    expect(lookupRule('ZZZZZ')).toBeUndefined();
  });
});

describe('getRulesByPlugin', () => {
  it('returns all pyflakes rules', () => {
    const rules = getRulesByPlugin('pyflakes');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.code.startsWith('F'))).toBe(true);
  });

  it('returns empty for unknown plugin', () => {
    expect(getRulesByPlugin('nonexistent')).toHaveLength(0);
  });
});

describe('formatCatalogForPrompt', () => {
  it('produces a string with plugin sections', () => {
    const output = formatCatalogForPrompt();
    expect(output).toContain('[pycodestyle]');
    expect(output).toContain('[pyflakes]');
    expect(output).toContain('[flake8-bugbear]');
    expect(output).toContain('E722');
  });

  it('includes rule descriptions', () => {
    const output = formatCatalogForPrompt();
    expect(output).toContain('do not use bare');
  });
});
