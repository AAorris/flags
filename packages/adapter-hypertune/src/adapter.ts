import type { Adapter, GenerousOption, Identify } from 'flags';
import { flag } from 'flags/next';
import { createClient } from '@vercel/edge-config';
import { VercelEdgeConfigInitDataProvider } from 'hypertune';

type FlagDefinition = {
  description?: string;
  options?: Array<{ value: unknown; label: string }>;
  origin?: string;
};

export const createHypertuneFlagFactory = <
  TFlagValues extends Record<string, unknown>,
  TContext extends Record<string, unknown>,
>({
  createSource,
  flagFallbacks,
  flagDefinitions,
  identify,
}: {
  createSource: (options: {
    token: string;
    initDataProvider?: VercelEdgeConfigInitDataProvider;
  }) => {
    initIfNeeded: () => Promise<void>;
    root: (args: { args: { context: TContext } }) => {
      [K in keyof TFlagValues]: (args: {
        fallback: TFlagValues[K];
      }) => TFlagValues[K];
    };
  };
  flagFallbacks: TFlagValues;
  flagDefinitions: Record<keyof TFlagValues, FlagDefinition>;
  identify: Identify<TContext>;
}) => {
  const token = process.env.NEXT_PUBLIC_HYPERTUNE_TOKEN as string;
  const hasEdgeConfig = Boolean(
    process.env.EXPERIMENTATION_CONFIG &&
      process.env.EXPERIMENTATION_CONFIG_ITEM_KEY,
  );

  let _source: ReturnType<typeof createSource> | undefined;
  let _initIfNeededPromise: Promise<void> | undefined;

  const getSource = () => {
    if (!_source) {
      const initDataProvider = hasEdgeConfig
        ? new VercelEdgeConfigInitDataProvider({
            edgeConfigClient: createClient(
              process.env.EXPERIMENTATION_CONFIG as string,
            ),
            itemKey: process.env.EXPERIMENTATION_CONFIG_ITEM_KEY as string,
          })
        : undefined;
      _source = createSource({ token, initDataProvider });
    }
    return _source;
  };

  const hypertuneAdapter = <K extends keyof TFlagValues>(
    key: K,
  ): Adapter<TFlagValues[K], TContext> => {
    return {
      async decide({ entities, defaultValue }) {
        try {
          if (!entities) {
            throw new Error(
              `identify() is required to produce Context for Hypertune flag ${String(
                key,
              )}`,
            );
          }
          if (typeof defaultValue === 'undefined') {
            throw new Error(
              `defaultValue is required for Hypertune flag ${String(key)}`,
            );
          }
          const source = getSource();
          if (!_initIfNeededPromise) {
            _initIfNeededPromise = source.initIfNeeded();
          }
          await _initIfNeededPromise;
          const hypertune = source.root({ args: { context: entities } });
          const method = hypertune[key] as (args: {
            fallback: TFlagValues[K];
          }) => TFlagValues[K];
          const result = method.call(hypertune, {
            fallback: defaultValue,
          });
          return result;
        } catch (error) {
          console.error(error);
          return defaultValue as TFlagValues[K];
        }
      },
    };
  };

  return <K extends keyof TFlagValues>(key: K) => {
    const definition = flagDefinitions[key];
    const flagOptions = definition.options as
      | GenerousOption<TFlagValues[K]>[]
      | undefined;
    return flag<TFlagValues[K], TContext>({
      key: String(key),
      adapter: hypertuneAdapter(key),
      defaultValue: flagFallbacks[key],
      description: definition.description,
      options: flagOptions,
      identify,
    });
  };
};
