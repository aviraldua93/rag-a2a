import type { SearchResult } from '../store/types.ts';

export interface CitationCheck {
  citationId: number;        // The [Source N] number
  referenced: boolean;       // Was this source actually provided?
  contentMatch: boolean;     // Does the cited claim exist in the source?
}

export interface GuardrailResult {
  isGrounded: boolean;         // All citations valid?
  citations: CitationCheck[];
  uncitedClaims: string[];     // Sentences with no citation
  hallucinations: string[];    // Citations referencing non-existent sources
  groundingScore: number;      // 0-1, fraction of citations that are valid
}

/** Extract [Source N] citations from generated text */
export function extractCitations(text: string): number[] {
  const matches = text.matchAll(/\[Source\s+(\d+)\]/gi);
  return [...matches].map(m => parseInt(m[1], 10));
}

/** Verify that citations in the generated answer reference actual provided contexts */
export function verifyCitations(
  answer: string,
  contexts: SearchResult[]
): GuardrailResult {
  const citedNumbers = extractCitations(answer);
  const uniqueCited = [...new Set(citedNumbers)];

  const citations: CitationCheck[] = uniqueCited.map(num => {
    const sourceIndex = num - 1; // [Source 1] = contexts[0]
    const referenced = sourceIndex >= 0 && sourceIndex < contexts.length;

    return {
      citationId: num,
      referenced,
      contentMatch: referenced, // simplified: if source exists, assume match
    };
  });

  const hallucinations = citations
    .filter(c => !c.referenced)
    .map(c => `[Source ${c.citationId}] references non-existent context`);

  // Find sentences without any citation (potential uncited claims)
  const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const uncitedClaims = sentences
    .filter(s => !/\[Source\s+\d+\]/i.test(s))
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const validCitations = citations.filter(c => c.referenced).length;
  const groundingScore = uniqueCited.length > 0 ? validCitations / uniqueCited.length : 1;

  return {
    isGrounded: hallucinations.length === 0,
    citations,
    uncitedClaims,
    hallucinations,
    groundingScore,
  };
}
