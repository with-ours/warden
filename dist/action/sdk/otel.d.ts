import type { UsageStats } from '../types/index.js';
interface SpanLike {
    setAttribute(key: string, value: string | number | boolean | string[] | undefined): unknown;
}
interface GenAiMessage {
    role: string;
    content: unknown;
}
/** Resolve the OpenTelemetry GenAI provider name from runtime and model selectors. */
export declare function genAiProviderName(runtime: string | undefined, model: string | undefined): string;
/** Set GenAI token usage attributes expected by Sentry AI monitoring. */
export declare function setGenAiUsageAttrs(span: SpanLike, usage: UsageStats): void;
/** Set OpenTelemetry GenAI system-instruction attributes for prompt spans. */
export declare function setGenAiSystemInstructionsAttr(span: SpanLike, systemPrompt: string): void;
/** Set OpenTelemetry GenAI input message attributes using the current schema. */
export declare function setGenAiInputMessagesAttr(span: SpanLike, messages: GenAiMessage[]): void;
/** Set OpenTelemetry GenAI output message attributes for text responses. */
export declare function setGenAiOutputMessagesAttr(span: SpanLike, responseText: string, finishReason?: string | null): void;
export {};
//# sourceMappingURL=otel.d.ts.map