import type { EmbeddingProvider } from './provider.ts';

/**
 * Deterministic mock embedding provider for testing.
 *
 * Vectors are produced by hashing the input text so that:
 * - The same text always yields the same vector.
 * - Different texts yield different (pseudo-random) vectors.
 * - Vectors are normalised to unit length.
 */
export class MockEmbedder implements EmbeddingProvider {
  readonly dimensions = 384;
  readonly modelName = 'mock-embedding';

  async embed(text: string): Promise<number[]> {
    return deterministicVector(text, this.dimensions);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => deterministicVector(t, this.dimensions));
  }
}

// ---------------------------------------------------------------------------
// Deterministic PRNG seeded by text hash
// ---------------------------------------------------------------------------

/**
 * Simple 32-bit hash (djb2 variant) of a string.
 * Returns an unsigned 32-bit integer.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + charCode
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0; // ensure unsigned
}

/**
 * Mulberry32 – a fast, seedable 32-bit PRNG.
 * Returns a function that yields numbers in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Produce a deterministic, unit-length vector for the given text.
 */
function deterministicVector(text: string, dims: number): number[] {
  const rng = mulberry32(hashString(text));
  const raw = Array.from({ length: dims }, () => rng() * 2 - 1); // [-1, 1)

  // L2-normalise
  const norm = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0)) || 1;
  return raw.map((v) => v / norm);
}
