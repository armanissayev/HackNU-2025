import { VectorDB, VectorIndex, SearchOptions, SearchResultItem } from './vectorDb';
import { openRagDB, getAllChunks, getMeta } from './idbStore';

const EMB_API = 'http://localhost:11434/v1/embeddings';
const API_KEY = 'sk-roG3OusRr0TLCHAADks6lw';
const EMB_MODEL = 'mxbai-embed-large:latest';

export interface RetrieveOptions extends SearchOptions {
  maxContextChars?: number; // hard cap for assembled context length
}

export interface RetrieveResult {
  context: string;
  chunks: SearchResultItem[];
}

export class Retriever {
  private db: VectorDB | null = null;

  async loadIndex(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Не удалось загрузить векторный индекс');
    const json = (await res.json()) as VectorIndex;
    this.db = new VectorDB(json);
  }

  // Load from browser IndexedDB (preferred persistent VectorDB)
  async loadFromIDB(): Promise<boolean> {
    try {
      const db = await openRagDB();
      const meta = await getMeta(db);
      const chunks = await getAllChunks(db);
      if (!meta || !chunks || chunks.length === 0) {
        return false;
      }
      const index: VectorIndex = {
        model: meta.model,
        dims: meta.dims,
        createdAt: meta.createdAt,
        chunks: chunks.map(ch => ({
          id: ch.id,
          text: ch.text,
          embedding: ch.embedding,
        })),
      };
      this.db = new VectorDB(index);
      return true;
    } catch {
      return false;
    }
  }

  private async embed(text: string): Promise<number[] | null> {
    try {
      const cleaned = this.clean(text);
      const res = await fetch(EMB_API, {
        method: 'POST',
        headers: { 'accept': 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: EMB_MODEL, input: cleaned })
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.data?.[0]?.embedding || null;
    } catch {
      return null;
    }
  }

  private clean(text: string): string {
    // Simple query cleaner: trim, collapse spaces (keep original casing for proper nouns and acronyms)
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  async retrieve(query: string, options: RetrieveOptions = {}): Promise<RetrieveResult | null> {
    if (!this.db) return null;
    const qEmb = await this.embed(query);
    if (!qEmb) return null;

    const { topK = 5, minScore = 0.25, mmrLambda = 0.5, maxContextChars = 2000 } = options;
    const results = this.db.search(qEmb, { topK, minScore, mmrLambda });

    // Assemble context while respecting max char limit
    const lines: string[] = [];
    let used = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const header = `Источник ${i + 1}${r.page ? ` (стр. ${r.page})` : ''} — score ${(r.score).toFixed(3)}`;
      const block = `${header}\n${r.text}`;
      if (used + block.length > maxContextChars) break;
      lines.push(block);
      used += block.length;
    }

    return { context: lines.join('\n\n'), chunks: results };
  }
}
