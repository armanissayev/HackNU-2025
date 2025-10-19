// Analyze user transactions CSV, generate a detailed report, and add transaction insights to the RAG index
// Usage: npm run rag:build:report

const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const CSV_PATH = path.resolve(__dirname, '../src/data/user-transactions.csv');
const REPORT_JSON_PATH = path.resolve(__dirname, '../src/data/transactions-report.json');
const REPORT_MD_PATH = path.resolve(__dirname, '../src/data/transactions-report.md');
const RAG_PATH = path.resolve(__dirname, '../src/data/rag_index.json');

const API_BASE = 'https://openai-hub.neuraldeep.tech/v1';
const API_KEY = 'sk-roG3OusRr0TLCHAADks6lw';
const EMB_MODEL = 'text-embedding-3-small';

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const header = lines[0].split(',').map(h => h.trim());
  const idx = (name) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const idxDate = idx('date');
  const idxCat = idx('category');
  const idxDesc = idx('description') >= 0 ? idx('description') : idx('merchant');
  const idxAmount = header.findIndex(h => h.toLowerCase() === 'amount' || h.toLowerCase().startsWith('amount'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (!parts.length) continue;
    const dateStr = (parts[idxDate] || '').trim();
    const category = (parts[idxCat] || '').trim();
    const description = (parts[idxDesc] || '').trim();
    const amountStr = String(parts[idxAmount] || '').replace(/[^0-9+\-.,]/g, '').replace(/,/g, '.');
    const amount = Number(amountStr);
    const date = new Date(dateStr);
    if (!isFinite(amount) || isNaN(date.getTime())) continue;
    rows.push({ date, category, description, amount });
  }
  return rows;
}

