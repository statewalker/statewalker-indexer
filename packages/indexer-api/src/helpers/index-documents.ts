import type { DocumentPath, Index, IndexedBlock } from "../indexer-index.js";
import type { EmbedFn } from "../semantic-index.js";

export async function indexDocuments(
  index: Index,
  docs:
    | Iterable<{ path: DocumentPath; blockId: string; content: string }>
    | AsyncIterable<{ path: DocumentPath; blockId: string; content: string }>,
  options?: { embedFn?: EmbedFn },
): Promise<{ indexed: number }> {
  const embedFn = options?.embedFn;
  let indexed = 0;

  for await (const doc of docs as AsyncIterable<{
    path: DocumentPath;
    blockId: string;
    content: string;
  }>) {
    const block: IndexedBlock = {
      path: doc.path,
      blockId: doc.blockId,
      content: doc.content,
    };
    if (embedFn) {
      block.embedding = await embedFn(doc.content);
    }
    await index.addDocument([block]);
    indexed++;
  }

  return { indexed };
}
