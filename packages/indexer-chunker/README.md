# @statewalker/indexer-chunker

Markdown-aware chunking utilities. Splits long documents into bounded-size chunks suitable for embedding and full-text indexing, preserving code-fence boundaries and Markdown block structure.

## Installation

```sh
pnpm add @statewalker/indexer-chunker
```

## Usage

```ts
import { chunkMarkdown } from "@statewalker/indexer-chunker";

const chunks = chunkMarkdown(text, { targetChars: 2000, overlapChars: 200 });
for (const { index, text: body, startChar, endChar } of chunks) {
  // feed each chunk into the indexer as a separate block
}
```

## API

- `chunkMarkdown(text, options)` — returns `Chunk[]`. `options.targetChars` is the soft size limit; the chunker picks the best cut within a configurable tolerance around each boundary, preferring paragraph / heading breaks over mid-sentence cuts.
- `scanBreakPoints(text)` — returns `BreakPoint[]` (paragraph, heading, list-item, code-fence boundaries) for custom chunking strategies.
- `findBestCutoff(breakPoints, target, tolerance)` — picks the break point closest to `target` within `tolerance`, or falls back to a char-count cut.
- `findCodeFences(text)` / `isInsideCodeFence(offset, fences)` — Markdown code-fence detection; used internally but exported for callers that need to avoid splitting inside a fenced block.

Types: `Chunk`, `ChunkOptions`, `BreakPoint`, `CodeFence`.

## Related

- `@statewalker/indexer-api` — the indexer contract that typically consumes chunker output.
