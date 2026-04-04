/**
 * Unit tests for the chunker module (src/ingestion/chunker.ts).
 *
 * Covers all 3 strategies (sliding-window, semantic, recursive) plus
 * edge cases: empty docs, whitespace-only, small docs, overlap >= chunkSize,
 * and metadata correctness.
 */
import { describe, test, expect } from 'bun:test';
import { chunkDocument, type TextChunk, type ChunkerOptions } from '../../src/ingestion/chunker.ts';
import { createRawDocument } from '../helpers/mocks.ts';
import {
  LONG_DOCUMENT_CONTENT,
  SHORT_DOCUMENT_CONTENT,
  EMPTY_DOCUMENT_CONTENT,
  SINGLE_PARAGRAPH_CONTENT,
} from '../helpers/fixtures.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a raw doc with the given content and optional id. */
function makeDoc(content: string, id = 'test-doc') {
  return createRawDocument({ id, content });
}

/** Validate that every chunk's content equals the original sliced at reported offsets. */
function assertOffsetsMatch(chunks: TextChunk[], originalContent: string) {
  for (const chunk of chunks) {
    const sliced = originalContent.slice(chunk.metadata.startChar, chunk.metadata.endChar);
    expect(chunk.content).toBe(sliced);
  }
}

// ---------------------------------------------------------------------------
// Sliding-window strategy
// ---------------------------------------------------------------------------

describe('Chunker – sliding-window', () => {
  const opts = (size: number, overlap: number): ChunkerOptions => ({
    strategy: 'sliding-window',
    chunkSize: size,
    chunkOverlap: overlap,
  });

  test('basic split: produces multiple chunks for long text', () => {
    const doc = makeDoc('A'.repeat(100));
    const chunks = chunkDocument(doc, opts(30, 10));
    // step = 30 - 10 = 20; ceil(100/20) ~= 5 but last chunk may be shorter
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(30);
    }
  });

  test('overlap correctness: consecutive chunks overlap by chunkOverlap chars', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'; // 26 chars
    const doc = makeDoc(text);
    const chunks = chunkDocument(doc, opts(10, 4));
    // step = 10 - 4 = 6
    for (let i = 1; i < chunks.length; i++) {
      const prevEnd = chunks[i - 1].metadata.endChar;
      const curStart = chunks[i].metadata.startChar;
      // Overlap region: previous chunk should extend beyond current chunk start
      const overlapLen = prevEnd - curStart;
      // The overlap should be equal to chunkOverlap unless it's the last window
      if (i < chunks.length - 1) {
        expect(overlapLen).toBe(4);
      } else {
        // Last chunk may have different overlap
        expect(overlapLen).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('single-chunk doc: content shorter than chunkSize returns one chunk', () => {
    const doc = makeDoc('short');
    const chunks = chunkDocument(doc, opts(100, 20));
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe('short');
  });

  test('empty doc: returns empty array', () => {
    const doc = makeDoc('');
    const chunks = chunkDocument(doc, opts(100, 20));
    expect(chunks.length).toBe(0);
  });

  test('whitespace-only doc: returns empty array', () => {
    const doc = makeDoc('   \n\n   \t  ');
    const chunks = chunkDocument(doc, opts(50, 10));
    expect(chunks.length).toBe(0);
  });

  test('chunkOverlap >= chunkSize: step clamped to 1 (no infinite loop)', () => {
    const doc = makeDoc('abcdefghij'); // 10 chars
    const chunks = chunkDocument(doc, opts(5, 5));
    // step = max(1, 5-5) = 1; should produce many overlapping chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Each chunk should be at most 5 chars
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(5);
    }
  });

  test('chunk offsets cover the entire document without gaps', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const doc = makeDoc(text);
    const chunks = chunkDocument(doc, opts(15, 5));
    // First chunk starts at 0
    expect(chunks[0].metadata.startChar).toBe(0);
    // Last chunk ends at text.length
    expect(chunks[chunks.length - 1].metadata.endChar).toBe(text.length);
    assertOffsetsMatch(chunks, text);
  });
});

// ---------------------------------------------------------------------------
// Semantic strategy
// ---------------------------------------------------------------------------

