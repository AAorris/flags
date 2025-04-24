import { createClient } from '@vercel/edge-config';
import type { Adapter, Decide } from 'flags';
import {
  type Node as HypertuneNode,
  type Value as HypertuneValue,
  type ObjectValue,
  VercelEdgeConfigInitDataProvider,
  type create,
} from 'hypertune';

type _FieldQuery = Parameters<HypertuneNode['getFieldValue']>[1]['query'];
type _Overrides = Parameters<HypertuneNode['setOverride']>[0];

type FunctionOfRootNode = <T>(
  getValue: (
    rootNode: HypertuneNode,
    props: Parameters<Decide<T, HypertuneEntities>>[0],
  ) => T,
) => Adapter<T, HypertuneEntities>;

type FieldValueOfRootNode = <T extends HypertuneValue = HypertuneValue>(opts?: {
  fallback: HypertuneValue;
  fieldArguments: ObjectValue;
  query: _FieldQuery;
  key?: string;
}) => Adapter<T, HypertuneEntities>;

type HypertuneEntities = HypertuneValue;

export type { HypertuneEntities, HypertuneValue };

export function createHypertuneAdapter<
  E extends HypertuneEntities,
  T extends HypertuneNode,
>(options: {
  createSource: typeof create<T>;
  /** The Hypertune token */
  hypertuneToken: string;
  /** Optional Edge Config configuration */
  edgeConfig?: {
    connectionString: string;
    itemKey: string;
  };
}) {
  let _hypertune: T | undefined;
  let _initializePromise: Promise<void> | undefined;

  const initializeHypertune = async (): Promise<void> => {
    _hypertune = options.createSource({
      token: options.hypertuneToken,
      options: {
        initDataProvider: options.edgeConfig
          ? new VercelEdgeConfigInitDataProvider({
              edgeConfigClient: createClient(
                options.edgeConfig.connectionString,
              ),
              itemKey: options.edgeConfig.itemKey,
            })
          : undefined,
      },
    });

    _initializePromise = _hypertune.initIfNeeded();
    await _initializePromise;
  };

  const getHypertune = async () => {
    await (_initializePromise ?? initializeHypertune());
    if (!_hypertune) {
      throw new Error('Hypertune not initialized');
    }
    return _hypertune;
  };

  const getFieldValue: FieldValueOfRootNode = <
    T extends HypertuneValue = HypertuneValue,
  >(
    opts: Parameters<FieldValueOfRootNode>[0],
  ) => {
    return {
      decide: async (props) => {
        const hypertune = await getHypertune();
        const rootNode = hypertune.getFieldNode('root', {
          fieldArguments: {
            context: props.entities as E,
          },
        });
        return rootNode.getFieldValue(opts?.key ?? props.key, {
          fallback: (opts?.fallback ?? props.defaultValue) as HypertuneValue,
          query: opts?.query,
          fieldArguments: opts?.fieldArguments,
        }) as T;
      },
    };
  };

  const fn: FunctionOfRootNode = (getValue) => {
    return {
      decide: async (props) => {
        const hypertune = await getHypertune();
        const rootNode = hypertune.getFieldNode('root', {
          fieldArguments: {
            context: props.entities as E,
          },
        });
        return getValue(rootNode, props);
      },
    };
  };

  const adapter = {
    getFieldValue,
    getHypertune,
    fn,
  };

  return adapter;
}
