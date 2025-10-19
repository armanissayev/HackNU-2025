// Structured data executor over CSV for math/aggregation questions
// Parses src/data/user-transactions.csv in the browser and computes sums/aggregations

export interface StructuredQuery {
  startDate?: string; // ISO yyyy-mm-dd
  endDate?: string;   // ISO yyyy-mm-dd
  year?: number;
  month?: number;
  category?: string;
  merchant?: string;
  currency?: string;
}

export interface StructuredResult {
  ok: boolean;
  answer?: string; // concise snippet for LLM context
  numbers?: Record<string, number>;
  rowsUsed?: number;
}

interface Row {
  date: Date;
  category: string;
  description: string;
  amount: number;
  currency: string;
}

function within(d: Date, q: StructuredQuery): boolean {
  if (q.year && d.getUTCFullYear() !== q.year) return false;
  if (q.month && d.getUTCMonth()+1 !== q.month) return false;
  const ymd = (x: Date) => x.toISOString().slice(0,10);
  if (q.startDate && ymd(d) < q.startDate) return false;
  if (q.endDate && ymd(d) > q.endDate) return false;
  return true;
}

function normCategory(s: string) {
  const c = (s||'').toLowerCase();
  if (c.includes('product') || c.includes('продукт')) return 'groceries';
  if (c.includes('cafe') || c.includes('ресторан')) return 'food_out';
  if (c.includes('diesel') || c.includes('fuel')) return 'transport';
  if (c.includes('accommodation') || c.includes('rent')) return 'housing';
  if (c.includes('entertainment')) return 'entertainment';
  if (c.includes('subscription') || c.includes('подпис')) return 'subscription';
  return c;
}

function parseCSV(raw: string): Row[] {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const header = lines[0].split(',').map(h => h.trim());
  const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const idxDate = idx('date');
  const idxCat = idx('category');
  const idxDesc = idx('description') >= 0 ? idx('description') : idx('merchant');
  const idxAmount = header.findIndex(h => h.toLowerCase() === 'amount' || h.toLowerCase().startsWith('amount'));
  const idxCurrency = header.findIndex(h => h.toLowerCase() === 'currency');

  const out: Row[] = [];
  for (let i=1;i<lines.length;i++) {
    const parts = lines[i].split(',');
    if (!parts.length) continue;
    const date = new Date((parts[idxDate]||'').trim());
    const category = (parts[idxCat]||'').trim();
    const description = (parts[idxDesc]||'').trim();
    const currency = (idxCurrency>=0?parts[idxCurrency]:'KZT')?.trim() || 'KZT';
    const amountStr = String(parts[idxAmount]||'').replace(/[^0-9+\-.,]/g,'').replace(/,/g,'.');
    const amount = Number(amountStr);
    if (!isFinite(amount) || isNaN(date.getTime())) continue;
    out.push({ date, category, description, amount, currency });
  }
  return out;
}

export async function runStructuredQuery(q: StructuredQuery): Promise<StructuredResult> {
  try {
    const url = new URL('../data/user-transactions.csv', import.meta.url).toString();
    const res = await fetch(url);
    if (!res.ok) return { ok: false };
    const raw = await res.text();
    const rows = parseCSV(raw);
    let filtered = rows.filter(r => within(r.date, q));
    if (q.category) filtered = filtered.filter(r => normCategory(r.category) === q.category);
    if (q.merchant) filtered = filtered.filter(r => r.description.toLowerCase().includes(q.merchant!.toLowerCase()));
    if (q.currency) filtered = filtered.filter(r => (r.currency||'').toUpperCase() === q.currency);

    // Totals
    let income = 0, expense = 0;
    for (const r of filtered) {
      if (r.amount >= 0) income += r.amount; else expense += Math.abs(r.amount);
    }
    const net = income - expense;

    const period = q.year && q.month ? `${q.year}-${String(q.month).padStart(2,'0')}` : (q.year ? `${q.year}` : (q.startDate && q.endDate ? `${q.startDate}..${q.endDate}` : 'period'));
    const catPart = q.category ? ` for category ${q.category}` : '';
    const merchPart = q.merchant ? ` at merchant ${q.merchant}` : '';
    const curr = q.currency || 'KZT';
    const answer = `For ${period}${catPart}${merchPart}, income = ${income} ${curr}, expenses = ${expense} ${curr}, net = ${net} ${curr}.`;

    return { ok: true, answer, numbers: { income, expense, net }, rowsUsed: filtered.length };
  } catch {
    return { ok: false };
  }
}
