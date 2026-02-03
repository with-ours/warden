/**
 * GitHub Review State Management
 *
 * Handles coordination of GitHub PR reviews across multiple Warden triggers.
 * Ensures consistent review state by preventing conflicting approvals and
 * tracking the bot's previous review state.
 */
import type { ReviewState, GitHubReview } from '../output/types.js';
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
    /** The final event to post (may be downgraded from APPROVE to COMMENT) */
    reviewEvent: GitHubReview['event'] | undefined;
    /** True if this trigger wanted APPROVE but was downgraded to COMMENT */
    approvalSuppressed: boolean;
    /** Human-readable reason for suppression */
    suppressionReason?: string;
}
/**
 * Coordinate review events across multiple triggers to ensure consistent PR state.
 *
 * Rules (checked in order):
 * 1. If ANY trigger failed (undefined reviewEvent), no trigger posts APPROVE
 * 2. If ANY trigger has REQUEST_CHANGES, no trigger posts APPROVE
 * 3. Only ONE trigger posts APPROVE (first one wins)
 *
 * When APPROVE is blocked, it's downgraded to COMMENT to avoid conflicting state.
 */
export declare function coordinateReviewEvents(triggers: TriggerReviewInput[]): TriggerReviewOutput[];
/**
 * Apply a coordination decision to a GitHub review object.
 *
 * When approval is suppressed:
 * - Downgrades APPROVE to COMMENT
 * - Clears the body to avoid misleading messages like "All issues resolved"
 *
 * Returns the original review unchanged if no suppression needed.
 */
export declare function applyCoordinationToReview(review: GitHubReview | undefined, coordination: TriggerReviewOutput | undefined): GitHubReview | undefined;
/**
 * A GitHub review from the API (subset of fields we need).
 */
export interface GitHubReviewInfo {
    state: string;
    user?: {
        login: string;
    } | null;
}
/**
 * Find the bot's most recent review state on a PR.
 *
 * Used to determine if we should post an APPROVE to clear a previous
 * REQUEST_CHANGES when all issues are now resolved.
 *
 * Returns null if:
 * - Bot has no reviews on this PR
 * - Bot's most recent review was DISMISSED (user explicitly cleared it)
 */
export declare function findBotReviewState(reviews: GitHubReviewInfo[], botLogin: string): ReviewState | null;
//# sourceMappingURL=review-state.d.ts.map