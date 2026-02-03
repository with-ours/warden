import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UsageStats } from '../types/index.js';
/**
 * Extract usage stats from an SDK result message.
 */
export declare function extractUsage(result: SDKResultMessage): UsageStats;
/**
 * Create empty usage stats.
 */
export declare function emptyUsage(): UsageStats;
/**
 * Aggregate multiple usage stats into one.
 */
export declare function aggregateUsage(usages: UsageStats[]): UsageStats;
/**
 * Estimate token count from character count.
 * Uses chars/4 as a rough approximation for English text.
 */
export declare function estimateTokens(chars: number): number;
//# sourceMappingURL=usage.d.ts.map