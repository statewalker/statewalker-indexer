import { describe, expect, it } from "vitest";
import { scanBreakPoints } from "../src/break-points.js";

describe("scanBreakPoints", () => {
  it("returns empty array for empty string", () => {
    expect(scanBreakPoints("")).toEqual([]);
  });

  it("detects H1 with score 100", () => {
    const points = scanBreakPoints("# Hello");
    expect(points).toEqual([{ position: 0, score: 100 }]);
  });

  it("detects H2 with score 90", () => {
    const points = scanBreakPoints("## Hello");
    expect(points).toEqual([{ position: 0, score: 90 }]);
  });

  it("detects H3 with score 80", () => {
    const points = scanBreakPoints("### Hello");
    expect(points).toEqual([{ position: 0, score: 80 }]);
  });

  it("detects H4 with score 70", () => {
    const points = scanBreakPoints("#### Hello");
    expect(points).toEqual([{ position: 0, score: 70 }]);
  });

  it("detects H5 with score 60", () => {
    const points = scanBreakPoints("##### Hello");
    expect(points).toEqual([{ position: 0, score: 60 }]);
  });

  it("detects H6 with score 50", () => {
    const points = scanBreakPoints("###### Hello");
    expect(points).toEqual([{ position: 0, score: 50 }]);
  });

  it("detects blank lines (paragraph breaks) with score 20", () => {
    const text = "Hello\n\nWorld";
    const points = scanBreakPoints(text);
    const blankLine = points.find((p) => p.score === 20);
    expect(blankLine).toBeDefined();
    // The blank line starts at position of the second \n
    expect(blankLine?.position).toBe(6);
  });

  it("detects horizontal rules with score 60", () => {
    for (const rule of ["---", "***", "___"]) {
      const text = `Hello\n${rule}\nWorld`;
      const points = scanBreakPoints(text);
      const hr = points.find((p) => p.score === 60);
      expect(hr).toBeDefined();
      expect(hr?.position).toBe(6);
    }
  });

  it("detects list items with score 5", () => {
    const text = "Hello\n- item one\n* item two\n1. item three";
    const points = scanBreakPoints(text);
    const listItems = points.filter((p) => p.score === 5);
    expect(listItems.length).toBe(3);
  });

  it("detects plain newlines with score 1", () => {
    const text = "line one\nline two";
    const points = scanBreakPoints(text);
    const newlines = points.filter((p) => p.score === 1);
    expect(newlines.length).toBeGreaterThanOrEqual(1);
  });

  it("handles multiple break point types in one document", () => {
    const text = [
      "# Title",
      "",
      "Some text",
      "",
      "## Section",
      "",
      "- item",
      "- item 2",
      "",
      "---",
      "",
      "### Sub",
    ].join("\n");
    const points = scanBreakPoints(text);

    const scores = new Set(points.map((p) => p.score));
    // Should contain heading scores, blank line, list item, hr, newline
    expect(scores.has(100)).toBe(true); // H1
    expect(scores.has(90)).toBe(true); // H2
    expect(scores.has(80)).toBe(true); // H3
    expect(scores.has(60)).toBe(true); // HR
    expect(scores.has(20)).toBe(true); // blank line
    expect(scores.has(5)).toBe(true); // list item
  });

  it("detects code block boundaries with score 80", () => {
    const text = "Hello\n```js\ncode\n```\nWorld";
    const points = scanBreakPoints(text);
    const codeBlocks = points.filter((p) => p.score === 80);
    expect(codeBlocks.length).toBe(2);
  });
});
