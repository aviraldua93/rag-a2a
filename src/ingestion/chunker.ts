import type { RawDocument } from './loader.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A chunk of text extracted from a parent document. */
export interface TextChunk {
  /** Composite ID: `${documentId}-${chunkIndex}`. */
  id: string;
  /** The text content of this chunk. */
  content: string;
  /** ID of the parent {@link RawDocument}. */
  documentId: string;
  metadata: {
    /** File path of the source document. */
    source: string;
    /** Zero-based chunk position within the document. */
    chunkIndex: number;
    /** Start character offset (inclusive) in the original content. */
    startChar: number;
    /** End character offset (exclusive) in the original content. */
    endChar: number;
    /** Strategy used to produce this chunk. */
    strategy: string;
  };
}

/** Available chunking strategies. */
export type ChunkStrategy = 'sliding-window' | 'semantic' | 'recursive';

/** Configuration for the chunker. */
export interface ChunkerOptions {
  strategy: ChunkStrategy;
  /** Target chunk size in **characters**. */
  chunkSize: number;
  /** Overlap between consecutive chunks in **characters**. */
  chunkOverlap: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Split a {@link RawDocument} into {@link TextChunk}s using the chosen
 * strategy.
 *
 * Edge cases handled:
 * - Empty documents → returns an empty array.
 * - Documents shorter than `chunkSize` → returns a single chunk.
 */
export function chunkDocument(doc: RawDocument, options: ChunkerOptions): TextChunk[] {
  const text = doc.content;
  if (!text || text.trim().length === 0) return [];

  let spans: Span[];
  switch (options.strategy) {
    case 'sliding-window':
      spans = slidingWindow(text, options.chunkSize, options.chunkOverlap);
      break;
    case 'semantic':
      spans = semanticChunk(text, options.chunkSize);
      break;
    case 'recursive':
      spans = recursiveChunk(text, options.chunkSize, options.chunkOverlap);
      break;
    default:
      throw new Error(`Unknown chunk strategy: ${options.strategy as string}`);
  }

  return spans.map((span, idx) => ({
    id: `${doc.id}-${idx}`,
    content: text.slice(span.start, span.end),
    documentId: doc.id,
    metadata: {
      source: doc.metadata.source,
      chunkIndex: idx,
      startChar: span.start,
      endChar: span.end,
      strategy: options.strategy,
    },
  }));
}

// ---------------------------------------------------------------------------
// Internal: span representation
// ---------------------------------------------------------------------------

interface Span {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Strategy: sliding-window
// ---------------------------------------------------------------------------

/**
 * Fixed-size chunks that advance by `chunkSize - chunkOverlap` characters.
 */
function slidingWindow(text: string, chunkSize: number, chunkOverlap: number): Span[] {
  const spans: Span[] = [];
  const step = Math.max(1, chunkSize - chunkOverlap);
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    spans.push({ start, end });
    if (end === text.length) break;
    start += step;
  }

