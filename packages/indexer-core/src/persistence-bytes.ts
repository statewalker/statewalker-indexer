import type { PersistenceEntry } from "@statewalker/indexer-api";

export function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function singleChunk(data: Uint8Array): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      yield data;
    },
  };
}

export async function readEntryBytes(entry: PersistenceEntry): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of entry.content) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
