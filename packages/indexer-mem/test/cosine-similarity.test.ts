import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "../src/vector-search.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical unit vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it("returns 0 when either vector is zero", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
    expect(cosineSimilarity(b, a)).toBe(0);
  });

  it("throws when dimensionalities differ", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0]);
    expect(() => cosineSimilarity(a, b)).toThrow(/dim/i);
    expect(() => cosineSimilarity(b, a)).toThrow(/dim/i);
  });
});
