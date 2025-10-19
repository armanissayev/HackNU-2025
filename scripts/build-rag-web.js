// Crawl https://www.zamanbank.kz/ru/ and build/merge a local vector index using the same Embedding API
// Usage: npm run rag:build:web

const fs = require('fs');
const path = require('path');
const { setTimeout: sleep } = require('timers/promises');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const START_URL = 'https://www.zamanbank.kz/ru/';
const OUT_PATH = path.resolve(__dirname, '../src/data/rag_index.json');
const API_BASE = 'http://localhost:11434/v1';
const API_KEY = 'sk-roG3OusRr0TLCHAADks6lw';
const EMB_MODEL = 'mxbai-embed-large:latest';

// Conservative crawl limits
const MAX_PAGES = 200; // hard cap
const MAX_DEPTH = 4; // bfs depth cap
const REQUEST_DELAY_MS = 200; // polite delay between requests

function normalizeWhitespace(s) {
  return s.replace(/\u00A0/g, ' ') // nbsp to space
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

// Very lightweight HTML text extraction without extra deps
function extractVisibleText(html) {
  if (!html) return '';
  // remove scripts/styles/noscript
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
              .replace(/<!--([\s\S]*?)-->/g, ' ');
  // try to drop common boilerplate sections by tag names
  s = s.replace(/<(header|footer|nav|form|aside)[\s\S]*?<\/\1>/gi, ' ');
  // replace <br> and block tags with newlines
  s = s.replace(/<(br|hr)\b[^>]*>/gi, '\n')
       .replace(/<\/(p|div|section|article|h[1-6]|li|ul|ol|table|tr)>/gi, '\n');
  // strip remaining tags
  s = s.replace(/<[^>]+>/g, ' ');
  // decode a few common entities
  s = s.replace(/&nbsp;/g, ' ')
       .replace(/&amp;/g, '&')
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'")
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>');
  // normalize whitespace and remove super short lines
  s = s.split(/\n+/).map(line => normalizeWhitespace(line)).filter(line => line.length > 0).join('\n');
  return s;
}

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
    body: JSON.stringify({ model: EMB_MODEL, input: inputs }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Embeddings API error ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data.data.map(d => d.embedding);
}

function shouldVisit(url, originHost) {
  try {
    const u = new URL(url);
    if (u.host !== originHost) return false;
    // focus on Russian content
    if (!u.pathname.startsWith('/ru')) return false;
    // skip files likely to be binary or unwanted
    if (u.pathname.match(/\.(pdf|jpg|jpeg|png|gif|svg|ico|webp|zip|rar|7z|doc|docx|xls|xlsx)$/i)) return false;
    return true;
  } catch {
    return false;
  }
}

function extractLinks(baseUrl, html) {
  const links = new Set();
  const hrefRegex = /href\s*=\s*"([^"]+)"|href\s*=\s*'([^']+)'/gi;
  let m;
  while ((m = hrefRegex.exec(html)) !== null) {
    const href = m[1] || m[2];
    if (!href) continue;
    try {
      const abs = new URL(href, baseUrl).toString();
      links.add(abs.split('#')[0]);
    } catch {
      // ignore
    }
  }
  return Array.from(links);
}

async function crawl(startUrl) {
  const origin = new URL(startUrl);
  const originHost = origin.host;

  const queue = [{ url: startUrl, depth: 0 }];
  const visited = new Set();
  const pages = [];

  while (queue.length && pages.length < MAX_PAGES) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const res = await fetch(url, { headers: { 'user-agent': 'HackNU-RAG-Bot/1.0' } });
      if (!res.ok) { console.warn('Skip (bad status):', res.status, url); continue; }
      const html = await res.text();
      const text = extractVisibleText(html);
      if (text && text.length > 200) {
        pages.push({ url, text });
        console.log(`[Crawl] Collected text from: ${url} (len=${text.length})`);
      } else {
        console.log(`[Crawl] No significant text at: ${url}`);
      }
      if (depth < MAX_DEPTH) {
        const links = extractLinks(url, html);
        for (const link of links) {
          if (shouldVisit(link, originHost) && !visited.has(link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }
      if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
    } catch (e) {
      console.warn('Skip (error):', url, e.message);
    }
  }

  console.log(`[Crawl] Total pages collected: ${pages.length}`);
  return pages;
}

async function main() {
  const pages = await crawl(START_URL);
  if (!pages.length) {
    console.error('No pages collected; aborting.');
    process.exit(1);
  }

  // Prepare input chunks with small source prefix for context
  const allTexts = [];
  const meta = [];
  for (const p of pages) {
    const chunks = chunkText(p.text, 1400, 250);
    for (const c of chunks) {
      const textWithSource = `[source: ${p.url}]\n` + c;
      allTexts.push(textWithSource);
      meta.push({ source: p.url });
    }
  }
  console.log(`Prepared ${allTexts.length} chunks for embedding from web pages.`);

  // Embed in batches
  const batchSize = 16;
  const vectors = [];
  for (let i = 0; i < allTexts.length; i += batchSize) {
    const batch = allTexts.slice(i, i + batchSize);
    console.log(`Embedding batch ${i / batchSize + 1}/${Math.ceil(allTexts.length / batchSize)} ...`);
    const embs = await embedBatch(batch);
    vectors.push(...embs);
  }
  if (vectors.length !== allTexts.length) throw new Error('Embeddings count mismatch');

  // Merge with existing index if any
  let existing = null;
  if (fs.existsSync(OUT_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    } catch {
      existing = null;
    }
  }

  const startIdx = (existing?.chunks?.length || 0);
  const dims = vectors[0]?.length || existing?.dims || 0;

  const newChunks = allTexts.map((text, i) => ({
    id: `w${startIdx + i + 1}`,
    text,
    embedding: vectors[i],
  }));

  const combined = {
    model: EMB_MODEL,
    dims,
    createdAt: new Date().toISOString(),
    chunks: existing?.chunks ? [...existing.chunks, ...newChunks] : newChunks,
  };

  // Ensure directory exists
  const dir = path.dirname(OUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(OUT_PATH, JSON.stringify(combined), 'utf8');
  console.log('Vector index updated at', OUT_PATH);
}

main().catch(err => {
  console.error('RAG web build failed:', err);
  process.exit(1);
});
