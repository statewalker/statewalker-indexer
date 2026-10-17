import { grep, newNgramAccess } from "@statewalker/indexer-ngram";
import { runNgramConformanceSuite } from "@statewalker/indexer-tests";
import { describe, expect, it } from "vitest";
import { createSqliteIndexer, newSqliteNgramProvider } from "../src/index.js";
import { flavours, indexerFactory } from "./support/dbs.js";

for (const flavour of flavours) {
  const factory = indexerFactory(flavour, () => [newSqliteNgramProvider()]);
  for (const store of ["fts5", "postings"] as const) {
    runNgramConformanceSuite(`SQLite n-gram ${store} (${flavour.name})`, {
      factory,
      config: { type: "ngram", store },
    });
  }

  describe(`SQLite n-gram (${flavour.name}) — specifics`, () => {
    it("defaults to the fts5 store and survives a reopen", async () => {
      const db = await flavour.open();
      const first = await createSqliteIndexer({ db, providers: [newSqliteNgramProvider()] });
      const index = await first.createIndex({ name: "t", subIndexes: { g: { type: "ngram" } } });
      expect(await newNgramAccess("g").get(index).getIndexInfo()).toEqual({ store: "fts5" });
      await newNgramAccess("g")
        .get(index)
        .addDocument([{ path: "/d", blockId: "1", content: "needle" }]);
      await first.close();
      const again = await createSqliteIndexer({ db, providers: [newSqliteNgramProvider()] });
      const reopened = await again.getIndex("t");
      expect(
        (await grep(reopened as NonNullable<typeof reopened>, "g", "needle")).hits.map(
          (h) => h.blockId,
        ),
      ).toEqual(["1"]);
    });

    it("ingests a call larger than one upsert batch", async () => {
      const indexer = await factory.create();
      const index = await indexer.createIndex({ name: "t", subIndexes: { g: { type: "ngram" } } });
      const sub = newNgramAccess("g").get(index);
      const blocks = Array.from({ length: 1201 }, (_, i) => ({
        path: "/big" as const,
        blockId: String(i),
        content: `line ${i}`,
      }));
      await sub.addDocument(blocks);
      expect(await sub.getSize()).toBe(1201);
      expect((await grep(index, "g", "line 1200")).hits.map((h) => h.blockId)).toEqual(["1200"]);
    });
  });
}
