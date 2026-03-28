import { describe, expect, it } from "vitest";
import { chunkMarkdown, findBestCutoff } from "../src/chunk-markdown.js";
import type { BreakPoint, CodeFence } from "../src/types.js";

describe("findBestCutoff", () => {
  it("prefers heading near target over newline at target", () => {
    // Heading at position 100, newline at position 120, target at 120
    const breakPoints: BreakPoint[] = [
      { position: 100, score: 90 }, // H2
      { position: 120, score: 1 }, // plain newline
    ];
    const fences: CodeFence[] = [];
    const result = findBestCutoff(breakPoints, fences, 120, 50);
    // The heading should win because its base score is much higher
    expect(result).toBe(100);
  });

  it("skips break points inside code fences", () => {
    const breakPoints: BreakPoint[] = [
      { position: 50, score: 90 }, // inside fence
      { position: 150, score: 20 }, // outside fence
    ];
    const fences: CodeFence[] = [{ start: 40, end: 80 }];
    const result = findBestCutoff(breakPoints, fences, 160, 200);
    expect(result).toBe(150);
  });

  it("returns -1 when no valid break points in window", () => {
    const breakPoints: BreakPoint[] = [{ position: 500, score: 90 }];
    const fences: CodeFence[] = [];
    const result = findBestCutoff(breakPoints, fences, 100, 50);
    expect(result).toBe(-1);
  });
});

describe("chunkMarkdown", () => {
  it("returns empty array for empty string", () => {
    const chunks = chunkMarkdown("", { targetChars: 100 });
    expect(chunks).toEqual([]);
  });

  it("returns single chunk for short text", () => {
    const text = "# Hello\n\nShort text.";
    const chunks = chunkMarkdown(text, { targetChars: 1000 });
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.content).toBe(text);
    expect(chunks[0]?.index).toBe(0);
  });

  it("splits at heading boundaries", () => {
    const section1 =
      "# Section 1\n\nContent of section one with enough text to fill a chunk.";
    const section2 =
      "# Section 2\n\nContent of section two with enough text to fill a chunk.";
    const text = `${section1}\n\n${section2}`;
    const chunks = chunkMarkdown(text, {
      targetChars: 70,
      overlap: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk should start with section 1 heading
    expect(chunks[0]?.content).toContain("# Section 1");
    // Some chunk should contain section 2 heading
    const hasSection2 = chunks.some((c) => c.content.includes("# Section 2"));
    expect(hasSection2).toBe(true);
  });

  it("never splits inside code fences", () => {
    const code = "x = 1\n".repeat(30); // long code block
    const text = `# Intro\n\nSome text.\n\n\`\`\`python\n${code}\`\`\`\n\n# After`;
    const chunks = chunkMarkdown(text, {
      targetChars: 50,
      overlap: 0,
    });
    // Find the fence region in the original text
    const fenceOpen = text.indexOf("```python");
    const fenceClose = text.indexOf("```\n\n# After");
    // No chunk boundary (endPos) should fall strictly inside the code fence
    for (const chunk of chunks) {
      if (chunk.endPos > fenceOpen && chunk.endPos < fenceClose) {
        // This would mean we split inside a code fence - should not happen
        expect.unreachable(
          `Chunk ${chunk.index} endPos=${chunk.endPos} is inside code fence [${fenceOpen}, ${fenceClose}]`,
        );
      }
    }
  });

  it("overlap contains text from previous chunk", () => {
    const text = `# A\n\n${"word ".repeat(100)}\n\n# B\n\n${"word ".repeat(100)}`;
    const chunks = chunkMarkdown(text, {
      targetChars: 200,
      overlap: 30,
    });
    if (chunks.length >= 2) {
      const prevEnd = chunks[0]?.content ?? "";
      const nextStart = chunks[1]?.content ?? "";
      // The start of the next chunk should overlap with the end of the previous
      const overlapText = prevEnd.slice(-30);
      expect(nextStart).toContain(overlapText.trim());
    }
  });

  it("chunk indices are sequential", () => {
    const text = "# Section\n\nSome paragraph text here.\n\n".repeat(10);
    const chunks = chunkMarkdown(text, {
      targetChars: 50,
      overlap: 0,
    });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]?.index).toBe(i);
    }
  });

  it("startPos/endPos cover full text", () => {
    const text =
      "# Title\n\nParagraph one.\n\n## Sub\n\nParagraph two.\n\n### Deep\n\nMore text.";
    const chunks = chunkMarkdown(text, {
      targetChars: 30,
      overlap: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]?.startPos).toBe(0);
    expect(chunks[chunks.length - 1]?.endPos).toBe(text.length);
  });
});
