import { describe, it, expect } from 'vitest';
import {
  findBotReviewState,
  coordinateReviewEvents,
  applyCoordinationToReview,
} from './review-state.js';

describe('findBotReviewState', () => {
  const botLogin = 'warden[bot]';

  it('returns null when no reviews exist', () => {
    expect(findBotReviewState([], botLogin)).toBeNull();
  });

  it('returns null when no reviews from bot exist', () => {
    const reviews = [
      { id: 1, state: 'APPROVED', user: { login: 'human-reviewer' } },
      { id: 2, state: 'COMMENTED', user: { login: 'other-bot[bot]' } },
    ];
    expect(findBotReviewState(reviews, botLogin)).toBeNull();
  });

  it('returns most recent bot review state and ID', () => {
    const reviews = [
      { id: 100, state: 'CHANGES_REQUESTED', user: { login: botLogin } },
      { id: 101, state: 'APPROVED', user: { login: 'human-reviewer' } },
    ];
    expect(findBotReviewState(reviews, botLogin)).toEqual({
      state: 'CHANGES_REQUESTED',
      reviewId: 100,
    });
  });

  it('returns most recent when multiple bot reviews exist', () => {
    const reviews = [
      { id: 100, state: 'CHANGES_REQUESTED', user: { login: botLogin } }, // older
      { id: 101, state: 'APPROVED', user: { login: botLogin } }, // newer
    ];
    expect(findBotReviewState(reviews, botLogin)).toEqual({
      state: 'APPROVED',
      reviewId: 101,
    });
  });

  it('returns null when most recent bot review is DISMISSED', () => {
    const reviews = [
      { id: 100, state: 'CHANGES_REQUESTED', user: { login: botLogin } }, // older
      { id: 101, state: 'DISMISSED', user: { login: botLogin } }, // newer - user dismissed
    ];
    expect(findBotReviewState(reviews, botLogin)).toBeNull();
  });

  it('does not look past DISMISSED review to find older state', () => {
    const reviews = [
      { id: 100, state: 'CHANGES_REQUESTED', user: { login: botLogin } }, // oldest
      { id: 101, state: 'APPROVED', user: { login: botLogin } }, // middle
      { id: 102, state: 'DISMISSED', user: { login: botLogin } }, // newest - dismissed
    ];
    // Should return null, not APPROVED or CHANGES_REQUESTED
    expect(findBotReviewState(reviews, botLogin)).toBeNull();
  });

  it('ignores other bots DISMISSED state', () => {
    const reviews = [
      { id: 100, state: 'CHANGES_REQUESTED', user: { login: botLogin } },
      { id: 101, state: 'DISMISSED', user: { login: 'other-bot[bot]' } }, // different bot
    ];
    // Our bot's CHANGES_REQUESTED should still be found
    expect(findBotReviewState(reviews, botLogin)).toEqual({
      state: 'CHANGES_REQUESTED',
      reviewId: 100,
    });
  });

  it('handles reviews with null user', () => {
    const reviews = [
      { id: 100, state: 'CHANGES_REQUESTED', user: null },
      { id: 101, state: 'APPROVED', user: { login: botLogin } },
    ];
    expect(findBotReviewState(reviews, botLogin)).toEqual({
      state: 'APPROVED',
      reviewId: 101,
    });
  });

  it('handles reviews with missing user', () => {
    const reviews = [
      { id: 100, state: 'CHANGES_REQUESTED' } as { id: number; state: string; user?: { login: string } | null },
      { id: 101, state: 'COMMENTED', user: { login: botLogin } },
    ];
    expect(findBotReviewState(reviews, botLogin)).toEqual({
      state: 'COMMENTED',
      reviewId: 101,
    });
  });

  it('skips unknown review states', () => {
    const reviews = [
      { id: 100, state: 'CHANGES_REQUESTED', user: { login: botLogin } },
      { id: 101, state: 'PENDING', user: { login: botLogin } }, // unknown state
    ];
    // Should skip PENDING and return CHANGES_REQUESTED
    expect(findBotReviewState(reviews, botLogin)).toEqual({
      state: 'CHANGES_REQUESTED',
      reviewId: 100,
    });
  });
});

