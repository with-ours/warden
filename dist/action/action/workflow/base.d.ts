/**
 * Workflow Base
 *
 * Shared infrastructure for PR and schedule workflows.
 */
import type { Octokit } from '@octokit/rest';
import type { SkillReport } from '../../types/index.js';
import type { TriggerResult } from '../triggers/executor.js';
/**
 * Set a GitHub Actions output variable.
 */
export declare function setOutput(name: string, value: string | number): void;
/**
 * Fail the GitHub Action with an error message.
 */
export declare function setFailed(message: string): never;
/**
 * Start a collapsible log group.
 */
export declare function logGroup(name: string): void;
/**
 * End a collapsible log group.
 */
export declare function logGroupEnd(): void;
/**
 * Find the Claude Code CLI executable path.
 * Required in CI environments where the SDK can't auto-detect the CLI location.
 */
export declare function findClaudeCodeExecutable(): string;
/**
 * Log trigger error summary and fail if all triggers failed.
 */
export declare function handleTriggerErrors(triggerErrors: string[], totalTriggers: number): void;
/**
 * Collect error messages from trigger results.
 */
export declare function collectTriggerErrors(results: TriggerResult[]): string[];
export interface WorkflowOutputs {
    findingsCount: number;
    criticalCount: number;
    highCount: number;
    summary: string;
}
/**
 * Compute workflow outputs from reports.
 */
export declare function computeWorkflowOutputs(reports: SkillReport[]): WorkflowOutputs;
/**
 * Set workflow output variables.
 */
export declare function setWorkflowOutputs(outputs: WorkflowOutputs): void;
/**
 * Get the authenticated bot's login name.
 * For GitHub Apps, this returns the app's slug with [bot] suffix (e.g., "warden[bot]").
 */
export declare function getAuthenticatedBotLogin(octokit: Octokit): Promise<string | null>;
/**
 * Get the default branch for a repository from the GitHub API.
 */
export declare function getDefaultBranchFromAPI(octokit: Octokit, owner: string, repo: string): Promise<string>;
//# sourceMappingURL=base.d.ts.map