type UnhandledRejectionListener = (reason: unknown) => void;
type ImportPiRuntime = () => Promise<unknown>;
type ImportPiRegisterBuiltins = () => Promise<{
    setBedrockProviderModule(module: PiBedrockProviderModule): void;
}>;
type ImportPiBedrockProvider = () => Promise<{
    bedrockProviderModule: PiBedrockProviderModule;
}>;
interface UnhandledRejectionTarget {
    prependListener(eventName: 'unhandledRejection', listener: UnhandledRejectionListener): unknown;
    removeListener(eventName: 'unhandledRejection', listener: UnhandledRejectionListener): unknown;
}
interface PiBedrockProviderModule {
    streamBedrock: unknown;
    streamSimpleBedrock: unknown;
}
export declare function preloadPiBedrockProviderForActionBundle(importRegisterBuiltins?: ImportPiRegisterBuiltins, importBedrockProvider?: ImportPiBedrockProvider): Promise<void>;
/**
 * Preload Pi before action initialization so ncc's dynamic-import rewrite for
 * Pi's env-key helper cannot terminate the bundled GitHub Action.
 */
export declare function preloadPiRuntimeForActionBundle(importPiRuntime?: ImportPiRuntime, unhandledRejections?: UnhandledRejectionTarget, preloadBedrockProvider?: () => Promise<void>): Promise<void>;
export {};
//# sourceMappingURL=pi-ncc-compat.d.ts.map