import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../cli/args.js';

describe('generate-linters command parsing', () => {
  it('parses "generate-linters" as the command', () => {
    const result = parseCliArgs(['generate-linters']);
    expect(result.command).toBe('generate-linters');
    expect(result.generateLintersOptions).toBeDefined();
  });

  it('parses --since option', () => {
    const result = parseCliArgs(['generate-linters', '--since', '30d']);
    expect(result.generateLintersOptions?.since).toBe('30d');
  });

  it('parses --json flag', () => {
    const result = parseCliArgs(['generate-linters', '--json']);
    expect(result.generateLintersOptions?.json).toBe(true);
  });

  it('defaults json to false', () => {
    const result = parseCliArgs(['generate-linters']);
    expect(result.generateLintersOptions?.json).toBe(false);
  });

  it('defaults since to undefined', () => {
    const result = parseCliArgs(['generate-linters']);
    expect(result.generateLintersOptions?.since).toBeUndefined();
  });
});
