import type { Indexer } from "@statewalker/indexer-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

export interface AtomicityProbe {
  indexer: Indexer;
  /** Returns true if there is a manifest row for the given name. */
  hasManifestRow(name: string): Promise<boolean>;
  /** Returns true if at least one `idx_${prefix}_*` table exists for the sanitised prefix of the given index name. */
  hasResidualTables(indexName: string): Promise<boolean>;
  /** Arms the injected SqlDb to throw on the next matching exec/query. */
  injectFailureOnNext(matcher: (sql: string) => boolean, error?: Error): void;
  /** Clears any armed failure injection. */
  clearFailureInjection(): void;
  cleanup(): Promise<void>;
}

export interface AtomicityFactory {
  create(): Promise<AtomicityProbe>;
}

/**
 * Asserts that `createIndex` leaves the indexer in a consistent state on partial-failure.
 *
 * The probe injects a controlled failure mid-sequence; the assertions check that, after
 * the failure, neither the in-memory manifest nor any residual SQL tables expose the
 * partially-created index.
 */
export function runCreateIndexAtomicitySuite(name: string, factory: AtomicityFactory): void {
  describe(`${name} — createIndex atomicity`, () => {
    let probe: AtomicityProbe;

    beforeEach(async () => {
      probe = await factory.create();
    });

    afterEach(async () => {
      try {
        probe.clearFailureInjection();
        await probe.indexer.close();
      } catch {
        // probe may already be torn down
      }
      await probe.cleanup();
    });

    it("rolls back when the manifest INSERT fails after sub-indexes init", async () => {
      probe.injectFailureOnNext(
        (sql) => sql.includes("INSERT INTO __indexer_manifest"),
        new Error("injected: manifest insert failed"),
      );

      await expect(
        probe.indexer.createIndex({
          name: "atomicFailA",
          fulltext: { language: "en" },
        }),
      ).rejects.toThrow(/injected/);

      expect(await probe.indexer.hasIndex("atomicFailA")).toBe(false);
      expect((await probe.indexer.getIndexNames()).map((i) => i.name)).not.toContain("atomicFailA");
      expect(await probe.hasManifestRow("atomicFailA")).toBe(false);
      expect(await probe.hasResidualTables("atomicFailA")).toBe(false);
    });

    it("rolls back when an FTS DDL step fails", async () => {
      probe.injectFailureOnNext(
        (sql) => sql.includes("idx_atomicFailB_fts") && sql.toUpperCase().includes("CREATE"),
        new Error("injected: fts DDL failed"),
      );

      await expect(
        probe.indexer.createIndex({
          name: "atomicFailB",
          fulltext: { language: "en" },
        }),
      ).rejects.toThrow(/injected/);

      expect(await probe.indexer.hasIndex("atomicFailB")).toBe(false);
      expect(await probe.hasManifestRow("atomicFailB")).toBe(false);
      expect(await probe.hasResidualTables("atomicFailB")).toBe(false);
    });

    it("subsequent createIndex with the same name succeeds after a failure", async () => {
      probe.injectFailureOnNext(
        (sql) => sql.includes("INSERT INTO __indexer_manifest"),
        new Error("injected: first attempt"),
      );
      await expect(
        probe.indexer.createIndex({ name: "retryMe", fulltext: { language: "en" } }),
      ).rejects.toThrow(/injected/);

      probe.clearFailureInjection();
      const index = await probe.indexer.createIndex({
        name: "retryMe",
        fulltext: { language: "en" },
      });
      expect(index.name).toBe("retryMe");
      expect(await probe.indexer.hasIndex("retryMe")).toBe(true);
    });
  });
}
