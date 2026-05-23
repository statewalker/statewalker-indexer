import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // PGlite WASM startup is several seconds per fresh indexer; the suite
    // exercises ~90 fresh PGlite instances sequentially. Headroom for the
    // beforeEach hooks that build them.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
