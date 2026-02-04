import { describe, it, expect } from 'vitest';
import { formatFailedFixReply } from './github-actions.js';

describe('formatFailedFixReply', () => {
  it('formats reply with short SHA and reasoning', () => {
    const reply = formatFailedFixReply('abc1234567890', 'The fix does not handle edge cases');

    expect(reply).toContain('abc1234');
    expect(reply).not.toContain('abc1234567890');
    expect(reply).toContain('The fix does not handle edge cases');
    expect(reply).toContain('Fix attempt detected');
    expect(reply).toContain('Evaluated by Warden');
  });

  it('preserves multiline reasoning', () => {
    const reasoning = `Multiple issues found:
- Missing null check
- No error handling`;

    const reply = formatFailedFixReply('def456', reasoning);

    expect(reply).toContain('Missing null check');
    expect(reply).toContain('No error handling');
  });
});
