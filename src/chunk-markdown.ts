import { scanBreakPoints } from "./break-points.js";
import { findCodeFences, isInsideCodeFence } from "./code-fences.js";
import type { BreakPoint, Chunk, ChunkOptions, CodeFence } from "./types.js";

/**
 * Find the best cutoff position near a target character position.
 * Uses a scoring formula that balances break point score with proximity:
 *   finalScore = baseScore * (1 - (distance/windowChars)^2 * decayFactor)
 *
 * Returns the position of the best break point, or -1 if none found.
 */
export function findBestCutoff(
  breakPoints: BreakPoint[],
  fences: CodeFence[],
  target: number,
  windowChars: number,
  decayFactor = 0.5,
): number {
  const windowStart = Math.max(0, target - windowChars);
  const windowEnd = target;

  let bestScore = -Infinity;
  let bestPosition = -1;

  for (const bp of breakPoints) {
    if (bp.position < windowStart || bp.position > windowEnd) continue;
    if (isInsideCodeFence(fences, bp.position)) continue;

    const distance = Math.abs(target - bp.position);
    const normalizedDist = windowChars > 0 ? distance / windowChars : 0;
    const finalScore =
      bp.score * (1 - normalizedDist * normalizedDist * decayFactor);

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestPosition = bp.position;
    }
  }

  return bestPosition;
}

/**
 * Split markdown text into overlapping chunks, preferring structural
 * boundaries (headings, horizontal rules, paragraph breaks) as split points.
 */
export function chunkMarkdown(text: string, options: ChunkOptions): Chunk[] {
  if (text.length === 0) return [];

  const {
    targetChars,
    overlap = 0,
    windowFraction = 0.5,
    decayFactor = 0.5,
  } = options;

  const breakPoints = scanBreakPoints(text);
  const fences = findCodeFences(text);
  const windowChars = Math.floor(targetChars * windowFraction);

  const chunks: Chunk[] = [];
  let startPos = 0;
  let index = 0;

  while (startPos < text.length) {
    const idealEnd = startPos + targetChars;

    // If remaining text fits in one chunk, take it all
    if (idealEnd >= text.length) {
      chunks.push({
        index,
        content: text.slice(startPos),
        startPos,
        endPos: text.length,
      });
      break;
    }

    // Find best cutoff near the ideal end
    let cutoff = findBestCutoff(
      breakPoints,
      fences,
      idealEnd,
      windowChars,
      decayFactor,
    );

    // If no good cutoff found, just cut at idealEnd
    if (cutoff === -1 || cutoff <= startPos) {
      cutoff = idealEnd;
    }

    // Never split inside a code fence — push cutoff past the fence end
    for (const fence of fences) {
      if (cutoff > fence.start && cutoff < fence.end) {
        cutoff = fence.end;
        break;
      }
    }

    chunks.push({
      index,
      content: text.slice(startPos, cutoff),
      startPos,
      endPos: cutoff,
    });

    // Next chunk starts at cutoff minus overlap
    const nextStart = Math.max(startPos + 1, cutoff - overlap);
    startPos = nextStart;
    index++;
  }

  return chunks;
}
