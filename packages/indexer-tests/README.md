# @statewalker/indexer-tests

> Internal, workspace-only dev dependency. **Not published**.

Shared Vitest suite that every `@statewalker/indexer-*` implementation runs against. Keeps behavior consistent across backends.

## Usage

In another indexer package's `test/suite.test.ts`:

```ts
import { runIndexerSuite } from "@statewalker/indexer-tests";
import { createFlexsearchIndex } from "@statewalker/indexer-mem-flexsearch";

runIndexerSuite(createFlexsearchIndex);
```

## Related

- `@statewalker/indexer-api` — contract these tests enforce.
