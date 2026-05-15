import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  preloadPiBedrockProviderForActionBundle,
  preloadPiRuntimeForActionBundle,
} from './pi-ncc-compat.js';

function nccBuiltinError(specifier: string): Error & { code: string } {
  return Object.assign(new Error(`Cannot find module '${specifier}'`), {
    code: 'MODULE_NOT_FOUND',
  });
}

const noopPreloadBedrockProvider = async () => undefined;

describe('preloadPiRuntimeForActionBundle', () => {
  it('installs the Bedrock provider override for bundled actions', async () => {
    const setBedrockProviderModule = vi.fn();
    const bedrockProviderModule = {
      streamBedrock: vi.fn(),
      streamSimpleBedrock: vi.fn(),
    };

    await expect(preloadPiBedrockProviderForActionBundle(
      async () => ({ setBedrockProviderModule }),
      async () => ({ bedrockProviderModule }),
    )).resolves.toBeUndefined();

    expect(setBedrockProviderModule).toHaveBeenCalledWith(bedrockProviderModule);
  });

  it('ignores ncc dynamic-import failures for Pi Node built-ins', async () => {
    const unhandledRejections = new EventEmitter();

    await expect(preloadPiRuntimeForActionBundle(async () => {
      unhandledRejections.emit('unhandledRejection', nccBuiltinError('node:os'));
    }, unhandledRejections, noopPreloadBedrockProvider)).resolves.toBeUndefined();

    expect(unhandledRejections.listenerCount('unhandledRejection')).toBe(0);
  });

  it('keeps unexpected unhandled rejections fatal', async () => {
    const unhandledRejections = new EventEmitter();

    await expect(preloadPiRuntimeForActionBundle(async () => {
      unhandledRejections.emit('unhandledRejection', new Error('real failure'));
    }, unhandledRejections, noopPreloadBedrockProvider)).rejects.toThrow('real failure');

    expect(unhandledRejections.listenerCount('unhandledRejection')).toBe(0);
  });
});
