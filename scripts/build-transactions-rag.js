// Построение RAG-индексов на основе user-transactions.csv
// - Создаёт два файла индексов с эмбеддингами:
//   src/data/tx_index.json (один документ на транзакцию)
//   src/data/sum_index.json (предрасчитанные сводки: по месяцам/категориям/мерчантам/повторяющимся/аномалиям)
// - Также записывает сырые JSONL документы для отладки: src/data/tx_docs.jsonl и src/data/sum_docs.jsonl
// Запуск: node scripts/build-transactions-rag.js

const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const CSV_PATH = path.resolve(__dirname, '../src/data/user-transactions.csv');
const OUT_TX_INDEX = path.resolve(__dirname, '../src/data/tx_index.json');
const OUT_SUM_INDEX = path.resolve(__dirname, '../src/data/sum_index.json');
const OUT_TX_JSONL = path.resolve(__dirname, '../src/data/tx_docs.jsonl');
const OUT_SUM_JSONL = path.resolve(__dirname, '../src/data/sum_docs.jsonl');

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
  const idxCurrency = header.findIndex(h => h.toLowerCase() === 'currency');
  const idxRecurring = header.findIndex(h => h.toLowerCase().includes('recurr'));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (!parts.length) continue;
    const dateStr = (parts[idxDate] || '').trim();
    const category = (parts[idxCat] || '').trim();
    const description = (parts[idxDesc] || '').trim();
    const currency = (idxCurrency >= 0 ? parts[idxCurrency] : 'KZT')?.trim() || 'KZT';
    const recurringRaw = (idxRecurring >= 0 ? parts[idxRecurring] : '').trim().toLowerCase();
    const is_recurring = ['yes','true','y','1','да','monthly','ежемесячно'].includes(recurringRaw);
    const amountStr = String(parts[idxAmount] || '').replace(/[^0-9+\-.,]/g, '').replace(/,/g, '.');
    const amountNum = Number(amountStr);
    const date = new Date(dateStr);
    if (!isFinite(amountNum) || isNaN(date.getTime())) continue;
    rows.push({ date, category, description, amount: amountNum, currency, is_recurring });
  }
  return rows;
}

function toISODate(d) {
  // нормализуем к ISO дате в UTC (без времени, если оно отсутствует)
  const iso = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())).toISOString();
  return iso;
}

