/**
 * Markdown break-point detection with weighted scoring.
 *
 * Adapted from QMD (https://github.com/tobi/qmd) by Tobi Lutke.
 * MIT License — Copyright (c) 2024-2026 Tobi Lutke.
 * See: src/store.ts (scanBreakPoints)
 */

import type { BreakPoint } from "./types.js";

const HEADING_PATTERNS: Array<{ prefix: string; score: number }> = [
  { prefix: "###### ", score: 50 },
  { prefix: "##### ", score: 60 },
  { prefix: "#### ", score: 70 },
  { prefix: "### ", score: 80 },
  { prefix: "## ", score: 90 },
  { prefix: "# ", score: 100 },
];

const HR_REGEX = /^(---|___|\*\*\*)$/;
const LIST_REGEX = /^(\d+\.\s|[-*]\s)/;
const CODE_FENCE_REGEX = /^```/;

/**
 * Scan markdown text for structural break points, returning their
 * character positions and scores.
 */
export function scanBreakPoints(text: string): BreakPoint[] {
  if (text.length === 0) return [];

  const points: BreakPoint[] = [];
  const lines = text.split("\n");
  let pos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();

    // Check for blank line (paragraph break) — a blank line is the \n that
    // starts it. We detect it when we see an empty trimmed line and there
    // was a previous line.
    if (trimmed === "" && i > 0) {
      points.push({ position: pos, score: 20 });
      pos += line.length + 1; // +1 for the \n
      continue;
    }

    // Code fence boundary
    if (CODE_FENCE_REGEX.test(trimmed)) {
      points.push({ position: pos, score: 80 });
      pos += line.length + 1;
      continue;
    }

    // Horizontal rule
    if (HR_REGEX.test(trimmed)) {
      points.push({ position: pos, score: 60 });
      pos += line.length + 1;
      continue;
    }

    // Headings (check longest prefix first to avoid false matches)
    let matched = false;
    for (const { prefix, score } of HEADING_PATTERNS) {
      if (line.startsWith(prefix)) {
        points.push({ position: pos, score });
        matched = true;
        break;
      }
    }

    if (!matched) {
      // List items
      if (LIST_REGEX.test(trimmed)) {
        points.push({ position: pos, score: 5 });
      } else if (i > 0) {
        // Plain newline (the newline that ended the previous line)
        // We record it at the start of this line
        points.push({ position: pos, score: 1 });
      }
    }

    pos += line.length + 1; // +1 for the \n
  }

  return points;
}
