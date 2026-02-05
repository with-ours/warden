import { describe, it, expect } from 'vitest';
import {
  stripCodeFences,
  extractJson,
  extractAndParseJson,
  extractBalancedJson,
} from './json.js';

describe('stripCodeFences', () => {
  it('removes json code fence', () => {
    const input = '```json\n{"foo": "bar"}\n```';
    expect(stripCodeFences(input)).toBe('{"foo": "bar"}');
  });

  it('removes typescript code fence', () => {
    const input = '```typescript\nconst x = 1;\n```';
    expect(stripCodeFences(input)).toBe('const x = 1;');
  });

  it('removes plain code fence', () => {
    const input = '```\ncode here\n```';
    expect(stripCodeFences(input)).toBe('code here');
  });

  it('returns original text if no fence', () => {
    const input = '{"foo": "bar"}';
    expect(stripCodeFences(input)).toBe(input);
  });

  it('handles code fence with special language tags', () => {
    const input = '```c++\nint main() {}\n```';
    expect(stripCodeFences(input)).toBe('int main() {}');
  });
});

describe('extractJson', () => {
  it('extracts JSON object', () => {
    const input = 'Here is the result: {"success": true}';
    expect(extractJson(input)).toBe('{"success": true}');
  });

  it('extracts JSON array', () => {
    const input = 'Results: [1, 2, 3]';
    expect(extractJson(input)).toBe('[1, 2, 3]');
  });

  it('extracts from code fence', () => {
    const input = '```json\n{"foo": "bar"}\n```';
    expect(extractJson(input)).toBe('{"foo": "bar"}');
  });

  it('returns null for text without JSON', () => {
    const input = 'No JSON here!';
    expect(extractJson(input)).toBeNull();
  });

  it('extracts nested JSON object', () => {
    const input = 'Data: {"outer": {"inner": true}}';
    expect(extractJson(input)).toBe('{"outer": {"inner": true}}');
  });

  it('does not over-match when text contains braces after JSON', () => {
    // Regression test: greedy regex would match from first { to last }
    const input = '{"verdict": "ok"} The function() { return x; } works';
    expect(extractJson(input)).toBe('{"verdict": "ok"}');
  });

  it('does not over-match arrays with trailing braces', () => {
    const input = '[1, 2] and then some { other } stuff';
    expect(extractJson(input)).toBe('[1, 2]');
  });
});

describe('extractAndParseJson', () => {
  it('extracts and parses JSON object', () => {
    const input = 'Result: {"value": 42}';
    expect(extractAndParseJson(input)).toEqual({ value: 42 });
  });

  it('extracts and parses JSON array', () => {
    const input = 'Items: [1, 2, 3]';
    expect(extractAndParseJson(input)).toEqual([1, 2, 3]);
  });

  it('returns null for invalid JSON', () => {
    const input = 'Bad: {invalid json}';
    expect(extractAndParseJson(input)).toBeNull();
  });

  it('returns null for no JSON', () => {
    const input = 'No JSON';
    expect(extractAndParseJson(input)).toBeNull();
  });
});

describe('extractBalancedJson', () => {
  it('extracts simple object', () => {
    const input = '{"foo": "bar"}';
    expect(extractBalancedJson(input)).toBe('{"foo": "bar"}');
  });

  it('extracts nested object', () => {
    const input = '{"a": {"b": {"c": 1}}}';
    expect(extractBalancedJson(input)).toBe('{"a": {"b": {"c": 1}}}');
  });

  it('handles strings with braces', () => {
    const input = '{"text": "hello { world }"}';
    expect(extractBalancedJson(input)).toBe('{"text": "hello { world }"}');
  });

  it('handles escaped quotes', () => {
    const input = '{"text": "say \\"hello\\""}';
    expect(extractBalancedJson(input)).toBe('{"text": "say \\"hello\\""}');
  });

  it('extracts from offset', () => {
    const input = 'prefix {"foo": "bar"} suffix';
    expect(extractBalancedJson(input, 7)).toBe('{"foo": "bar"}');
  });

  it('extracts array', () => {
    const input = '[1, [2, 3], 4]';
    expect(extractBalancedJson(input)).toBe('[1, [2, 3], 4]');
  });

  it('returns null if no JSON found', () => {
    const input = 'no json here';
    expect(extractBalancedJson(input)).toBeNull();
  });

  it('returns null for unbalanced JSON', () => {
    const input = '{"unclosed": true';
    expect(extractBalancedJson(input)).toBeNull();
  });

  it('handles mixed objects and arrays', () => {
    const input = '{"items": [1, {"nested": true}, 3]}';
    expect(extractBalancedJson(input)).toBe('{"items": [1, {"nested": true}, 3]}');
  });
});
