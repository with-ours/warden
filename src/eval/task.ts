import type { LoadedFixture, MatchOutcome } from './types.js';
import type { Finding } from '../types/index.js';
import { evaluateFixture } from './runner.js';

/**
 * Output from running a fixture through Warden for evalite.
 */
export interface TaskOutput {
  found: number;
  missed: number;
  spurious: number;
  matchOutcomes: MatchOutcome[];
  findings: Finding[];
}

/**
 * Evalite task that runs a fixture through Warden.
 */
export async function runFixtureTask(fixture: LoadedFixture): Promise<TaskOutput> {
  const apiKey = process.env['WARDEN_ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY (or WARDEN_ANTHROPIC_API_KEY) required for evals');
  }

  const result = await evaluateFixture(fixture, { apiKey });

  return {
    found: result.found,
    missed: result.missed,
    spurious: result.spurious,
    matchOutcomes: result.matchOutcomes,
    findings: [], // Findings are summarized in matchOutcomes
  };
}
