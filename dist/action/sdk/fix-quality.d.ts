import type { Finding, UsageStats } from '../types/index.js';
import type { RuntimeName } from './runtimes/index.js';
import type { FindingProcessingEvent } from './types.js';
export interface FixQualityStats {
    checked: number;
    strippedDeterministic: number;
    strippedSemantic: number;
    semanticUnavailable: number;
}
export interface SanitizeSuggestedFixesResult {
    findings: Finding[];
    stats: FixQualityStats;
    usage?: UsageStats;
}
interface SanitizeSuggestedFixesOptions {
    repoPath: string;
    apiKey?: string;
    runtime?: RuntimeName;
    model?: string;
    maxRetries?: number;
    agentName?: string;
    onFindingProcessing?: (event: FindingProcessingEvent) => void;
}
export declare function sanitizeFindingsSuggestedFixes(findings: Finding[], options: SanitizeSuggestedFixesOptions): Promise<SanitizeSuggestedFixesResult>;
export {};
//# sourceMappingURL=fix-quality.d.ts.map