function monthKey(d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function normalizeCat(cat) {
  const c = String(cat || '').toLowerCase();
  switch (c) {
    case 'salary': return 'income_salary';
    case 'taxi income': return 'income_taxi';
    case 'accommodation': return 'housing';
    case 'products': return 'groceries';
    case 'cafe': return 'food_out';
    case 'diesel': return 'transport';
    case 'entertainment': return 'entertainment';
    case 'savings': return 'savings';
    default: return c || 'other';
  }
}

function isIncomeRow(row) {
  const c = normalizeCat(row.category);
  if (c.startsWith('income_')) return true;
  return row.amount > 0;
}

function summarize(rows) {
  const sorted = [...rows].sort((a,b) => a.date - b.date);
  const byMonth = new Map();
  const byCat = new Map(); // totals by normalized category
  const byMerch = new Map();
  let income = 0, expense = 0;

  for (const r of sorted) {
    const key = monthKey(r.date);
    const bucket = byMonth.get(key) || { income: 0, expense: 0, count: 0 };
    const amt = Math.abs(r.amount);
    if (isIncomeRow(r)) { bucket.income += amt; income += amt; } else { bucket.expense += amt; expense += amt; }
    bucket.count++;
    byMonth.set(key, bucket);

    const catKey = normalizeCat(r.category);
    const catAgg = byCat.get(catKey) || { amount: 0, income: 0, expense: 0, count: 0, originalNames: new Map() };
    catAgg.amount += amt * (isIncomeRow(r) ? 1 : 1); // store absolute for total
    if (isIncomeRow(r)) catAgg.income += amt; else catAgg.expense += amt;
    catAgg.count++;
    // track original labels for readability
    const on = (r.category || 'other');
    catAgg.originalNames.set(on, (catAgg.originalNames.get(on) || 0) + amt);
    byCat.set(catKey, catAgg);

    const merchKey = (r.description || '').toLowerCase().slice(0, 64);
    const mAgg = byMerch.get(merchKey) || { name: r.description, amount: 0, income: 0, expense: 0, count: 0 };
    mAgg.amount += amt;
    if (isIncomeRow(r)) mAgg.income += amt; else mAgg.expense += amt;
    mAgg.count++;
    byMerch.set(merchKey, mAgg);
  }

  const net = income - expense;
  const months = Array.from(byMonth.entries()).sort((a,b) => a[0] < b[0] ? -1 : 1).map(([k,v]) => ({ month: k, income: v.income, expense: v.expense, net: v.income - v.expense, count: v.count }));
  const categories = Array.from(byCat.entries()).map(([k,v]) => ({ key: k, name: Array.from(v.originalNames.entries()).sort((a,b)=>b[1]-a[1])[0]?.[0] || k, income: v.income, expense: v.expense, total: v.amount, count: v.count }));
  categories.sort((a,b) => (b.expense||0) - (a.expense||0));
  const merchants = Array.from(byMerch.values()).sort((a,b) => (b.expense||0) - (a.expense||0));

  // simple anomaly detection: top 3 expense transactions relative to category median
  const byCatTx = new Map();
  for (const r of rows) {
    if (isIncomeRow(r)) continue; // expenses only
    const k = normalizeCat(r.category);
    if (!byCatTx.has(k)) byCatTx.set(k, []);
    byCatTx.get(k).push(Math.abs(r.amount));
  }
  const medians = new Map();
  for (const [k, arr] of byCatTx.entries()) {
    arr.sort((a,b)=>a-b);
    const mid = Math.floor(arr.length/2);
    const med = arr.length % 2 ? arr[mid] : (arr[mid-1]+arr[mid])/2;
    medians.set(k, med || 0);
  }
  const expenseTx = rows.filter(r => !isIncomeRow(r)).map(r => ({
    ...r,
    abs: Math.abs(r.amount),
    cat: normalizeCat(r.category),
  }));
  const anomalies = expenseTx
    .map(r => ({
      date: r.date,
      category: r.category,
      description: r.description,
      amount: -r.abs,
      z: medians.get(r.cat) ? r.abs / medians.get(r.cat) : 0,
    }))
    .filter(a => a.z >= 1.6)
    .sort((a,b) => b.z - a.z)
    .slice(0, 5);

  return { totals: { income, expense, net }, months, categories, merchants, anomalies, count: rows.length };
}

function formatKZT(n) {
  return new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(n);
}

function mdReport(summary) {
  const lines = [];
  lines.push(`# Отчёт по транзакциям (полный)`);
  lines.push('');
  lines.push(`Сгенерировано: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Всего записей: ${summary.count}`);
  lines.push(`Доходы: ${formatKZT(summary.totals.income)} | Расходы: ${formatKZT(summary.totals.expense)} | Чистый баланс: ${formatKZT(summary.totals.net)}`);
  lines.push('');
  lines.push('## Динамика по месяцам');
  for (const m of summary.months) {
    lines.push(`- ${m.month}: доходы ${formatKZT(m.income)}, расходы ${formatKZT(m.expense)}, баланс ${formatKZT(m.net)} (транзакций: ${m.count})`);
  }
  lines.push('');
  lines.push('## Расходы по категориям (топ)');
  for (const c of summary.categories.slice(0, 12)) {
    lines.push(`- ${c.name}: расходы ${formatKZT(c.expense)}; доходы ${formatKZT(c.income)} (всего записей: ${c.count})`);
  }
  lines.push('');
  lines.push('## Топ торговых описаний по расходам');
  for (const m of summary.merchants.slice(0, 10)) {
    lines.push(`- ${m.name}: расходы ${formatKZT(m.expense)} (записей: ${m.count})`);
  }
  if (summary.anomalies.length) {
    lines.push('');
    lines.push('## Аномальные расходы (высокие относительно медианы категории)');
    for (const a of summary.anomalies) {
      lines.push(`- ${a.date.toISOString().slice(0,10)} • ${a.category} • ${a.description} • ${formatKZT(-a.amount)} (x${a.z.toFixed(2)} от медианы)`);
    }
  }
  lines.push('');
  lines.push('> Справка: положительные суммы — доходы, отрицательные — расходы.');
  return lines.join('\n');
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

function chunkText(text, chunkSize = 900, overlap = 150) {
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

function ensureRagIndex() {
  if (!fs.existsSync(RAG_PATH)) {
    return { model: EMB_MODEL, dims: 1536, createdAt: new Date().toISOString(), chunks: [] };
  }
  try {
    const raw = fs.readFileSync(RAG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { model: EMB_MODEL, dims: 1536, createdAt: new Date().toISOString(), chunks: [] };
  }
}

async function addTransactionsToRag(rows, summary) {
  const index = ensureRagIndex();

  // Build concise knowledge snippets with metadata for better filtering
  const docs = [];
  // Per-month summary docs
  for (const m of summary.months) {
    const [y, mm] = m.month.split('-');
    docs.push({
      text: `Отчёт за ${m.month}: доходы ${formatKZT(m.income)}, расходы ${formatKZT(m.expense)}, баланс ${formatKZT(m.net)}.`,
      meta: { type: 'txn_summary_month', year: Number(y), month: Number(mm) }
    });
  }
  // Per-category overall summary
  for (const c of summary.categories.slice(0, 20)) {
    docs.push({
      text: `Категория ${c.name}: расходы ${formatKZT(c.expense)}, доходы ${formatKZT(c.income)} за наблюдаемый период.`,
      meta: { type: 'txn_summary_category', category_lvl1: normalizeCat(c.key || c.name) }
    });
  }
  // Notable anomalies
  for (const a of summary.anomalies) {
    const y = a.date.getUTCFullYear();
    const m = a.date.getUTCMonth() + 1;
    docs.push({
      text: `Аномальная трата ${a.date.toISOString().slice(0,10)}: ${a.category} — ${a.description} на сумму ${formatKZT(-a.amount)} (высоко относительно медианы).`,
      meta: { type: 'txn_anomaly', year: y, month: m, category_lvl1: normalizeCat(a.category), merchant: String(a.description || '').toLowerCase() }
    });
  }
  // One consolidated high-level summary
  docs.push({
    text: `Итоги: доходы ${formatKZT(summary.totals.income)}, расходы ${formatKZT(summary.totals.expense)}, чистый баланс ${formatKZT(summary.totals.net)}. Топ-расходные категории: ${summary.categories.slice(0,5).map(c=>c.name).join(', ')}.`,
    meta: { type: 'txn_overview' }
  });

  // Chunk and embed
  const inputs = docs.map(d => d.text);
  const embs = await embedBatch(inputs);
  const dims = embs[0]?.length || index.dims || 1536;
  const baseId = `tx${Date.now()}`;
  const newChunks = docs.map((d, i) => ({ id: `${baseId}-${i+1}`, text: d.text, embedding: embs[i], meta: { metadata: d.meta } }));

  index.model = EMB_MODEL;
  index.dims = dims;
  index.chunks = Array.isArray(index.chunks) ? index.chunks : [];
  index.chunks.push(...newChunks);
  index.createdAt = index.createdAt || new Date().toISOString();

  fs.writeFileSync(RAG_PATH, JSON.stringify(index));
  return newChunks.length;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('CSV not found at', CSV_PATH);
    process.exit(1);
  }
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(csv);
  if (!rows.length) {
    console.error('No transactions parsed from CSV.');
    process.exit(1);
  }
  const summary = summarize(rows);

  // Write JSON report
  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 2), 'utf8');
  // Write Markdown report
  fs.writeFileSync(REPORT_MD_PATH, mdReport(summary), 'utf8');
  console.log('Reports saved to:', REPORT_JSON_PATH, 'and', REPORT_MD_PATH);

  // Add to RAG index
  const added = await addTransactionsToRag(rows, summary);
  console.log(`Appended ${added} transaction context chunks into`, RAG_PATH);
}

main().catch(err => {
  console.error('Analyze transactions failed:', err);
  process.exit(1);
});
