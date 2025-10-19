import { VectorDB, VectorIndex } from './vectorDb';

export interface HybridFilter {
  year?: number;
  month?: number;
  category?: string;
  merchant?: string;
  currency?: string;
}

export interface HybridResultItem {
  id: string;
  text: string;
  score: number; // fused score
  source: 'transaction' | 'summary';
}

const EMB_API = 'http://localhost:11434/v1/embeddings';
const API_KEY = 'sk-roG3OusRr0TLCHAADks6lw';
const EMB_MODEL = 'mxbai-embed-large:latest';

function tokenize(s: string): string[] {
  return (s || '').toLowerCase().replace(/[^a-zа-я0-9_\s]/gi, ' ').split(/\s+/).filter(Boolean);
}

function bm25Score(query: string, docs: { id: string; text: string }[]): Map<string, number> {
  const tokens = tokenize(query);
  if (!tokens.length) return new Map();
  const N = docs.length || 1;
  const avgdl = docs.reduce((a,d)=>a+tokenize(d.text).length,0) / N;
  const k1 = 1.2, b = 0.75;
  const df = new Map<string, number>();
  const tf = new Map<string, Map<string, number>>(); // term -> (docId -> count)
  for (const d of docs) {
    const seen = new Set<string>();
    for (const t of tokenize(d.text)) {
      const m = tf.get(t) || new Map();
      m.set(d.id, (m.get(d.id) || 0) + 1);
      tf.set(t, m);
      if (!seen.has(t)) {
        df.set(t, (df.get(t) || 0) + 1);
        seen.add(t);
      }
    }
  }
  const scores = new Map<string, number>();
  for (const d of docs) {
    const dl = tokenize(d.text).length;
    let s = 0;
    for (const q of tokens) {
      const m = tf.get(q);
      if (!m) continue;
      const f = m.get(d.id) || 0;
      const idf = Math.log(1 + (N - (df.get(q) || 0) + 0.5) / ((df.get(q) || 0) + 0.5));
      const denom = f + k1 * (1 - b + b * (dl / avgdl));
      s += idf * ((f * (k1 + 1)) / (denom || 1));
    }
    if (s) scores.set(d.id, s);
  }
  return scores;
}

export class HybridRetriever {
  private txDb: VectorDB | null = null;
  private sumDb: VectorDB | null = null;
  private txDocs: { id: string; text: string; metadata?: any }[] = [];
  private sumDocs: { id: string; text: string; metadata?: any }[] = [];

  async load(txUrl: string, sumUrl: string) {
    const [txRes, sumRes] = await Promise.all([fetch(txUrl), fetch(sumUrl)]);
    if (!txRes.ok || !sumRes.ok) throw new Error('Failed to load indexes');
    const txIndex = (await txRes.json()) as VectorIndex & { chunks: any[] };
    const sumIndex = (await sumRes.json()) as VectorIndex & { chunks: any[] };
    this.txDocs = txIndex.chunks.map(c => ({ id: c.id, text: c.text, metadata: c.metadata }));
    this.sumDocs = sumIndex.chunks.map(c => ({ id: c.id, text: c.text, metadata: c.metadata }));
    this.txDb = new VectorDB({ model: txIndex.model, dims: txIndex.dims, createdAt: txIndex.createdAt, chunks: txIndex.chunks });
    this.sumDb = new VectorDB({ model: sumIndex.model, dims: sumIndex.dims, createdAt: sumIndex.createdAt, chunks: sumIndex.chunks });
  }

  private async embed(text: string): Promise<number[] | null> {
    try {
      const res = await fetch(EMB_API, { method: 'POST', headers: { 'accept': 'application/json', 'content-type': 'application/json', Authorization: `Bearer ${API_KEY}` }, body: JSON.stringify({ model: EMB_MODEL, input: text }) });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.data?.[0]?.embedding || null;
    } catch { return null; }
  }

  private applyFilter(docs: { id: string; text: string; metadata?: any }[], f?: HybridFilter) {
    if (!f) return docs;
    return docs.filter(d => {
      const m = d.metadata || {};
      if (f.year && m.year !== f.year) return false;
      if (f.month && m.month !== f.month) return false;
      if (f.category && m.category_lvl1 && m.category_lvl1 !== f.category) return false;
      if (f.merchant && m.merchant && m.merchant !== f.merchant) return false;
      if (f.currency && m.currency && m.currency !== f.currency) return false;
      return true;
    });
  }

  async search(query: string, filter?: HybridFilter, k: number = 6): Promise<HybridResultItem[]> {
    if (!this.txDb || !this.sumDb) return [];
    const qEmb = await this.embed(query);
    if (!qEmb) return [];

    // Filter pools
    const txPool = this.applyFilter(this.txDocs, filter);
    const sumPool = this.applyFilter(this.sumDocs, filter);

    // Dense scores
    const txDense = this.txDb.search(qEmb, { topK: Math.min(k, 6), minScore: 0.2, mmrLambda: 0.6 });
    const sumDense = this.sumDb.search(qEmb, { topK: Math.min(k, 6), minScore: 0.2, mmrLambda: 0.6 });

    // Restrict to filtered IDs if filters applied
    const txDenseFiltered = txDense.filter(d => txPool.find(p => p.id === d.id));
    const sumDenseFiltered = sumDense.filter(d => sumPool.find(p => p.id === d.id));

    // BM25 on filtered pools
    const txBm25 = bm25Score(query, txPool);
    const sumBm25 = bm25Score(query, sumPool);

    // Fuse scores with simple min-max normalization and weighted sum
    function fuse(items: typeof txDenseFiltered, bm: Map<string, number>, source: 'transaction' | 'summary') {
      const denseMax = Math.max(...items.map(i => i.score), 1e-6);
      const bmMax = Math.max(...Array.from(bm.values()), 1e-6);
      const out: HybridResultItem[] = [];
      const seen = new Set<string>();
      // add dense items
      for (const it of items) {
        const bmScore = bm.get(it.id) || 0;
        const fused = 0.6 * (it.score / denseMax) + 0.4 * (bmScore / bmMax);
        out.push({ id: it.id, text: it.text, score: fused, source });
        seen.add(it.id);
      }
      // add top BM25-only items
      const bmOnly = Array.from(bm.entries()).sort((a,b)=>b[1]-a[1]).slice(0, k);
      for (const [id, bms] of bmOnly) {
        if (seen.has(id)) continue;
        const fused = 0.4 * (bms / bmMax);
        const doc = (source === 'transaction' ? txPool : sumPool).find(d => d.id === id);
        if (doc) out.push({ id, text: doc.text, score: fused, source });
      }
      return out;
    }

    const fusedTx = fuse(txDenseFiltered, txBm25, 'transaction');
    const fusedSum = fuse(sumDenseFiltered, sumBm25, 'summary');

    const all = [...fusedTx, ...fusedSum].sort((a,b)=>b.score-a.score).slice(0, k);
    return all;
  }
}