describe('Chunker – semantic', () => {
  const opts = (size: number): ChunkerOptions => ({
    strategy: 'semantic',
    chunkSize: size,
    chunkOverlap: 0, // semantic ignores overlap
  });

  test('paragraph merging: merges small paragraphs up to chunkSize', () => {
    const text = 'Para one.\n\nPara two.\n\nPara three.';
    const doc = makeDoc(text);
    // All paragraphs fit in a 200-char chunk
    const chunks = chunkDocument(doc, opts(200));
    expect(chunks.length).toBe(1);
    // The merged content should span from first paragraph to last
    expect(chunks[0].content).toContain('Para one.');
    expect(chunks[0].content).toContain('Para three.');
  });

  test('paragraph splitting: large paragraphs produce separate chunks', () => {
    const doc = makeDoc(LONG_DOCUMENT_CONTENT);
    const chunks = chunkDocument(doc, opts(200));
    expect(chunks.length).toBeGreaterThan(1);
    assertOffsetsMatch(chunks, LONG_DOCUMENT_CONTENT);
  });

  test('no paragraph breaks: entire text becomes one chunk', () => {
    const doc = makeDoc(SINGLE_PARAGRAPH_CONTENT);
    const chunks = chunkDocument(doc, opts(100));
    // No \n\n in the text, so semantic falls back to a single chunk
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe(SINGLE_PARAGRAPH_CONTENT);
  });

  test('large individual paragraphs: each becomes its own chunk', () => {
    const para1 = 'A'.repeat(100);
    const para2 = 'B'.repeat(100);
    const text = `${para1}\n\n${para2}`;
    const doc = makeDoc(text);
    const chunks = chunkDocument(doc, opts(120));
    expect(chunks.length).toBe(2);
    expect(chunks[0].content).toBe(para1);
    expect(chunks[1].content).toBe(para2);
    assertOffsetsMatch(chunks, text);
  });

  test('content shorter than chunkSize with paragraph breaks: single chunk', () => {
    const text = 'Hello.\n\nWorld.';
    const doc = makeDoc(text);
    const chunks = chunkDocument(doc, opts(500));
    expect(chunks.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Recursive strategy
// ---------------------------------------------------------------------------

describe('Chunker – recursive', () => {
  const opts = (size: number, overlap: number): ChunkerOptions => ({
    strategy: 'recursive',
    chunkSize: size,
    chunkOverlap: overlap,
  });

  test('separator fallback: uses paragraph then newline separators', () => {
    const text = 'Line one.\nLine two.\nLine three.\nLine four.';
    const doc = makeDoc(text);
    const chunks = chunkDocument(doc, opts(25, 0));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    assertOffsetsMatch(chunks, text);
  });

  test('hard-split: falls through to char-level sliding window when no separator helps', () => {
    // A single long word with no separators
    const text = 'a'.repeat(100);
    const doc = makeDoc(text);
    const chunks = chunkDocument(doc, opts(30, 5));
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(30);
    }
    assertOffsetsMatch(chunks, text);
  });

  test('nested recursion: paragraph split then sentence split', () => {
    const doc = makeDoc(LONG_DOCUMENT_CONTENT);
    const chunks = chunkDocument(doc, opts(200, 0));
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be within size limit
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(200);
    }
    assertOffsetsMatch(chunks, LONG_DOCUMENT_CONTENT);
  });

  test('small text that fits in one chunk', () => {
    const doc = makeDoc('tiny text');
    const chunks = chunkDocument(doc, opts(100, 10));
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe('tiny text');
  });
});

// ---------------------------------------------------------------------------
// Metadata correctness
// ---------------------------------------------------------------------------

describe('Chunker – metadata', () => {
  test('id format: ${documentId}-${chunkIndex}', () => {
    const doc = makeDoc('Some longer content that will produce multiple chunks', 'my-doc');
    const chunks = chunkDocument(doc, { strategy: 'sliding-window', chunkSize: 10, chunkOverlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, idx) => {
      expect(chunk.id).toBe(`my-doc-${idx}`);
    });
  });

  test('chunkIndex is zero-based and sequential', () => {
    const doc = makeDoc(LONG_DOCUMENT_CONTENT, 'doc1');
    const chunks = chunkDocument(doc, { strategy: 'sliding-window', chunkSize: 100, chunkOverlap: 20 });
    chunks.forEach((chunk, idx) => {
      expect(chunk.metadata.chunkIndex).toBe(idx);
    });
  });

  test('startChar / endChar offsets match sliced content', () => {
    const doc = makeDoc(LONG_DOCUMENT_CONTENT, 'offset-doc');
    for (const strategy of ['sliding-window', 'semantic', 'recursive'] as const) {
      const chunks = chunkDocument(doc, { strategy, chunkSize: 150, chunkOverlap: 20 });
      assertOffsetsMatch(chunks, LONG_DOCUMENT_CONTENT);
    }
  });

  test('strategy field matches requested strategy', () => {
    const doc = makeDoc('Enough content for at least one chunk.');
    for (const strategy of ['sliding-window', 'semantic', 'recursive'] as const) {
      const chunks = chunkDocument(doc, { strategy, chunkSize: 500, chunkOverlap: 0 });
      for (const chunk of chunks) {
        expect(chunk.metadata.strategy).toBe(strategy);
      }
    }
  });

  test('documentId on each chunk matches parent doc', () => {
    const doc = makeDoc('parent content here', 'parent-123');
    const chunks = chunkDocument(doc, { strategy: 'sliding-window', chunkSize: 5, chunkOverlap: 0 });
    for (const chunk of chunks) {
      expect(chunk.documentId).toBe('parent-123');
    }
  });

  test('source metadata propagated from parent doc', () => {
    const doc = createRawDocument({
      id: 'src-test',
      content: 'Metadata propagation test content',
      metadata: { source: '/my/path/file.md', filename: 'file.md', extension: '.md', sizeBytes: 100, loadedAt: '2025-06-01T00:00:00Z' },
    });
    const chunks = chunkDocument(doc, { strategy: 'sliding-window', chunkSize: 500, chunkOverlap: 0 });
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.source).toBe('/my/path/file.md');
  });
});
