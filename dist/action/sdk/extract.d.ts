import type { Finding } from '../types/index.js';
/** Pattern to match the start of findings JSON (allows whitespace after brace) */
export declare const FINDINGS_JSON_START: RegExp;
/**
 * Result from extracting findings JSON from text.
 */
export type ExtractFindingsResult = {
    success: true;
    findings: unknown[];
} | {
    success: false;
    error: string;
    preview: string;
};
/**
 * Extract JSON object from text, handling nested braces correctly.
 * Starts from the given position and returns the balanced JSON object.
 */
export declare function extractBalancedJson(text: string, startIndex: number): string | null;
/**
 * Extract findings JSON from model output text.
 * Handles markdown code fences, prose before JSON, and nested objects.
 */
export declare function extractFindingsJson(rawText: string): ExtractFindingsResult;
/**
 * Truncate text for LLM fallback while preserving the findings JSON.
 *
 * Caller must ensure findings JSON exists in the text before calling.
 */
export declare function truncateForLLMFallback(rawText: string, maxChars: number): string;
/**
 * Extract findings from malformed output using LLM as a fallback.
 * Uses claude-haiku-4-5 for lightweight, fast extraction.
 */
export declare function extractFindingsWithLLM(rawText: string, apiKey?: string): Promise<ExtractFindingsResult>;
/**
 * Validate and normalize findings from extracted JSON.
 */
export declare function validateFindings(findings: unknown[], filename: string): Finding[];
/**
 * Deduplicate findings by id and location.
 */
export declare function deduplicateFindings(findings: Finding[]): Finding[];
//# sourceMappingURL=extract.d.ts.map