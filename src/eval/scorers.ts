import { createScorer } from 'evalite';
import type { TaskOutput } from './task.js';
import type { LoadedFixture, ExpectedBug } from './types.js';

/**
 * Presence scorer: Did we find bugs when expected? Did we avoid false positives?
 * Returns F1 score based on true/false positive/negative counts.
 */
export const PresenceScorer = createScorer<LoadedFixture, TaskOutput, ExpectedBug[]>({
  name: 'Presence',
  description: 'F1 score for finding expected bugs without false positives',
  scorer: ({ output }) => {
    const { found, missed, spurious } = output;

    const precision = found + spurious > 0 ? found / (found + spurious) : 1;
    const recall = found + missed > 0 ? found / (found + missed) : 1;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return {
      score: f1,
      metadata: { precision, recall, found, missed, spurious },
    };
  },
});

/**
 * Accuracy scorer: Do findings actually match the expected bugs?
 * Uses LLM-as-judge results to verify semantic match.
 */
export const AccuracyScorer = createScorer<LoadedFixture, TaskOutput, ExpectedBug[]>({
  name: 'Accuracy',
  description: 'How well findings match expected bugs (LLM-as-judge)',
  scorer: ({ output }) => {
    if (output.matchOutcomes.length === 0) {
      return { score: 1, metadata: { reason: 'No expected bugs' } };
    }

    // Count high-confidence matches
    const highConfidence = output.matchOutcomes.filter(
      (m) => m.outcome === 'true_positive' && m.judgeResult?.confidence === 'high'
    ).length;

    const total = output.matchOutcomes.length;
    const score = total > 0 ? highConfidence / total : 1;

    return {
      score,
      metadata: { highConfidence, total, outcomes: output.matchOutcomes },
    };
  },
});
