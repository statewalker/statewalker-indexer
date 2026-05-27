export async function* toAsyncIterable<T>(
  source: Iterable<T> | AsyncIterable<T>,
): AsyncGenerator<T> {
  if (Symbol.asyncIterator in source) {
    yield* source as AsyncIterable<T>;
  } else {
    yield* source as Iterable<T>;
  }
}
