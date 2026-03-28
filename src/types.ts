export interface BreakPoint {
  position: number;
  score: number;
}

export interface CodeFence {
  start: number;
  end: number;
}

export interface ChunkOptions {
  /** Target size for each chunk in characters */
  targetChars: number;
  /** Number of overlap characters between consecutive chunks (default: 0) */
  overlap?: number;
  /** Search window multiplier relative to targetChars (default: 0.5) */
  windowFraction?: number;
  /** Decay factor for distance penalty (default: 0.5) */
  decayFactor?: number;
}

export interface Chunk {
  /** Sequential index of this chunk (0-based) */
  index: number;
  /** The chunk text content */
  content: string;
  /** Start position in the original text (inclusive) */
  startPos: number;
  /** End position in the original text (exclusive) */
  endPos: number;
}
