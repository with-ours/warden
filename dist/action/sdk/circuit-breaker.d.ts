import type { ErrorCode } from '../types/index.js';
type CircuitBreakerCode = Extract<ErrorCode, 'auth_failed' | 'provider_unavailable' | 'invalid_model_selector'>;
export interface CircuitBreakerReason {
    code: CircuitBreakerCode;
    message: string;
}
interface ProviderFailureCircuitBreakerOptions {
    maxConsecutiveProviderFailures?: number;
    abortController?: AbortController;
}
/**
 * Tracks unrecoverable provider failures across a Warden run.
 */
export declare class ProviderFailureCircuitBreaker {
    private consecutiveProviderFailures;
    private openReason?;
    private readonly maxConsecutiveProviderFailures;
    private readonly abortController?;
    constructor(options?: ProviderFailureCircuitBreakerOptions);
    get reason(): CircuitBreakerReason | undefined;
    recordSuccess(): void;
    recordFailure(code: ErrorCode, message: string): void;
    private open;
}
export {};
//# sourceMappingURL=circuit-breaker.d.ts.map