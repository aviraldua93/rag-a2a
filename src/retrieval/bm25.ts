import type { SearchResult } from '../store/types.ts';

/** A document to be indexed for BM25 keyword search. */
export interface BM25Document {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

/** Common English stopwords to filter during tokenization. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'of', 'in', 'to', 'and', 'or', 'for',
  'on', 'at', 'by', 'with', 'from', 'as', 'be', 'was', 'were', 'been',
  'are', 'am', 'do', 'did', 'does', 'has', 'had', 'have', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'not', 'no', 'but',
  'if', 'so', 'than', 'too', 'very', 'just', 'about', 'up', 'out', 'that',
  'this', 'these', 'those', 'then', 'there', 'here', 'when', 'where', 'how',
  'what', 'which', 'who', 'whom', 'why', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
  'also', 'into', 'over', 'after', 'before', 'between', 'under', 'again',
  'its', 'his', 'her', 'their', 'our', 'your', 'my', 'me', 'him', 'them',
  'us', 'he', 'she', 'we', 'they', 'i', 'you',
]);

/**
 * Simple suffix-stripping stemmer.
 * Removes common English suffixes to normalize terms.
 */
function stem(word: string): string {
  if (word.length <= 3) return word;

  if (word.endsWith('tion') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('er') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3)
    return word.slice(0, -1);

  return word;
}

/**
 * BM25 (Okapi BM25) keyword search index.
 *
 * Implements the standard BM25 ranking function with configurable k1 and b
 * parameters. Documents are tokenized, stopword-filtered, and stemmed before
 * indexing.
 */
export class BM25Index {
  private documents: BM25Document[] = [];
  private avgDocLength: number = 0;
  private docFrequencies: Map<string, number> = new Map();
  private docLengths: Map<string, number> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private docTokens: Map<string, Map<string, number>> = new Map();
  private k1: number;
  private b: number;

  constructor(k1: number = 1.2, b: number = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  /**
   * Index a set of documents for BM25 search.
   * Replaces any previously indexed documents.
   */
  index(documents: BM25Document[]): void {
    this.documents = documents;
    this.docFrequencies.clear();
    this.docLengths.clear();
    this.invertedIndex.clear();
    this.docTokens.clear();

    let totalLength = 0;

    for (const doc of documents) {
      const tokens = this.tokenize(doc.content);
      this.docLengths.set(doc.id, tokens.length);
      totalLength += tokens.length;

      // Build per-document term frequency map
      const termFreq = new Map<string, number>();
      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      }
      this.docTokens.set(doc.id, termFreq);

      // Build inverted index and document frequencies
      for (const term of termFreq.keys()) {
        if (!this.invertedIndex.has(term)) {
          this.invertedIndex.set(term, new Set());
        }
        this.invertedIndex.get(term)!.add(doc.id);
        this.docFrequencies.set(
          term,
          (this.docFrequencies.get(term) ?? 0) + 1,
        );
      }
    }

    this.avgDocLength =
      documents.length > 0 ? totalLength / documents.length : 0;
  }

  /**
   * Search the indexed documents using BM25 scoring.
   * Returns the top-K results sorted by relevance score descending.
   */
  search(query: string, topK: number): SearchResult[] {
    if (this.documents.length === 0) return [];

    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return [];

    // Collect candidate document IDs that contain at least one query term
    const candidateIds = new Set<string>();
    for (const term of queryTerms) {
      const docIds = this.invertedIndex.get(term);
      if (docIds) {
        for (const id of docIds) {
          candidateIds.add(id);
        }
      }
    }

    const scored: SearchResult[] = [];
    const docMap = new Map(this.documents.map((d) => [d.id, d]));

    for (const docId of candidateIds) {
      const s = this.score(docId, queryTerms);
      const doc = docMap.get(docId)!;
      scored.push({
        id: doc.id,
        content: doc.content,
        score: s,
        metadata: doc.metadata,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Tokenize text into stemmed, stopword-filtered terms.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t))
      .map(stem);
  }

  /**
   * Calculate the BM25 score for a document given a set of query terms.
   *
   * BM25(D, Q) = Σ IDF(qi) · (tf(qi, D) · (k1 + 1)) / (tf(qi, D) + k1 · (1 - b + b · |D| / avgdl))
   * IDF(qi) = log((N - df(qi) + 0.5) / (df(qi) + 0.5) + 1)
   */
  private score(docId: string, queryTerms: string[]): number {
    const N = this.documents.length;
    const docLen = this.docLengths.get(docId) ?? 0;
    const termFreqs = this.docTokens.get(docId);
    if (!termFreqs) return 0;

    let total = 0;

    for (const term of queryTerms) {
      const df = this.docFrequencies.get(term) ?? 0;
      if (df === 0) continue;

      const tf = termFreqs.get(term) ?? 0;
      if (tf === 0) continue;

      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const numerator = tf * (this.k1 + 1);
      const denominator =
        tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));

      total += idf * (numerator / denominator);
    }

    return total;
  }
}
