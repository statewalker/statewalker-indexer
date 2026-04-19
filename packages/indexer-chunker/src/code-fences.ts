import type { CodeFence } from "./types.js";

/**
 * Find all code fence regions (``` delimited) in the text.
 * Returns pairs of {start, end} character positions.
 * An unclosed fence extends to the end of the text.
 */
export function findCodeFences(text: string): CodeFence[] {
  const fences: CodeFence[] = [];
  const lines = text.split("\n");
  let pos = 0;
  let openStart: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (openStart === null) {
        openStart = pos;
      } else {
        fences.push({ start: openStart, end: pos });
        openStart = null;
      }
    }
    pos += line.length + 1;
  }

  // Unclosed fence extends to end
  if (openStart !== null) {
    fences.push({ start: openStart, end: text.length });
  }

  return fences;
}

/**
 * Check whether a character position falls inside any code fence region.
 */
export function isInsideCodeFence(fences: CodeFence[], position: number): boolean {
  for (const fence of fences) {
    if (position >= fence.start && position <= fence.end) {
      return true;
    }
  }
  return false;
}
