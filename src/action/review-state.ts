/**
 * GitHub Review State Management
 *
 * Handles coordination of GitHub PR reviews across multiple Warden triggers.
 * Ensures consistent review state by preventing conflicting approvals and
 * tracking the bot's previous review state.
 */

import type { ReviewState, GitHubReview } from '../output/types.js';
import type { ExistingComment } from '../output/dedup.js';

const VALID_REVIEW_STATES: ReadonlySet<string> = new Set(['CHANGES_REQUESTED', 'APPROVED', 'COMMENTED']);

function isValidReviewState(state: string): state is ReviewState {
  return VALID_REVIEW_STATES.has(state);
}

// -----------------------------------------------------------------------------
// Review Coordination Types
// -----------------------------------------------------------------------------

/**
 * Input to the review coordination function.
 * Represents what review event a trigger wants to post.
 */
export interface TriggerReviewInput {
  triggerName: string;
  /** The review event this trigger wants to post, or undefined if silent (no review to post) */
  reviewEvent: GitHubReview['event'] | undefined;
  /** True if this trigger failed with an error (distinct from silent triggers with no review) */
  failed: boolean;
}

/**
 * Output from review coordination.
 * Contains the final decision about what review event to post.
 */
export interface TriggerReviewOutput {
  triggerName: string;
  /** The final event to post */
  reviewEvent: GitHubReview['event'] | undefined;
}

// -----------------------------------------------------------------------------
// Review Coordination
// -----------------------------------------------------------------------------

/**
 * Coordinate review events across multiple triggers to ensure consistent PR state.
 *
 * Since we no longer post APPROVE reviews (dismissal is handled separately via
 * the dismissReview API), this simply passes through the review events from
 * each trigger. The only coordination needed is ensuring REQUEST_CHANGES from
 * one trigger doesn't conflict with other triggers, but GitHub handles this
 * correctly since each trigger posts its own review.
 *
 * @param triggers - Review inputs from each trigger
 * @param _unresolvedWardenComments - Unused, kept for API compatibility
 */
export function coordinateReviewEvents(
  triggers: TriggerReviewInput[],
  _unresolvedWardenComments?: ExistingComment[]
): TriggerReviewOutput[] {
  return triggers.map((trigger) => ({
    triggerName: trigger.triggerName,
    reviewEvent: trigger.reviewEvent,
  }));
}

/**
 * Apply a coordination decision to a GitHub review object.
 *
 * Since we no longer post APPROVE reviews, this simply returns the review unchanged.
 * Kept for API compatibility.
 */
export function applyCoordinationToReview(
  review: GitHubReview | undefined,
  _coordination: TriggerReviewOutput | undefined
): GitHubReview | undefined {
  return review;
}

// -----------------------------------------------------------------------------
// Bot Review History
// -----------------------------------------------------------------------------

/**
 * A GitHub review from the API (subset of fields we need).
 */
export interface GitHubReviewInfo {
  id: number;
  state: string;
  user?: { login: string } | null;
}

/**
 * Result of finding the bot's most recent review.
 * Contains both state and ID so we can dismiss if needed.
 */
export interface BotReviewInfo {
  state: ReviewState;
  reviewId: number;
}

/**
 * Find the bot's most recent review state on a PR.
 *
 * Used to determine if we should dismiss a previous CHANGES_REQUESTED
 * when all issues are now resolved.
 *
 * Returns null if:
 * - Bot has no reviews on this PR
 * - Bot's most recent review was DISMISSED (user explicitly cleared it)
 */
export function findBotReviewState(reviews: GitHubReviewInfo[], botLogin: string): BotReviewInfo | null {
  // GitHub API returns reviews in chronological order, search from end
  for (let i = reviews.length - 1; i >= 0; i--) {
    const review = reviews[i];
    if (!review?.user || review.user.login !== botLogin) {
      continue;
    }

    // User dismissed our review - don't look at older reviews
    if (review.state === 'DISMISSED') {
      return null;
    }

    if (isValidReviewState(review.state)) {
      return { state: review.state, reviewId: review.id };
    }
  }

  return null;
}
