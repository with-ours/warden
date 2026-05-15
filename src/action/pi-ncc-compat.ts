import { setImmediate as waitForImmediate } from 'node:timers/promises';

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

const NCC_PI_BUILTIN_IMPORT_ERRORS = new Set([
  "Cannot find module 'node:fs'",
  "Cannot find module 'node:os'",
  "Cannot find module 'node:path'",
]);

function isNccPiBuiltinImportFailure(reason: unknown): boolean {
  return (
    reason instanceof Error &&
    'code' in reason &&
    reason.code === 'MODULE_NOT_FOUND' &&
    NCC_PI_BUILTIN_IMPORT_ERRORS.has(reason.message)
  );
}

export async function preloadPiBedrockProviderForActionBundle(
  importRegisterBuiltins: ImportPiRegisterBuiltins = () =>
    import('@earendil-works/pi-ai') as Promise<{
      setBedrockProviderModule(module: PiBedrockProviderModule): void;
    }>,
  importBedrockProvider: ImportPiBedrockProvider = () =>
    import('@earendil-works/pi-ai/bedrock-provider') as Promise<{
      bedrockProviderModule: PiBedrockProviderModule;
    }>,
): Promise<void> {
  const [{ setBedrockProviderModule }, { bedrockProviderModule }] = await Promise.all([
    importRegisterBuiltins(),
    importBedrockProvider(),
  ]);

  setBedrockProviderModule(bedrockProviderModule);
}

/**
 * Preload Pi before action initialization so ncc's dynamic-import rewrite for
 * Pi's env-key helper cannot terminate the bundled GitHub Action.
 */
export async function preloadPiRuntimeForActionBundle(
  importPiRuntime: ImportPiRuntime = () => import('../sdk/runtimes/pi.js'),
  unhandledRejections: UnhandledRejectionTarget = process,
  preloadBedrockProvider: () => Promise<void> = () => preloadPiBedrockProviderForActionBundle(),
): Promise<void> {
  let unexpectedRejection: unknown;
  const onUnhandledRejection = (reason: unknown) => {
    if (isNccPiBuiltinImportFailure(reason)) {
      return;
    }
    unexpectedRejection = reason;
  };

  unhandledRejections.prependListener('unhandledRejection', onUnhandledRejection);
  try {
    await Promise.all([importPiRuntime(), preloadBedrockProvider()]);
    // ncc emits the synthetic missing-builtin rejections after Pi module
    // evaluation, so drain two turns before removing the temporary listener.
    await waitForImmediate();
    await waitForImmediate();
  } finally {
    unhandledRejections.removeListener('unhandledRejection', onUnhandledRejection);
  }

  if (unexpectedRejection) {
    throw unexpectedRejection;
  }
}
