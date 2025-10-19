// Lightweight in-memory VectorDB with cosine similarity and MMR diversification
// Works in the browser. Loads an index JSON produced by scripts/build-rag.js

export interface VectorChunk {
  id: string;
  text: string;
  embedding: number[] | Float32Array;
  page?: number;
  offset?: number;
  tokens?: number;
}

export interface VectorIndex {
  version?: number;
  model: string;
  dims: number;
  createdAt: string;
  chunks: VectorChunk[];
}

export interface SearchOptions {
  topK?: number; // number of results to return
  minScore?: number; // minimal cosine similarity to include
  mmrLambda?: number; // 0..1; 1 = relevance only, 0 = diversity only
}

export interface SearchResultItem {
  id: string;
  text: string;
  score: number;
  page?: number;
  offset?: number;
  tokens?: number;
}

export class VectorDB {
  private dims: number;
  private texts: string[];
  private ids: string[];
  private pages: (number | undefined)[];
  private offsets: (number | undefined)[];
  private tokens: (number | undefined)[];
  private embs: Float32Array[]; // normalized unit vectors

  constructor(index: VectorIndex) {
    this.dims = index.dims;
    this.texts = [];
    this.ids = [];
    this.pages = [];
    this.offsets = [];
    this.tokens = [];
    this.embs = [];

    for (const ch of index.chunks) {
      const arr = ch.embedding instanceof Float32Array ? ch.embedding : new Float32Array(ch.embedding);
      const norm = VectorDB.normalize(arr);
      this.embs.push(norm);
      this.texts.push(ch.text);
      this.ids.push(ch.id);
      this.pages.push(ch.page);
      this.offsets.push(ch.offset);
      this.tokens.push(ch.tokens);
    }
  }

  static normalize(vec: Float32Array): Float32Array {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
    const n = Math.sqrt(sum) || 1;
    const out = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) out[i] = vec[i] / n;
    return out;
  }

  static cosine(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) dot += a[i] * b[i];
    return dot; // since both normalized
  }

  search(queryEmbedding: number[] | Float32Array, options: SearchOptions = {}): SearchResultItem[] {
    const topK = options.topK ?? 5;
    const minScore = options.minScore ?? 0.25;
    const mmrLambda = options.mmrLambda ?? 0.5;

    const q = queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding);
    const qn = VectorDB.normalize(q);

    // Compute similarities
    const scores = new Float32Array(this.embs.length);
    for (let i = 0; i < this.embs.length; i++) {
      scores[i] = VectorDB.cosine(qn, this.embs[i]);
    }

    // Preselect candidates above minScore
    const candidates: number[] = [];
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] >= minScore) candidates.push(i);
    }
    // Fallback: if none pass threshold, take topK by score anyway
    if (candidates.length === 0) {
      const idx = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]).slice(0, topK * 3);
      candidates.push(...idx);
    }

    // MMR Selection
    const selected: number[] = [];
    const selectedSet = new Set<number>();

    while (selected.length < topK && candidates.length > 0) {
      let bestIdx = -1;
      let bestScore = -Infinity;

      for (const i of candidates) {
        if (selectedSet.has(i)) continue;
        const relevance = scores[i];
        let diversity = 0;
        for (const j of selected) {
          const sim = VectorDB.cosine(this.embs[i], this.embs[j]);
          if (sim > diversity) diversity = sim;
        }
        const mmr = mmrLambda * relevance - (1 - mmrLambda) * diversity;
        if (mmr > bestScore) {
          bestScore = mmr;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) break;
      selected.push(bestIdx);
      selectedSet.add(bestIdx);
    }

    // Prepare results
    return selected
      .sort((a, b) => scores[b] - scores[a])
      .map((i) => ({
        id: this.ids[i],
        text: this.texts[i],
        score: scores[i],
        page: this.pages[i],
        offset: this.offsets[i],
        tokens: this.tokens[i],
      }));
  }
}
