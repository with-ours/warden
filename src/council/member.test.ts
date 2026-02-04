import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCouncilMember } from './member.js';

describe('defineCouncilMember', () => {
  it('returns a council member with all properties', () => {
    const schema = z.object({ valid: z.boolean() });
    const member = defineCouncilMember({
      name: 'test-judge',
      description: 'A test judge',
      buildPrompt: (input: { value: string }) => `Evaluate: ${input.value}`,
      schema,
    });

    expect(member.name).toBe('test-judge');
    expect(member.description).toBe('A test judge');
    expect(member.schema).toBe(schema);
    expect(member.buildPrompt({ value: 'foo' })).toBe('Evaluate: foo');
  });

  it('preserves optional config', () => {
    const member = defineCouncilMember({
      name: 'verbose-judge',
      description: 'Needs more tokens',
      buildPrompt: () => 'prompt',
      schema: z.object({ result: z.string() }),
      maxTokens: 1024,
      timeout: 60000,
    });

    expect(member.maxTokens).toBe(1024);
    expect(member.timeout).toBe(60000);
  });

  it('uses defaults when optional config omitted', () => {
    const member = defineCouncilMember({
      name: 'simple-judge',
      description: 'Uses defaults',
      buildPrompt: () => 'prompt',
      schema: z.object({ ok: z.boolean() }),
    });

    expect(member.maxTokens).toBeUndefined();
    expect(member.timeout).toBeUndefined();
  });
});
