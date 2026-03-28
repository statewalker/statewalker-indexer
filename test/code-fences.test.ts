import { describe, expect, it } from "vitest";
import { findCodeFences, isInsideCodeFence } from "../src/code-fences.js";

describe("findCodeFences", () => {
  it("finds a single fence pair", () => {
    const text = "Hello\n```js\ncode here\n```\nWorld";
    const fences = findCodeFences(text);
    expect(fences.length).toBe(1);
    expect(fences[0]?.start).toBe(6); // position of opening ```
    expect(fences[0]?.end).toBe(22); // position of closing ```
  });

  it("finds multiple fence pairs", () => {
    const text = "A\n```\nblock1\n```\nB\n```\nblock2\n```\nC";
    const fences = findCodeFences(text);
    expect(fences.length).toBe(2);
  });

  it("handles unclosed fence extending to end", () => {
    const text = "Hello\n```\ncode without close";
    const fences = findCodeFences(text);
    expect(fences.length).toBe(1);
    expect(fences[0]?.start).toBe(6);
    expect(fences[0]?.end).toBe(text.length);
  });

  it("returns empty array when no fences", () => {
    const fences = findCodeFences("Just plain text\nno fences here");
    expect(fences).toEqual([]);
  });
});

describe("isInsideCodeFence", () => {
  it("returns true for position inside a fence", () => {
    const fences = [{ start: 10, end: 30 }];
    expect(isInsideCodeFence(fences, 15)).toBe(true);
    expect(isInsideCodeFence(fences, 10)).toBe(true);
    expect(isInsideCodeFence(fences, 30)).toBe(true);
  });

  it("returns false for position outside a fence", () => {
    const fences = [{ start: 10, end: 30 }];
    expect(isInsideCodeFence(fences, 5)).toBe(false);
    expect(isInsideCodeFence(fences, 35)).toBe(false);
  });

  it("returns false for empty fences array", () => {
    expect(isInsideCodeFence([], 10)).toBe(false);
  });
});
