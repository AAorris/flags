import {
  create,
  VercelEdgeConfigInitDataProvider,
  type Node as HypertuneNode,
  type Value as HypertuneValue,
} from 'hypertune';
import { createClient } from '@vercel/edge-config';
import type { Adapter } from 'flags';

export type Context = NonNullable<HypertuneNode['props']['context']>;

type HypertuneEntities = HypertuneValue;
interface HypertuneAdapter {
  fn: <T>(f: (rootNode: HypertuneNode) => T) => Adapter<T, HypertuneEntities>;
  getHypertune: () => Promise<HypertuneNode>;
}

export function createHypertuneAdapter(options: {
  /** The Hypertune token */
  hypertuneToken: string;
  /** Optional Edge Config configuration */
  edgeConfig?: {
    connectionString: string;
    itemKey: string;
  };
  environment?: string;
}): HypertuneAdapter {
  let hypertune: HypertuneNode | undefined;
  let _initializePromise: Promise<void> | undefined;

  const initializeHypertune = async (): Promise<void> => {
    hypertune = create({
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

    _initializePromise = hypertune.initIfNeeded();
    await _initializePromise;
  };

  const getHypertune = async () => {
    await (_initializePromise ?? initializeHypertune());
    if (!hypertune) {
      throw new Error('Hypertune not initialized');
    }
    return hypertune;
  };

  // We can provide opinionated defaults for the default Hypertune settings,
  // Override by providing an entities object including `environment`
  function getEnvironment(): string {
    if (options.environment) {
      return options.environment;
    }
    if (process.env.VERCEL_ENV === 'production') {
      return 'production';
    }
    return process.env.NODE_ENV ?? 'development';
  }

  const getContext = (entities?: HypertuneEntities): HypertuneEntities => {
    const environment = getEnvironment();
    const context = {
      environment,
    };
    if (!entities) {
      return context;
    }
    if (typeof entities === 'object' && entities !== null) {
      return {
        ...context,
        ...entities,
      };
    }
    // If entities is not an object, we'll pass it along as-is
    return entities;
  };

  const adapter: HypertuneAdapter = {
    getHypertune,
    fn: (f) => {
      return {
        decide: async ({ key, entities }) => {
          const hypertune = await getHypertune();
          const rootNode = hypertune.getFieldNode('root', {
            fieldArguments: {
              context: getContext(entities),
            },
          });
          return f(rootNode);
        },
      };
    },
  };
}

let defaultHypertuneAdapter: HypertuneAdapter | undefined;

export function resetDefaultHypertuneAdapter() {
  defaultHypertuneAdapter = undefined;
}

export function createDefaultHypertuneAdapter(): HypertuneAdapter {
  if (defaultHypertuneAdapter) {
    return defaultHypertuneAdapter;
  }

  const hypertuneToken = process.env.HYPERTUNE_TOKEN as string;
  const edgeConfig = process.env.EDGE_CONFIG;
  const edgeConfigItemKey = process.env.EDGE_CONFIG_HYPERTUNE_ITEM_KEY;

  if (!(edgeConfig && edgeConfigItemKey)) {
    defaultHypertuneAdapter = createHypertuneAdapter({
      hypertuneToken,
    });
  } else {
    defaultHypertuneAdapter = createHypertuneAdapter({
      hypertuneToken,
      edgeConfig: {
        connectionString: edgeConfig,
        itemKey: edgeConfigItemKey,
      },
    });
  }

  return defaultHypertuneAdapter;
}

export const hypertuneAdapter: HypertuneAdapter = {
  fn: (f) => {
    return createDefaultHypertuneAdapter().fn(f);
  },
  getHypertune: () => {
    return createDefaultHypertuneAdapter().getHypertune();
  },
};
