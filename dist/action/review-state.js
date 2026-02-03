/**
 * GitHub Review State Management
 *
 * Handles coordination of GitHub PR reviews across multiple Warden triggers.
 * Ensures consistent review state by preventing conflicting approvals and
 * tracking the bot's previous review state.
 */
const VALID_REVIEW_STATES = new Set(['CHANGES_REQUESTED', 'APPROVED', 'COMMENTED']);
function isValidReviewState(state) {
    return VALID_REVIEW_STATES.has(state);
}
// -----------------------------------------------------------------------------
// Review Coordination
// -----------------------------------------------------------------------------
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
export function coordinateReviewEvents(triggers) {
    const anyTriggerFailed = triggers.some((t) => t.failed);
    const anyHasBlockingFindings = triggers.some((t) => t.reviewEvent === 'REQUEST_CHANGES');
    let approvalPosted = false;
    return triggers.map((trigger) => {
        const wantsApproval = trigger.reviewEvent === 'APPROVE';
        if (wantsApproval && anyTriggerFailed) {
            return {
                triggerName: trigger.triggerName,
                reviewEvent: 'COMMENT',
                approvalSuppressed: true,
                suppressionReason: 'another trigger failed',
            };
        }
        if (wantsApproval && anyHasBlockingFindings) {
            return {
                triggerName: trigger.triggerName,
                reviewEvent: 'COMMENT',
                approvalSuppressed: true,
                suppressionReason: 'another trigger has blocking findings',
            };
        }
        if (wantsApproval && approvalPosted) {
            return {
                triggerName: trigger.triggerName,
                reviewEvent: 'COMMENT',
                approvalSuppressed: true,
                suppressionReason: 'approval already posted by earlier trigger',
            };
        }
        if (wantsApproval) {
            approvalPosted = true;
        }
        return {
            triggerName: trigger.triggerName,
            reviewEvent: trigger.reviewEvent,
            approvalSuppressed: false,
        };
    });
}
/**
 * Apply a coordination decision to a GitHub review object.
 *
 * When approval is suppressed:
 * - Downgrades APPROVE to COMMENT
 * - Clears the body to avoid misleading messages like "All issues resolved"
 *
 * Returns the original review unchanged if no suppression needed.
 */
export function applyCoordinationToReview(review, coordination) {
    if (!review || !coordination?.approvalSuppressed) {
        return review;
    }
    if (review.event !== 'APPROVE') {
        return review;
    }
    return {
        ...review,
        event: 'COMMENT',
        body: '',
    };
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
export function findBotReviewState(reviews, botLogin) {
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
            return review.state;
        }
    }
    return null;
}
//# sourceMappingURL=review-state.js.map