/**
 * Builds a per-instance serialising helper. Every call to `runExclusive(fn)`
 * queues behind the prior call's settled state, so concurrent mutating methods
 * on the same indexer instance run one after the other.
 *
 * The chain does NOT short-circuit on rejection — a failing operation still
 * releases the next one, so a transient error in one mutation doesn't poison
 * the rest.
 */
export function createSerialiser(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const result = chain.then(fn, fn);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
