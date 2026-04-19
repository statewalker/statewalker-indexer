# @statewalker/indexer-chunker

Text chunking utilities used to prepare documents before indexing.

## Installation

```sh
pnpm add @statewalker/indexer-chunker
```

## Usage

```ts
import { chunkByTokens } from "@statewalker/indexer-chunker";

for (const chunk of chunkByTokens(text, { maxTokens: 512, overlap: 64 })) {
  // …
}
```

## API

- `chunkByTokens` — token-budget windowed chunking with optional overlap.
- `chunkByParagraph` — soft boundaries on paragraph breaks.

## Related

- `@statewalker/indexer-api` — contract chunker output is typically fed into.
