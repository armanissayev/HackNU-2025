// Build a local vector index from Info.pdf using OpenAI-compatible embeddings API
// Usage: npm run rag:build

const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const PDF_PATH = path.resolve(__dirname, '../src/data/Info.pdf');
const OUT_PATH = path.resolve(__dirname, '../src/data/rag_index.json');
const API_BASE = 'https://openai-hub.neuraldeep.tech/v1';
const API_KEY = 'sk-roG3OusRr0TLCHAADks6lw';
const EMB_MODEL = 'text-embedding-3-small';

function chunkText(text, chunkSize = 800, overlap = 150) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + chunkSize);
    let chunk = text.slice(i, end);
    chunk = chunk.replace(/\s+/g, ' ').trim();
    if (chunk) chunks.push(chunk);
    if (end === text.length) break;
    i += chunkSize - overlap;
  }
  return chunks;
}

async function embedBatch(inputs) {
  const res = await fetch(`${API_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: EMB_MODEL,
      input: inputs,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Embeddings API error ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data.data.map(d => d.embedding);
}

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    console.error('Info.pdf not found at', PDF_PATH);
    process.exit(1);
  }
  const pdfBuf = fs.readFileSync(PDF_PATH);
  const pdfData = await pdf(pdfBuf);
  const fullText = (pdfData.text || '').trim();
  if (!fullText) {
    console.error('No text extracted from PDF');
    process.exit(1);
  }

  const chunks = chunkText(fullText, 1400, 250);
  console.log(`Extracted ${chunks.length} chunks from Info.pdf`);

  // Batch embeddings (OpenAI supports array inputs). We'll send in batches of 16
  const batchSize = 16;
  const vectors = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    console.log(`Embedding batch ${i / batchSize + 1}/${Math.ceil(chunks.length / batchSize)} ...`);
    const embs = await embedBatch(batch);
    vectors.push(...embs);
  }

  if (vectors.length !== chunks.length) {
    throw new Error('Embeddings count does not match chunks count');
  }

  const dims = vectors[0]?.length || 0;
  const index = {
    model: EMB_MODEL,
    dims,
    createdAt: new Date().toISOString(),
    chunks: chunks.map((text, i) => ({ id: `c${i + 1}`, text, embedding: vectors[i] })),
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(index), 'utf8');
  console.log('Vector index saved to', OUT_PATH);
}

main().catch(err => {
  console.error('RAG build failed:', err);
  process.exit(1);
});
