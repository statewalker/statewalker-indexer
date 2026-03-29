import { expect } from "vitest";

/** Assert a value is not null/undefined and return it with narrowed type. */
export function defined<T>(
  value: T | null | undefined,
  msg = "expected value to be defined",
): T {
  expect(value, msg).toBeDefined();
  expect(value, msg).not.toBeNull();
  return value as T;
}

/** Collect all results from an async generator into an array. */
export async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const r of gen) results.push(r);
  return results;
}
