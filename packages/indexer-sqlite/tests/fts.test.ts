import type { DocumentPath } from "@statewalker/indexer-api";
import { type FullTextProvider, newFullTextAccess } from "@statewalker/indexer-fulltext";
import {
  collect,
  runFullTextConformanceSuite,
  runFullTextMultiWordSuite,
  runRrfBlendingSuite,
} from "@statewalker/indexer-tests";
import { describe, expect, it } from "vitest";
import { createSqliteIndexer, newSqliteFullTextProvider } from "../src/index.js";
import { asModalityProvider } from "./support/as-modality-provider.js";
import { flavours, indexerFactory } from "./support/dbs.js";

const ftConfig = { type: "fulltext" as const, language: "en" };
const ft = newFullTextAccess("q");

for (const flavour of flavours) {
  const label = `SQLite FTS5 (${flavour.name})`;
  const factory = indexerFactory(flavour, () => [newSqliteFullTextProvider()]);

  runFullTextConformanceSuite(
    label,
    asModalityProvider(newSqliteFullTextProvider(), flavour.open) as FullTextProvider,
    { config: { language: "en" } },
  );
  runFullTextMultiWordSuite(label, { factory, config: ftConfig });
  runRrfBlendingSuite(label, {
    factory,
    config: ftConfig,
    populate: async (index) => {
      const sub = ft.get(index);
      await sub.addDocument([{ path: "/d/a", blockId: "a", content: "alpha alpha alpha" }]);
      await sub.addDocument([{ path: "/d/b", blockId: "b", content: "alpha beta" }]);
      await sub.addDocument([{ path: "/d/c", blockId: "c", content: "alpha gamma" }]);
    },
    buildQuery: ({ topK }) => ({ queries: ["alpha"], ...(topK !== undefined ? { topK } : {}) }),
  });

  describe(`${label} — SQLite specifics`, () => {
    async function open(language = "en") {
      const db = await flavour.open();
      const indexer = await createSqliteIndexer({ db, providers: [newSqliteFullTextProvider()] });
      const index = await indexer.createIndex({
        name: "t",
        subIndexes: { q: { type: "fulltext", language } },
      });
      return { db, indexer, index, sub: ft.get(index) };
    }
    const search = async (
      sub: ReturnType<typeof ft.get>,
      queries: string[],
      paths?: DocumentPath[],
    ) => collect(sub.search({ queries, ...(paths ? { paths } : {}) }));

    it("stems English with porter and folds diacritics", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "Running café" }]);
      expect((await search(sub, ["run"])).map((h) => h.blockId)).toEqual(["b"]);
      expect((await search(sub, ["cafe"])).map((h) => h.blockId)).toEqual(["b"]);
    });

    it("opens an unknown language with unicode61 instead of throwing", async () => {
      const { sub } = await open("xx");
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "Running" }]);
      expect((await search(sub, ["running"])).map((h) => h.blockId)).toEqual(["b"]);
      expect(await search(sub, ["run"])).toEqual([]);
    });

    it("treats FTS5 syntax in queries as words, never as a syntax error", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "and or near foo" }]);
      for (const q of ['"', "AND", "foo*", "NEAR(foo", "-foo", "?!", ""]) {
        await expect(search(sub, [q])).resolves.toBeDefined();
      }
      expect((await search(sub, ["AND"])).map((h) => h.blockId)).toEqual(["b"]);
    });

    it("re-adding a block replaces its content", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "alpha" }]);
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "beta" }]);
      expect(await sub.getSize()).toBe(1);
      expect(await search(sub, ["alpha"])).toEqual([]);
      expect((await search(sub, ["beta"])).map((h) => h.blockId)).toEqual(["b"]);
    });

    it("scopes by path prefix, case-sensitively and on component boundaries", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/docs/a", blockId: "1", content: "alpha" }]);
      await sub.addDocument([{ path: "/Docs/b", blockId: "2", content: "alpha" }]);
      await sub.addDocument([{ path: "/docsx/c", blockId: "3", content: "alpha" }]);
      expect((await search(sub, ["alpha"], ["/docs"])).map((h) => h.blockId)).toEqual(["1"]);
    });

    it("returns a snippet and a positive score", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "the quick brown fox" }]);
      const [hit] = await search(sub, ["fox"]);
      expect(hit?.snippet).toContain("fox");
      expect(hit?.score).toBeGreaterThan(0);
    });

    it("keeps metadata and returns it from getDocumentsBlocks", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "x", metadata: { k: 1 } }]);
      expect(await collect(sub.getDocumentsBlocks())).toEqual([
        { path: "/d/1", blockId: "b", content: "x", metadata: { k: 1 } },
      ]);
    });

    it("a new indexer on the same Db searches the old data", async () => {
      const { db, indexer, sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "persisted words" }]);
      await indexer.close();
      const again = await createSqliteIndexer({ db, providers: [newSqliteFullTextProvider()] });
      const index = await again.getIndex("t");
      expect(
        (await search(ft.get(index as NonNullable<typeof index>), ["persisted"])).map(
          (h) => h.blockId,
        ),
      ).toEqual(["b"]);
    });
  });
}