describe('coordinateReviewEvents', () => {
  describe('single trigger', () => {
    it('passes through REQUEST_CHANGES for single trigger', () => {
      const result = coordinateReviewEvents([
        { triggerName: 'trigger1', reviewEvent: 'REQUEST_CHANGES', failed: false },
      ]);

      expect(result).toEqual([
        { triggerName: 'trigger1', reviewEvent: 'REQUEST_CHANGES' },
      ]);
    });

    it('passes through COMMENT for single trigger', () => {
      const result = coordinateReviewEvents([
        { triggerName: 'trigger1', reviewEvent: 'COMMENT', failed: false },
      ]);

      expect(result).toEqual([
        { triggerName: 'trigger1', reviewEvent: 'COMMENT' },
      ]);
    });
  });

  describe('multiple triggers', () => {
    it('passes through all review events from multiple triggers', () => {
      const result = coordinateReviewEvents([
        { triggerName: 'trigger1', reviewEvent: 'COMMENT', failed: false },
        { triggerName: 'trigger2', reviewEvent: 'REQUEST_CHANGES', failed: false },
        { triggerName: 'trigger3', reviewEvent: 'COMMENT', failed: false },
      ]);

      expect(result).toEqual([
        { triggerName: 'trigger1', reviewEvent: 'COMMENT' },
        { triggerName: 'trigger2', reviewEvent: 'REQUEST_CHANGES' },
        { triggerName: 'trigger3', reviewEvent: 'COMMENT' },
      ]);
    });

    it('handles undefined reviewEvent from failed or silent triggers', () => {
      const result = coordinateReviewEvents([
        { triggerName: 'failed-trigger', reviewEvent: undefined, failed: true },
        { triggerName: 'clean-trigger', reviewEvent: 'COMMENT', failed: false },
      ]);

      expect(result).toEqual([
        { triggerName: 'failed-trigger', reviewEvent: undefined },
        { triggerName: 'clean-trigger', reviewEvent: 'COMMENT' },
      ]);
    });
  });

  describe('edge cases', () => {
    it('handles empty trigger list', () => {
      const result = coordinateReviewEvents([]);
      expect(result).toEqual([]);
    });

    it('ignores unresolvedWardenComments parameter (kept for API compatibility)', () => {
      const unresolvedComments = [
        {
          id: 1,
          path: 'file.ts',
          line: 10,
          title: 'Issue',
          description: 'Description',
          contentHash: 'abc123',
          isWarden: true,
          isResolved: false,
        },
      ];

      const result = coordinateReviewEvents(
        [{ triggerName: 'trigger', reviewEvent: 'COMMENT', failed: false }],
        unresolvedComments
      );

      expect(result).toEqual([
        { triggerName: 'trigger', reviewEvent: 'COMMENT' },
      ]);
    });
  });
});

describe('applyCoordinationToReview', () => {
  it('returns review unchanged', () => {
    const review = {
      event: 'REQUEST_CHANGES' as const,
      body: 'Issues found.',
      comments: [{ body: 'Fix this', path: 'file.ts', line: 5 }],
    };
    const coordination = {
      triggerName: 'test',
      reviewEvent: 'REQUEST_CHANGES' as const,
    };

    const result = applyCoordinationToReview(review, coordination);

    expect(result).toEqual(review);
  });

  it('returns undefined when review is undefined', () => {
    const coordination = {
      triggerName: 'test',
      reviewEvent: 'COMMENT' as const,
    };

    const result = applyCoordinationToReview(undefined, coordination);

    expect(result).toBeUndefined();
  });

  it('returns review unchanged when coordination is undefined', () => {
    const review = {
      event: 'COMMENT' as const,
      body: '',
      comments: [],
    };

    const result = applyCoordinationToReview(review, undefined);

    expect(result).toEqual(review);
  });
});
