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

// ---------------------------------------------------------------------------
// Porter Stemmer Algorithm
// Reference: M.F. Porter, 1980, "An algorithm for suffix stripping"
// https://tartarus.org/martin/PorterStemmer/def.txt
// ---------------------------------------------------------------------------

/**
 * Returns true if the character at position i in the word is a consonant.
 * The letter 'y' is treated as a consonant only when it begins a word or
 * follows another vowel.
 */
function isConsonant(word: string, i: number): boolean {
  const c = word[i];
  if (c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u')
    return false;
  if (c === 'y') return i === 0 || !isConsonant(word, i - 1);
  return true;
}

/**
 * Compute the "measure" m of a word — the number of VC (vowel-consonant)
 * sequences in the form [C](VC){m}[V].
 */
function measure(word: string): number {
  let m = 0;
  let i = 0;
  const n = word.length;
  // Skip leading consonants
  while (i < n && isConsonant(word, i)) i++;
  while (i < n) {
    // Skip vowels
    while (i < n && !isConsonant(word, i)) i++;
    if (i >= n) break;
    m++;
    // Skip consonants
    while (i < n && isConsonant(word, i)) i++;
  }
  return m;
}

/** Returns true if the word contains at least one vowel. */
function hasVowel(word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    if (!isConsonant(word, i)) return true;
  }
  return false;
}

/** Returns true if the word ends with a double consonant (e.g. -tt, -ss). */
function endsDoubleConsonant(word: string): boolean {
  const n = word.length;
  if (n < 2) return false;
  return word[n - 1] === word[n - 2] && isConsonant(word, n - 1);
}

/**
 * The *o condition: word ends with consonant-vowel-consonant, where
 * the final consonant is not w, x, or y.
 */
function endsCVC(word: string): boolean {
  const n = word.length;
  if (n < 3) return false;
  if (
    !isConsonant(word, n - 1) ||
    isConsonant(word, n - 2) ||
    !isConsonant(word, n - 3)
  )
    return false;
  const last = word[n - 1];
  return last !== 'w' && last !== 'x' && last !== 'y';
}

/**
 * Porter stemmer — reduces an English word to its stem using the classic
 * five-step algorithm (plurals/past participles, derivational morphology,
 * etc.).
 */
export function stem(word: string): string {
  if (word.length <= 2) return word;

  // ---- Step 1a: plurals ----
  if (word.endsWith('sses')) {
    word = word.slice(0, -2);
  } else if (word.endsWith('ies')) {
    word = word.slice(0, -2);
  } else if (!word.endsWith('ss') && word.endsWith('s')) {
    word = word.slice(0, -1);
  }

  // ---- Step 1b: -eed / -ed / -ing ----
  let step1bExtra = false;
  if (word.endsWith('eed')) {
    if (measure(word.slice(0, -3)) > 0) word = word.slice(0, -1);
  } else if (word.endsWith('ed')) {
    const base = word.slice(0, -2);
    if (hasVowel(base)) {
      word = base;
      step1bExtra = true;
    }
  } else if (word.endsWith('ing')) {
    const base = word.slice(0, -3);
    if (hasVowel(base)) {
      word = base;
      step1bExtra = true;
    }
  }
  if (step1bExtra) {
    if (word.endsWith('at') || word.endsWith('bl') || word.endsWith('iz')) {
      word += 'e';
    } else if (endsDoubleConsonant(word)) {
      const last = word[word.length - 1];
      if (last !== 'l' && last !== 's' && last !== 'z') {
        word = word.slice(0, -1);
      }
    } else if (measure(word) === 1 && endsCVC(word)) {
      word += 'e';
    }
  }

  // ---- Step 1c: y → i ----
  if (word.endsWith('y') && hasVowel(word.slice(0, -1))) {
    word = word.slice(0, -1) + 'i';
  }

  // ---- Step 2: derivational morphology ----
  const step2: [string, string][] = [
    ['ational', 'ate'],
    ['tional', 'tion'],
    ['enci', 'ence'],
    ['anci', 'ance'],
    ['izer', 'ize'],
    ['abli', 'able'],
    ['alli', 'al'],
    ['entli', 'ent'],
    ['eli', 'e'],
    ['ousli', 'ous'],
    ['ization', 'ize'],
    ['ation', 'ate'],
    ['ator', 'ate'],
    ['alism', 'al'],
    ['iveness', 'ive'],
    ['fulness', 'ful'],
    ['ousness', 'ous'],
    ['aliti', 'al'],
    ['iviti', 'ive'],
    ['biliti', 'ble'],
    ['logi', 'log'],
  ];
  for (const [suffix, replacement] of step2) {
    if (word.endsWith(suffix)) {
      const base = word.slice(0, -suffix.length);
      if (measure(base) > 0) word = base + replacement;
      break;
    }
  }

  // ---- Step 3: more derivational suffixes ----
  const step3: [string, string][] = [
    ['icate', 'ic'],
    ['ative', ''],
    ['alize', 'al'],
    ['iciti', 'ic'],
    ['ical', 'ic'],
    ['ful', ''],
    ['ness', ''],
  ];
  for (const [suffix, replacement] of step3) {
    if (word.endsWith(suffix)) {
      const base = word.slice(0, -suffix.length);
      if (measure(base) > 0) word = base + replacement;
      break;
    }
  }

  // ---- Step 4: remove suffixes (requires m > 1) ----
  const step4 = [
    'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant',
    'ement', 'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti',
    'ous', 'ive', 'ize',
  ];
  for (const suffix of step4) {
    if (word.endsWith(suffix)) {
      const base = word.slice(0, -suffix.length);
      if (suffix === 'ion') {
        if (
          measure(base) > 1 &&
          (base.endsWith('s') || base.endsWith('t'))
        ) {
          word = base;
        }
      } else if (measure(base) > 1) {
        word = base;
      }
      break;
    }
  }

  // ---- Step 5a: remove trailing e ----
  if (word.endsWith('e')) {
    const base = word.slice(0, -1);
    const m = measure(base);
    if (m > 1 || (m === 1 && !endsCVC(base))) {
      word = base;
    }
  }

  // ---- Step 5b: ll → l when m > 1 ----
  if (word.endsWith('ll') && measure(word) > 1) {
    word = word.slice(0, -1);
  }

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

  /** Return the number of currently indexed documents. */
  getIndexedCount(): number {
    return this.documents.length;
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