function monthKey(d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function weekOfYear(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (4 - dayNum));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

function normMerchant(s) {
  return String(s || '').toLowerCase().trim();
}

function normCategory(s) {
  const c = String(s || '').toLowerCase().trim();
  const map = new Map([
    ['products','groceries'],
    ['groceries','groceries'],
    ['cafe','food_out'],
    ['restaurant','food_out'],
    ['diesel','transport'],
    ['fuel','transport'],
    ['accommodation','housing'],
    ['rent','housing'],
    ['subscription','subscription'],
    ['entertainment','entertainment'],
    ['salary','income_salary'],
    ['taxi income','income_taxi'],
    ['savings','savings'],
  ]);
  if (map.has(c)) return map.get(c);
  return c || 'other';
}

function amountBin(n) {
  const a = Math.abs(n);
  if (a < 500) return '<0.5k';
  if (a < 1000) return '0.5k-1k';
  if (a < 2000) return '1k-2k';
  if (a < 5000) return '2k-5k';
  if (a < 10000) return '5k-10k';
  if (a < 20000) return '10k-20k';
  return '20k+';
}

function isIncome(row) {
  const nc = normCategory(row.category);
  if (nc.startsWith('income_')) return true;
  const catStr = String(row.category || '');
  const descStr = String(row.description || '');
  const incomeRe = /(income|зарплат|доход|поступлен|перевод|cash\s*back|cashback|кэшбэк|кешбэк|процент(ы)?|interest|bonus|бонус)/i;
  return incomeRe.test(catStr) || incomeRe.test(descStr);
}

function ruYesNo(b) {
  return b ? 'да' : 'нет';
}

function ruTxType(type) {
  return type === 'income' ? 'Доход' : 'Расход';
}

function ruCategory(cat) {
  const map = new Map([
    ['groceries', 'продукты'],
    ['food_out', 'кафе и рестораны'],
    ['transport', 'транспорт'],
    ['housing', 'жильё'],
    ['subscription', 'подписки'],
    ['entertainment', 'развлечения'],
    ['income_salary', 'зарплата'],
    ['income_taxi', 'доход (такси)'],
    ['savings', 'сбережения'],
    ['other', 'другое'],
  ]);
  return map.get(cat) || cat;
}

function txDoc(row, idx) {
  const tsISO = toISODate(row.date);
  const y = row.date.getUTCFullYear();
  const m = row.date.getUTCMonth() + 1;
  const w = weekOfYear(row.date);
  const type = isIncome(row) ? 'income' : 'expense';
  const amtAbs = Math.abs(row.amount);
  const cat1 = normCategory(row.category);
  const cat2 = cat1.includes('subscription') ? 'subscription' : undefined;
  const merch = normMerchant(row.description);
  const bin = amountBin(amtAbs);
  const id = `tx_${tsISO.slice(0,10)}_${String(idx).padStart(6,'0')}`;
  const recurring = !!row.is_recurring || (merch.includes('spotify') || merch.includes('netflix'));
  const text = `Транзакция ${tsISO.slice(0,10)}: ${ruTxType(type)} ${amtAbs} ${row.currency} в ${row.description} (${ruCategory(cat2 || cat1)}). Подписка: ${ruYesNo(recurring)}.`;
  return {
    doc_type: 'transaction',
    id,
    text,
    metadata: {
      timestamp: tsISO,
      year: y,
      month: m,
      week: w,
      type,
      amount: amtAbs,
      currency: row.currency,
      category_lvl1: cat1,
      category_lvl2: cat2,
      merchant: merch,
      is_recurring: recurring,
      amount_bin: bin,
    },
  };
}

function summarize(rows) {
  const byMonth = new Map();
  const byCatMonth = new Map(); // ключ: `${y}-${m}_${cat1}`
  const byMerchMonth = new Map(); // ключ: `${y}-${m}_${merchant}`
  const recurring = new Map(); // merchant -> {count, total, months} (повторяющиеся)
  const expensesOnly = [];

  for (const r of rows) {
    const key = monthKey(r.date);
    const bucket = byMonth.get(key) || { income: 0, expense: 0, count: 0 };
    const amt = Math.abs(r.amount);
    if (isIncome(r)) bucket.income += amt; else { bucket.expense += amt; expensesOnly.push(r); }
    bucket.count++;
    byMonth.set(key, bucket);

    const cat1 = normCategory(r.category);
    const k2 = `${key}_${cat1}`;
    const b2 = byCatMonth.get(k2) || { amount: 0, count: 0 };
    b2.amount += amt;
    b2.count++;
    byCatMonth.set(k2, b2);

    const merch = normMerchant(r.description);
    const k3 = `${key}_${merch}`;
    const b3 = byMerchMonth.get(k3) || { amount: 0, count: 0, name: r.description };
    b3.amount += amt;
    b3.count++;
    byMerchMonth.set(k3, b3);

    if (r.is_recurring || merch.includes('spotify') || merch.includes('netflix')) {
      const rec = recurring.get(merch) || { merchant: merch, name: r.description, count: 0, total: 0 };
      rec.count++;
      rec.total += amt;
      recurring.set(merch, rec);
    }
  }

  // Простые аномалии относительно медианы за 3 месяца по категориям
  const byCat = new Map();
  for (const r of expensesOnly) {
    const key = normCategory(r.category);
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(Math.abs(r.amount));
  }
  const med = new Map();
  for (const [k, arr] of byCat.entries()) {
    arr.sort((a,b)=>a-b);
    const mid = Math.floor(arr.length/2);
    const m = arr.length % 2 ? arr[mid] : (arr[mid-1]+arr[mid])/2;
    med.set(k, m || 0);
  }
  const anomalies = expensesOnly
    .map((r) => ({ r, z: med.get(normCategory(r.category)) ? Math.abs(r.amount) / med.get(normCategory(r.category)) : 0 }))
    .filter(x => x.z >= 1.6)
    .sort((a,b) => b.z - a.z)
    .slice(0, 10)
    .map(({ r, z }, i) => ({
      id: `anom_${monthKey(r.date)}_${i}`,
      text: `Аномалия: ${r.description} в ${monthKey(r.date)} на сумму ${Math.abs(r.amount)} ${r.currency} (${ruCategory(normCategory(r.category))}), x${z.toFixed(2)} по сравнению с медианой`,
      metadata: { year: r.date.getUTCFullYear(), month: r.date.getUTCMonth()+1, category_lvl1: normCategory(r.category), merchant: normMerchant(r.description) }
    }));

  return { byMonth, byCatMonth, byMerchMonth, recurring: Array.from(recurring.values()), anomalies };
}

async function embedBatch(inputs) {
  const res = await fetch(`${API_BASE}/embeddings`, {
    method: 'POST',
    headers: { 'accept': 'application/json', 'content-type': 'application/json', 'authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: EMB_MODEL, input: inputs }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Ошибка Embeddings API ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data.data.map(d => d.embedding);
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('CSV-файл не найден по пути', CSV_PATH);
    process.exit(1);
  }
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(csv);
  if (!rows.length) {
    console.error('Не удалось распарсить ни одной транзакции из CSV.');
    process.exit(1);
  }

  // 1) Формируем документы-транзакции
  const txDocs = rows.map((r, i) => txDoc(r, i+1));

  // 2) Формируем сводные документы
  const agg = summarize(rows);
  const sumDocs = [];

  function ruPluralTransactions(n) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return 'транзакций';
    if (b === 1) return 'транзакция';
    if (b >= 2 && b <= 4) return 'транзакции';
    return 'транзакций';
  }

  // Помесячные итоги
  for (const [mk, v] of agg.byMonth.entries()) {
    const [y, mm] = mk.split('-').map(Number);
    sumDocs.push({
      doc_type: 'summary',
      id: `sum_${mk}_totals`,
      text: `${mk}: доходы — ${v.income} KZT, расходы — ${v.expense} KZT. Итог (нетто): ${v.income - v.expense} KZT.`,
      metadata: { year: y, month: mm, kind: 'monthly_totals' },
    });
  }

  // По категориям за месяц
  for (const [k, v] of agg.byCatMonth.entries()) {
    const [mk, cat1] = k.split('_');
    const [y, mm] = mk.split('-').map(Number);
    sumDocs.push({
      doc_type: 'summary',
      id: `sum_${mk}_${cat1}`,
      text: `${mk}: по категории "${ruCategory(cat1)}" расходы составили ${v.amount} KZT по ${v.count} ${ruPluralTransactions(v.count)}.`,
      metadata: { year: y, month: mm, category_lvl1: cat1, kind: 'monthly_category' },
    });
  }

  // По мерчантам за месяц
  for (const [k, v] of agg.byMerchMonth.entries()) {
    const [mk, merchant] = k.split('_');
    const [y, mm] = mk.split('-').map(Number);
    sumDocs.push({
      doc_type: 'summary',
      id: `sum_${mk}_${merchant}`,
      text: `${mk}: траты у продавца ${v.name} составили ${v.amount} KZT по ${v.count} ${ruPluralTransactions(v.count)}.`,
      metadata: { year: y, month: mm, merchant, kind: 'monthly_merchant' },
    });
  }

  // Список повторяющихся подписок
  if (agg.recurring.length) {
    const line = agg.recurring
      .sort((a,b)=>b.total-a.total)
      .map(r => `${r.name} (${r.merchant}): ${r.total} KZT`).join('; ');
    sumDocs.push({
      doc_type: 'summary',
      id: `sum_recurring_list`,
      text: `Повторяющиеся подписки: ${line}.`,
      metadata: { kind: 'recurring_list' },
    });
  }

  // Аномалии уже имеют нужную форму; добавляем их
  for (const a of agg.anomalies) sumDocs.push(a);

  // Записываем сырые JSONL для отладки
  fs.writeFileSync(OUT_TX_JSONL, txDocs.map(d => JSON.stringify(d)).join('\n'), 'utf8');
  fs.writeFileSync(OUT_SUM_JSONL, sumDocs.map(d => JSON.stringify(d)).join('\n'), 'utf8');

  // Строим эмбеддинги для текстовых полей
  const txEmb = await embedBatch(txDocs.map(d => d.text));
  const sumEmb = await embedBatch(sumDocs.map(d => d.text));
  const dims = txEmb[0]?.length || 1536;

  const txIndex = {
    model: EMB_MODEL,
    dims,
    createdAt: new Date().toISOString(),
    chunks: txDocs.map((d, i) => ({ id: d.id, text: d.text, embedding: txEmb[i], metadata: d.metadata })),
  };
  const sumIndex = {
    model: EMB_MODEL,
    dims,
    createdAt: new Date().toISOString(),
    chunks: sumDocs.map((d, i) => ({ id: d.id, text: d.text, embedding: sumEmb[i], metadata: d.metadata })),
  };

  fs.writeFileSync(OUT_TX_INDEX, JSON.stringify(txIndex), 'utf8');
  fs.writeFileSync(OUT_SUM_INDEX, JSON.stringify(sumIndex), 'utf8');
  console.log('Индексы построены:', OUT_TX_INDEX, 'и', OUT_SUM_INDEX);
}

main().catch(err => {
  console.error('Ошибка build-transactions-rag:', err);
  process.exit(1);
});