  return spans;
}

// ---------------------------------------------------------------------------
// Strategy: semantic
// ---------------------------------------------------------------------------

/**
 * Split on double-newlines (paragraph boundaries), then greedily merge
 * consecutive paragraphs as long as the merged text fits within
 * `chunkSize`.  This preserves semantic coherence.
 */
function semanticChunk(text: string, chunkSize: number): Span[] {
  // Identify paragraph boundaries (double newline).
  const paragraphs = splitKeepingOffsets(text, /\n\n+/g);

  if (paragraphs.length === 0) {
    // No paragraph breaks – fall back to a single chunk.
    return [{ start: 0, end: text.length }];
  }

  const spans: Span[] = [];
  let mergedStart = paragraphs[0].start;
  let mergedEnd = paragraphs[0].end;

  for (let i = 1; i < paragraphs.length; i++) {
    const candidateEnd = paragraphs[i].end;
    const mergedLen = candidateEnd - mergedStart;

    if (mergedLen <= chunkSize) {
      // Still fits – extend the current chunk.
      mergedEnd = candidateEnd;
    } else {
      // Flush the current chunk and start a new one.
      spans.push({ start: mergedStart, end: mergedEnd });
      mergedStart = paragraphs[i].start;
      mergedEnd = paragraphs[i].end;
    }
  }

  // Flush remaining text.
  spans.push({ start: mergedStart, end: mergedEnd });
  return spans;
}

/**
 * Split text on a regex pattern but return the **spans** (character
 * offsets) of the pieces between the separators.
 */
function splitKeepingOffsets(text: string, pattern: RegExp): Span[] {
  const spans: Span[] = [];
  let lastEnd = 0;

  for (const match of text.matchAll(pattern)) {
    const matchStart = match.index!;
    if (matchStart > lastEnd) {
      spans.push({ start: lastEnd, end: matchStart });
    }
    lastEnd = matchStart + match[0].length;
  }

  if (lastEnd < text.length) {
    spans.push({ start: lastEnd, end: text.length });
  }

  return spans;
}

// ---------------------------------------------------------------------------
// Strategy: recursive (LangChain-style)
// ---------------------------------------------------------------------------

/** Ordered list of separators to attempt, from coarsest to finest. */
const RECURSIVE_SEPARATORS = ['\n\n', '\n', '. ', ' '];

/**
 * Recursively split text: try the coarsest separator first; if any
 * resulting piece is still larger than `chunkSize`, recurse with the
 * next finer separator.  Finally, hard-split on character boundaries
 * if nothing else works.
 */
function recursiveChunk(text: string, chunkSize: number, chunkOverlap: number): Span[] {
  const absoluteSpans: Span[] = [];
  recursiveSplit(text, 0, chunkSize, chunkOverlap, 0, absoluteSpans);
  return absoluteSpans;
}

function recursiveSplit(
  text: string,
  baseOffset: number,
  chunkSize: number,
  chunkOverlap: number,
  sepIdx: number,
  out: Span[],
): void {
  // Base case: text fits in a single chunk.
  if (text.length <= chunkSize) {
    if (text.length > 0) {
      out.push({ start: baseOffset, end: baseOffset + text.length });
    }
    return;
  }

  // Try each separator from coarsest to finest.
  if (sepIdx < RECURSIVE_SEPARATORS.length) {
    const sep = RECURSIVE_SEPARATORS[sepIdx];
    const pieces = text.split(sep);

    if (pieces.length <= 1) {
      // Separator not found – try the next one.
      recursiveSplit(text, baseOffset, chunkSize, chunkOverlap, sepIdx + 1, out);
      return;
    }

    // Greedily merge adjacent pieces up to chunkSize, then recurse on
    // any merged piece that is still too large.
    let current = '';
    let currentStart = 0; // offset within `text`
    let pos = 0; // running offset within `text`

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const candidate = current.length === 0 ? piece : current + sep + piece;

      if (candidate.length <= chunkSize) {
        if (current.length === 0) currentStart = pos;
        current = candidate;
      } else {
        // Flush what we have (if anything)
        if (current.length > 0) {
          recursiveSplit(current, baseOffset + currentStart, chunkSize, chunkOverlap, sepIdx + 1, out);
        }
        // Start fresh with the current piece
        currentStart = pos;
        current = piece;
      }

      // Advance pos past this piece (and the separator that followed it).
      pos += piece.length;
      if (i < pieces.length - 1) pos += sep.length;
    }

    // Flush remainder.
    if (current.length > 0) {
      recursiveSplit(current, baseOffset + currentStart, chunkSize, chunkOverlap, sepIdx + 1, out);
    }
  } else {
    // No separators left — hard-split by character using sliding window.
    const spans = slidingWindow(text, chunkSize, chunkOverlap);
    for (const s of spans) {
      out.push({ start: baseOffset + s.start, end: baseOffset + s.end });
    }
  }
}
