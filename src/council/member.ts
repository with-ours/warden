import type { CouncilMember } from './types.js';

/**
 * Define a council member with type inference.
 */
export function defineCouncilMember<TInput, TVerdict>(
  config: CouncilMember<TInput, TVerdict>
): CouncilMember<TInput, TVerdict> {
  return config;
}
