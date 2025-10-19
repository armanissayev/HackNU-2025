import React, { useEffect, useMemo, useState } from 'react';
import { ZButton } from './ZButton';
import { ZCard } from './ZCard';
import { TrendingUp, TrendingDown, DollarSign, PieChart, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart as RechartsPie, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface AnalysisPageProps {
  onNavigate: (page: string) => void;
}

interface Transaction {
  date: Date;
  category: string;
  merchant: string;
  amount: number; // KZT, positive for income, negative for expense in CSV
  note?: string;
  type?: string; // optional: 'доход' | 'расход' or similar
}

const CATEGORY_COLORS: Record<string, string> = {
  housing: '#2D9A86',
  groceries: '#1A5C50',
  transport: '#EEFF6D',
  shopping: '#475B53',
  utilities: '#E9F2EF',
  food_out: '#7FB8AD',
  health: '#B5CDC6',
  education: '#94A39E',
  charity: '#C6D8D2',
  subscriptions: '#6FA89E',
  savings: '#D6F5E3',
  entertainment: '#F2C94C',
  transfer: '#D0E2DD',
  other: '#A1B7B1',
};

const RU_MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

function formatKZT(value: number) {
  return new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(value);
}

function parseCSV(text: string): Transaction[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];

  // Parse header flexibly to support both schemas:
  // A) date,category,merchant,city,method,amount,note
  // B) date,category,merchant,amount (₸)
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idxDate = header.findIndex(h => h === 'date');
  const idxCategory = header.findIndex(h => h === 'category');
  const idxMerchant = header.findIndex(h => h === 'merchant' || h === 'description');
  const idxType = header.findIndex(h => h === 'type'); // optional
  // find column that starts with 'amount'
  const idxAmount = header.findIndex(h => h === 'amount' || h.startsWith('amount'));

  const out: Transaction[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(',');

    const dateStr = parts[idxDate] ?? '';
    const category = (parts[idxCategory] ?? '').trim();
    const merchant = (parts[idxMerchant] ?? '').trim();
    const type = idxType >= 0 ? String(parts[idxType] ?? '').trim() : undefined;
    const amountStr = (parts[idxAmount] ?? '').replace(/[^0-9+\-.,]/g, '').replace(',', '.');

    const amount = Number(amountStr);
    const date = new Date(dateStr);
    if (!isFinite(amount) || isNaN(date.getTime())) continue;

    out.push({ date, category, merchant, amount, type });
  }
  return out;
}

function normalizeCat(cat: string): string {
  const c = (cat || '').toLowerCase();
  switch (c) {
    // English (general)
    case 'dining': return 'food_out';
    case 'rent': return 'housing';
    case 'subscription': return 'subscriptions';
    case 'subscriptions': return 'subscriptions';
    case 'utilities': return 'utilities';
    case 'groceries': return 'groceries';
    case 'transport': return 'transport';
    case 'shopping': return 'shopping';
    case 'health': return 'health';
    case 'education': return 'education';
    case 'charity': return 'charity';
    case 'salary': return 'income_salary';
    case 'transfer': return 'transfer';
    // English (dataset-specific)
    case 'accommodation': return 'housing';
    case 'products': return 'groceries';
    case 'savings': return 'savings';
    case 'cafe': return 'food_out';
    case 'toys': return 'shopping';
    case 'diesel': return 'transport';
    case 'entertainment': return 'entertainment';
    case 'taxi income': return 'income_taxi';
    // Russian expense categories mapping
    case 'аренда': return 'housing';
    case 'продукты': return 'groceries';
    case 'транспорт': return 'transport';
    case 'одежда': return 'shopping';
    case 'коммунальные': return 'utilities';
    case 'связь': return 'utilities';
    case 'здоровье': return 'health';
    case 'образование': return 'education';
    case 'подписки': return 'subscriptions';
    case 'развлечения': return 'entertainment';
    case 'разное': return 'other';
    default: return c || 'other';
  }
}

function isIncomeCat(cat: string): boolean {
  const c = (cat || '').toLowerCase();
  if (c.startsWith('income_')) return true;
  // English
  if (c === 'salary' || c === 'income' || c === 'bonus' || c === 'cashback' || c === 'return' || c === 'interest') return true;
  // Russian income categories
  if (c === 'зарплата' || c === 'кэшбек' || c === 'возврат' || c === 'проценты' || c === 'бонус') return true;
  return false;
}

function isIncome(t: Transaction): boolean {
  // Prefer explicit type when available (supports Russian "доход")
  const type = (t.type || '').toLowerCase();
  if (type === 'доход' || type === 'income') return true;
  if (type === 'расход' || type === 'expense') return false;
  // Then use category-based rules (supports English and Russian)
  if (isIncomeCat(t.category)) return true;
  // Heuristic by keywords in category/merchant (do not rely on sign)
  const catStr = String(t.category || '');
  const merchStr = String(t.merchant || '');
  const incomeRe = /(income|зарплат|доход|поступлен|перевод|cash\s*back|cashback|кэшбэк|кешбэк|процент(ы)?|interest|bonus|бонус)/i;
  if (incomeRe.test(catStr) || incomeRe.test(merchStr)) return true;
  return false;
}

// Moved to top-level so it can be used by computeBaseMetrics and other helpers
function mapCategoryRu(cat: string): string {
  const key = normalizeCat(cat);
  switch (key) {
    case 'housing': return 'Жильё';
    case 'groceries': return 'Продукты';
    case 'transport': return 'Транспорт';
    case 'shopping': return 'Покупки';
    case 'utilities': return 'Коммунальные';
    case 'food_out': return 'Еда вне дома';
    case 'health': return 'Здоровье';
    case 'education': return 'Образование';
    case 'charity': return 'Благотворительность';
    case 'subscriptions': return 'Подписки';
    case 'savings': return 'Сбережения';
    case 'entertainment': return 'Развлечения';
    case 'transfer': return 'Переводы';
    case 'income_salary': return 'Зарплата';
    default: return 'Другое';
  }
}

// Utility types for comparison users
interface UserReportSummary {
  id: string; // filename/id
  label: string; // human label derived from filename
  totals: { TI: number; TE: number; NET: number; S: number; SR: number };
  sharesByCat: { key: string; name: string; sum: number; share: number; count: number; avgTicket: number }[];
  envelope: { E_fact: number; D_fact: number; S_fact: number };
  trends: {
    monthKey: string;
    totalExpense: number;
    deltaAbs: number;
    deltaPct: number;
  }[];
  llmSummary?: string | null; // model-generated short summary
}

function ymKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function sumBy<T>(arr: T[], sel: (x: T) => number) { return arr.reduce((s, x) => s + sel(x), 0); }

function computeBaseMetrics(txns: Transaction[]) {
  // TI, TE, NET, S, SR, shares, counts, avg tickets
  const expensesOnly = txns.filter(t => !isIncome(t));
  const incomeOnly = txns.filter(t => isIncome(t));
  const TI = sumBy(incomeOnly, t => Math.abs(t.amount));
  const TE = sumBy(expensesOnly, t => Math.abs(t.amount));
  const NET = TI - TE;
  const S = Math.max(NET, 0);
  const SR = TI > 0 ? (S / TI) : 0;

  // by category (expenses)
  const byCat = new Map<string, { key: string; name: string; sum: number; count: number }>();
  for (const t of expensesOnly) {
    const key = normalizeCat(t.category);
    const row = byCat.get(key) || { key, name: t.category, sum: 0, count: 0 };
    row.sum += Math.abs(t.amount);
    row.count += 1;
    byCat.set(key, row);
  }
  const sharesByCat = Array.from(byCat.values()).map(r => ({
    key: r.key,
    name: mapCategoryRu(r.name),
    sum: r.sum,
    share: TE > 0 ? (r.sum / TE) : 0,
    count: r.count,
    avgTicket: r.count > 0 ? (r.sum / r.count) : 0,
  })).sort((a,b) => b.sum - a.sum);

  return { TI, TE, NET, S, SR, sharesByCat };
}

function computeTrendsMoM(txns: Transaction[]) {
  // aggregate expense by month
  const expenses = txns.filter(t => !isIncome(t));
  const map = new Map<string, number>();
  for (const t of expenses) {
    const key = ymKey(t.date);
    map.set(key, (map.get(key) || 0) + Math.abs(t.amount));
  }
  const months = Array.from(map.entries()).sort((a,b) => a[0] < b[0] ? -1 : 1);
  const out: { monthKey: string; totalExpense: number; deltaAbs: number; deltaPct: number }[] = [];
  for (let i=0;i<months.length;i++) {
    const [key, val] = months[i];
    const prev = i>0 ? months[i-1][1] : 0;
    const deltaAbs = val - prev;
    const denom = Math.max(1, prev);
    const deltaPct = (val - prev) / denom;
    out.push({ monthKey: key, totalExpense: val, deltaAbs, deltaPct });
  }
  return out;
}

function computeEnvelopeShares(TI: number, sharesByCat: { key: string; sum: number }[], S: number) {
  // Essentials E: Rent, Utilities, Groceries, Transport
  const E_KEYS = new Set(['housing','utilities','groceries','transport']);
  // Discretionary D: FoodOut, Taxi(extra)=transport? keep food_out + entertainment + shopping + subscriptions + charity + health + education (non-essential)
  const D_KEYS = new Set(['food_out','entertainment','shopping','subscriptions','charity','health','education']);
  const sumE = sharesByCat.filter(x => E_KEYS.has(x.key)).reduce((s,x)=>s+x.sum,0);
  const sumD = sharesByCat.filter(x => D_KEYS.has(x.key)).reduce((s,x)=>s+x.sum,0);
  const E_fact = TI>0 ? (sumE / TI) : 0;
  const D_fact = TI>0 ? (sumD / TI) : 0;
  const S_fact = TI>0 ? (S / TI) : 0;
  return { E_fact, D_fact, S_fact };
}

const CHAT_API = 'https://openai-hub.neuraldeep.tech/v1/chat/completions';
const API_KEY = 'sk-roG3OusRr0TLCHAADks6lw';

export function AnalysisPage({ onNavigate }: AnalysisPageProps) {
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [txns, setTxns] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [others, setOthers] = useState<UserReportSummary[] | null>(null);
  const [loadingSummaries, setLoadingSummaries] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const url = new URL('../data/user-transactions.csv', import.meta.url);
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error('Не удалось загрузить данные транзакций');
        return r.text();
      })
      .then(text => setTxns(parseCSV(text)))
      .catch(e => setError(e.message || 'Ошибка загрузки'));
  }, []);

  // Parse monthly aggregate user-report CSV into synthetic transactions
  function parseUserReportCSV(text: string): Transaction[] {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length <= 1) return [];
    const header = lines[0].split(',').map(h => h.trim());
    // Expected columns: Month,Year,Salary,AdditionalIncome,TotalIncome,Housing,Products,Utilities,Transport,Gym,Savings,DiscretionarySpending,TotalExpenses,UnspentBalance
    // But we will find indices defensively by name (case-insensitive, ignoring spaces)
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g,'');
    const hIdx = (name: string) => header.findIndex(h => norm(h) === norm(name));
    const idxMonth = hIdx('Month');
    const idxYear = hIdx('Year');
    const idxSalary = hIdx('Salary');
    const idxAddInc = hIdx('AdditionalIncome');
    const idxHousing = hIdx('Housing');
    const idxProducts = hIdx('Products');
    const idxUtilities = hIdx('Utilities');
    const idxTransport = hIdx('Transport');
    const idxGym = hIdx('Gym');
    const idxSavings = hIdx('Savings');
    const idxDisc = hIdx('DiscretionarySpending');

    const monthToIndex: Record<string, number> = {
      'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
      'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
    };

    const tx: Transaction[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      if (!row || !row.trim()) continue;
      const parts = row.split(',');
      const monthName = String(parts[idxMonth] || '').trim().toLowerCase();
      const yearStr = String(parts[idxYear] || '').trim();
      const year = Number(yearStr);
      const mIdx = monthToIndex[monthName];
      if (!(year > 1900) || mIdx === undefined) continue;
      const date = new Date(Date.UTC(year, mIdx, 1));
      // helper to parse numeric cell
      const num = (v: any) => Number(String(v || '0').replace(/[^0-9+\-.,]/g,'').replace(/,/g,'.')) || 0;

      // Income entries
      if (idxSalary >= 0) {
        const amt = num(parts[idxSalary]);
        if (amt) tx.push({ date, category: 'income_salary', merchant: 'Salary', amount: Math.abs(amt), type: 'income' });
      }
      if (idxAddInc >= 0) {
        const amt = num(parts[idxAddInc]);
        if (amt) tx.push({ date, category: 'income_other', merchant: 'Additional income', amount: Math.abs(amt), type: 'income' });
      }

      // Expense entries (as negative amount convention is not required; we classify with isIncome)
      if (idxHousing >= 0) {
        const amt = num(parts[idxHousing]);
        if (amt) tx.push({ date, category: 'housing', merchant: 'Housing', amount: -Math.abs(amt), type: 'expense' });
      }
      if (idxProducts >= 0) {
        const amt = num(parts[idxProducts]);
        if (amt) tx.push({ date, category: 'groceries', merchant: 'Groceries', amount: -Math.abs(amt), type: 'expense' });
      }
      if (idxUtilities >= 0) {
        const amt = num(parts[idxUtilities]);
        if (amt) tx.push({ date, category: 'utilities', merchant: 'Utilities', amount: -Math.abs(amt), type: 'expense' });
      }
      if (idxTransport >= 0) {
        const amt = num(parts[idxTransport]);
        if (amt) tx.push({ date, category: 'transport', merchant: 'Transport', amount: -Math.abs(amt), type: 'expense' });
      }
      if (idxGym >= 0) {
        const amt = num(parts[idxGym]);
        if (amt) tx.push({ date, category: 'health', merchant: 'Gym', amount: -Math.abs(amt), type: 'expense' });
      }
      if (idxSavings >= 0) {
        const amt = num(parts[idxSavings]);
        if (amt) tx.push({ date, category: 'savings', merchant: 'Savings', amount: -Math.abs(amt), type: 'expense' });
      }
      if (idxDisc >= 0) {
        const amt = num(parts[idxDisc]);
        if (amt) tx.push({ date, category: 'shopping', merchant: 'Discretionary', amount: -Math.abs(amt), type: 'expense' });
      }
    }
    return tx;
  }

  // Map report filenames to human-friendly user names
  const REPORT_NAME: Record<string, string> = {
    'UPDATED_model1_single_man_Almaty_Nov2024-Oct2025_gym_only.csv': 'Aibek',
    'income_outcome_rural_single_mother_2kids_Nov2024_Oct2025_savings70.csv': 'Aisha',
    'income_outcome_single_father1kid_rural_Nov2024_Oct2025_v2_decreased.csv': 'Nurlan',
    'income_outcome_student_half_time_Astana_Nov2024_Oct2025_parent70.csv': 'Dana',
    'Model_A_Urban_couple_with_1_child_Astana_Nov_2024_to_Oct_2025.csv': 'Yerlan',
    'astana_woman_family_income_outcome_12m (1).csv': 'Zhadyra',
    'income_outcome_almaty_family3_Nov2024_Oct2025_diesel_var.csv': 'Almaz family'
  };

  // Helper to build prompt and request LLM summary for a report
  async function summarizeReport(report: UserReportSummary): Promise<string | null> {
    try {
      // Compose a compact Russian prompt with key numbers
      const topCats = report.sharesByCat.slice(0, 3).map(c => `${mapCategoryRu(c.key)} — ${formatKZT(c.sum)} (${(c.share*100).toFixed(0)}%)`).join('; ');
      const lastTrend = report.trends[report.trends.length - 1];
      const trendText = lastTrend ? `Последний месяц расходы ${formatKZT(lastTrend.totalExpense)}, изменение ${formatKZT(lastTrend.deltaAbs)} (${(lastTrend.deltaPct*100).toFixed(1)}%).` : '';
      const sys = 'Ты — доброжелательный финансовый ассистент. Тебе дали финансовый отчет другого человека. Сравни его с моим и дай мне несколько практических советов, которые могу перенять у этого человека. Отвечай по-русски, коротко (3–5 предложений), без воды. Дай выводы и 1–2 практичных совета.';
      const usr = `Сводка по пользователю ${report.label}:
Доход (TI): ${formatKZT(report.totals.TI)}
Расход (TE): ${formatKZT(report.totals.TE)}
Чистый (NET): ${formatKZT(report.totals.NET)}
Сбережения (S): ${formatKZT(report.totals.S)}
Ставка сбережений (SR): ${(report.totals.SR*100).toFixed(1)}%
Envelope фактически: Essentials ${(report.envelope.E_fact*100).toFixed(0)}%, Discretionary ${(report.envelope.D_fact*100).toFixed(0)}%, Savings ${(report.envelope.S_fact*100).toFixed(0)}%
Топ категории: ${topCats}
${trendText}
Сформулируй короткий вывод об устойчивости бюджета и дай 1–2 совета по тому, как я могу интегрировать их привычки себе чтобы оптимизировать свой финаносвый менеджмент. Адрессуй эти советы именно мне.`;

      const res = await fetch(CHAT_API, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: usr },
          ],
          temperature: 0.2,
          max_tokens: 220,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const txt = data?.choices?.[0]?.message?.content?.trim?.();
      return txt || null;
    } catch {
      return null;
    }
  }

  // Load other users' reports and compute summaries, then ask LLM to summarize
  useEffect(() => {
    const files = [
      'UPDATED_model1_single_man_Almaty_Nov2024-Oct2025_gym_only.csv',
      'income_outcome_rural_single_mother_2kids_Nov2024_Oct2025_savings70.csv',
      'income_outcome_single_father1kid_rural_Nov2024_Oct2025_v2_decreased.csv',
      'income_outcome_student_half_time_Astana_Nov2024_Oct2025_parent70.csv',
      'Model_A_Urban_couple_with_1_child_Astana_Nov_2024_to_Oct_2025.csv',
      'astana_woman_family_income_outcome_12m (1).csv',
      'income_outcome_almaty_family3_Nov2024_Oct2025_diesel_var.csv',
    ];
    Promise.all(files.map(async (f) => {
      const url = new URL(`../data/users-reports/${f}`, import.meta.url);
      const txt = await fetch(url).then(r => r.text());
      const parsed = parseUserReportCSV(txt);
      const base = computeBaseMetrics(parsed);
      const trends = computeTrendsMoM(parsed);
      const envelope = computeEnvelopeShares(base.TI, base.sharesByCat, base.S);
      const label = REPORT_NAME[f] || f.replace(/_/g,' ').replace(/\.csv$/,'');
      const id = f;
      const summary: UserReportSummary = {
        id,
        label,
        totals: { TI: base.TI, TE: base.TE, NET: base.NET, S: base.S, SR: base.SR },
        sharesByCat: base.sharesByCat,
        envelope,
        trends,
        llmSummary: null,
      };
      return summary;
    })).then(async (arr) => {
      setOthers(arr);
      // Sequentially request LLM summaries to avoid rate limits
      for (const r of arr) {
        setLoadingSummaries(prev => ({ ...prev, [r.id]: true }));
        const s = await summarizeReport(r);
        setOthers(curr => (curr || []).map(x => x.id === r.id ? { ...x, llmSummary: s } : x));
        setLoadingSummaries(prev => ({ ...prev, [r.id]: false }));
        await new Promise(res => setTimeout(res, 200));
      }
    }).catch(() => setOthers([]));
  }, []);

  const { monthlyData, categoryData, totals, recent, catIncomeOutcome } = useMemo(() => {
    if (!txns) return {
      monthlyData: [] as { monthKey: string; month: string; income: number; outcome: number }[],
      categoryData: [] as { name: string; value: number; color: string }[],
      totals: { income: 0, outcome: 0, balance: 0 },
      recent: [] as { name: string; amount: number; type: 'income' | 'outcome'; date: string }[],
      catIncomeOutcome: [] as { key: string; name: string; income: number; outcome: number; net: number }[],
    };

    // Sort by date asc
    const sorted = [...txns].sort((a,b) => a.date.getTime() - b.date.getTime());

    // Group by YYYY-MM
    const byMonth = new Map<string, { income: number; outcome: number }>();
    for (const t of sorted) {
      const y = t.date.getFullYear();
      const m = t.date.getMonth();
      const key = `${y}-${String(m+1).padStart(2,'0')}`;
      const bucket = byMonth.get(key) || { income: 0, outcome: 0 };
      const amt = Math.abs(t.amount);
      if (isIncome(t)) {
        bucket.income += amt; // treat as positive income
      } else {
        bucket.outcome += amt; // treat everything else as spending (incl. transfers)
      }
      byMonth.set(key, bucket);
    }

    const monthlyData = Array.from(byMonth.entries())
      .sort((a,b) => a[0] < b[0] ? -1 : 1)
      .map(([key, v]) => {
        const [y, mm] = key.split('-');
        const monthIdx = Number(mm) - 1;
        return { monthKey: key, month: RU_MONTHS_SHORT[monthIdx], income: v.income, outcome: v.outcome };
      });

    // Category breakdown for expenses only (for pie)
    const byCatExpense = new Map<string, number>();
    // And build combined income/outcome per original category label
    const byCatIO = new Map<string, { income: number; outcome: number }>();
    for (const t of txns) {
      const catRaw = t.category || 'other';
      const io = byCatIO.get(catRaw) || { income: 0, outcome: 0 };
      if (isIncome(t)) {
        io.income += Math.abs(t.amount);
      } else {
        io.outcome += Math.abs(t.amount);
        byCatExpense.set(catRaw, (byCatExpense.get(catRaw) || 0) + Math.abs(t.amount));
      }
      byCatIO.set(catRaw, io);
    }
    const categoryData = Array.from(byCatExpense.entries()).map(([name, value]) => {
      const key = normalizeCat(name);
      return {
        name: mapCategoryRu(name),
        value,
        color: CATEGORY_COLORS[key] || CATEGORY_COLORS.other,
      };
    });

    // Prepare income/outcome by categories (group by normalized key but keep readable name)
    const aggByKey = new Map<string, { key: string; name: string; income: number; outcome: number }>();
    for (const [name, vals] of byCatIO.entries()) {
      const key = normalizeCat(name);
      const prev = aggByKey.get(key) || { key, name: mapCategoryRu(name), income: 0, outcome: 0 };
      prev.income += vals.income;
      prev.outcome += vals.outcome;
      aggByKey.set(key, prev);
    }
    const catIncomeOutcome = Array.from(aggByKey.values())
      .map(v => ({ ...v, net: v.income - v.outcome }))
      .sort((a, b) => b.outcome - a.outcome);

    const totalsIncome = monthlyData.reduce((s, m) => s + m.income, 0);
    const totalsOutcome = monthlyData.reduce((s, m) => s + m.outcome, 0);

    // Recent transactions: latest 4
    const recentSorted = [...txns]
      .sort((a,b) => b.date.getTime() - a.date.getTime())
      .slice(0, 4)
      .map(t => ({
        name: t.merchant || t.category,
        amount: Math.abs(t.amount),
        type: (isIncome(t) ? 'income' : 'outcome') as const,
        date: `${RU_MONTHS_SHORT[t.date.getMonth()]} ${String(t.date.getDate()).padStart(2,'0')}`,
      }));

    return {
      monthlyData,
      categoryData,
      totals: { income: totalsIncome, outcome: totalsOutcome, balance: totalsIncome - totalsOutcome },
      recent: recentSorted,
    };
  }, [txns]);


  const totalIncome = totals.income;
  const totalOutcome = totals.outcome;
  const balance = totals.balance;

  // Build current user summary for comparison using all txns
  const mySummary: UserReportSummary | null = useMemo(() => {
    if (!txns) return null;
    const base = computeBaseMetrics(txns);
    const envelope = computeEnvelopeShares(base.TI, base.sharesByCat, base.S);
    const trends = computeTrendsMoM(txns);
    return {
      id: 'me',
      label: 'Текущий пользователь',
      totals: { TI: base.TI, TE: base.TE, NET: base.NET, S: base.S, SR: base.SR },
      sharesByCat: base.sharesByCat,
      envelope,
      trends,
    };
  }, [txns]);

  function pct(n: number) { return (n*100).toFixed(1) + '%'; }

  return (
    <div className="min-h-screen bg-[#E9F2EF] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-[#0B1F1A]" style={{ fontSize: '32px', fontWeight: 700 }}>
              Финансовая аналитика
            </h1>
            <p className="text-[#475B53]" style={{ fontSize: '16px' }}>
              Отслеживайте ваши доходы и расходы
            </p>
          </div>
          <div className="flex gap-2">
            <ZButton variant="secondary" onClick={() => onNavigate('chat')}>
              Назад к чату
            </ZButton>
            <ZButton variant="accent" onClick={() => onNavigate('profile')}>
              Профиль
            </ZButton>
          </div>
        </div>

        {!txns && !error && (
          <div className="mb-4 p-4 bg-white border border-[#E9F2EF] rounded-xl text-[#475B53]">Загрузка данных...</div>
        )}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">{error}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <ZCard>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#475B53] mb-2" style={{ fontSize: '14px' }}>Всего доходов</p>
                <p className="text-[#0B1F1A] mb-2" style={{ fontSize: '32px', fontWeight: 700 }}>
                  {formatKZT(totalIncome)}
                </p>
                <div className="flex items-center gap-1 text-[#2D9A86]">
                  <ArrowUpRight className="w-4 h-4" />
                  <span style={{ fontSize: '14px' }}>+12.5% к прошлому месяцу</span>
                </div>
              </div>
              <div className="w-12 h-12 bg-[#E9F2EF] rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-[#2D9A86]" />
              </div>
            </div>
          </ZCard>

          <ZCard>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#475B53] mb-2" style={{ fontSize: '14px' }}>Всего расходов</p>
                <p className="text-[#0B1F1A] mb-2" style={{ fontSize: '32px', fontWeight: 700 }}>
                  {formatKZT(totalOutcome)}
                </p>
                <div className="flex items-center gap-1 text-[#1A5C50]">
                  <ArrowDownRight className="w-4 h-4" />
                  <span style={{ fontSize: '14px' }}>+8.3% к прошлому месяцу</span>
                </div>
              </div>
              <div className="w-12 h-12 bg-[#E9F2EF] rounded-xl flex items-center justify-center">
                <TrendingDown className="w-6 h-6 text-[#1A5C50]" />
              </div>
            </div>
          </ZCard>

          <ZCard>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#475B53] mb-2" style={{ fontSize: '14px' }}>Чистый баланс</p>
                <p className="text-[#0B1F1A] mb-2" style={{ fontSize: '32px', fontWeight: 700 }}>
                  {formatKZT(balance)}
                </p>
                <div className="flex items-center gap-1 text-[#2D9A86]">
                  <DollarSign className="w-4 h-4" />
                  <span style={{ fontSize: '14px' }}>Положительный баланс</span>
                </div>
              </div>
              <div className="w-12 h-12 bg-[#EEFF6D] rounded-xl flex items-center justify-center">
                <PieChart className="w-6 h-6 text-[#0B1F1A]" />
              </div>
            </div>
          </ZCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <ZCard>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-[#0B1F1A]" style={{ fontSize: '24px', fontWeight: 700 }}>
                Доходы vs Расходы
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setPeriod('month')}
                  className={`px-3 py-1 rounded-lg transition-colors ${
                    period === 'month' 
                      ? 'bg-[#2D9A86] text-white' 
                      : 'bg-[#E9F2EF] text-[#475B53]'
                  }`}
                  style={{ fontSize: '14px' }}
>
                  Месяц
                </button>
                <button
                  onClick={() => setPeriod('year')}
                  className={`px-3 py-1 rounded-lg transition-colors ${
                    period === 'year' 
                      ? 'bg-[#2D9A86] text-white' 
                      : 'bg-[#E9F2EF] text-[#475B53]'
                  }`}
                  style={{ fontSize: '14px' }}
                >
                  Год
                </button>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E9F2EF" />
                <XAxis dataKey="month" stroke="#475B53" style={{ fontSize: '14px' }} />
                <YAxis stroke="#475B53" style={{ fontSize: '14px' }} tickFormatter={(v) => new Intl.NumberFormat('ru-KZ').format(Number(v))} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#FFFFFF', 
                    border: '1px solid #E9F2EF',
                    borderRadius: '12px',
                    boxShadow: '0 10px 30px rgba(13, 46, 40, 0.08)'
                  }}
                  formatter={(value: any, name: any, props: any) => [formatKZT(Number(value)), props?.dataKey === 'income' ? 'Доход' : 'Расход']}
                />
                <Legend wrapperStyle={{ fontSize: '14px' }} />
                <Line 
                  type="monotone" 
                  dataKey="income" 
                  name="Доходы"
                  stroke="#2D9A86" 
                  strokeWidth={3}
                  dot={{ fill: '#2D9A86', r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="outcome" 
                  name="Расходы"
                  stroke="#1A5C50" 
                  strokeWidth={3}
                  dot={{ fill: '#1A5C50', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ZCard>

          <ZCard>
            <h2 className="text-[#0B1F1A] mb-6" style={{ fontSize: '24px', fontWeight: 700 }}>
              Расходы по категориям
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPie>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#FFFFFF', 
                    border: '1px solid #E9F2EF',
                    borderRadius: '12px',
                    boxShadow: '0 10px 30px rgba(13, 46, 40, 0.08)'
                  }}
                  formatter={(value: any) => [formatKZT(Number(value)), 'Сумма']}
                />
              </RechartsPie>
            </ResponsiveContainer>
          </ZCard>
        </div>

        <ZCard>
          <h2 className="text-[#0B1F1A] mb-6" style={{ fontSize: '24px', fontWeight: 700 }}>
            Сравнение по месяцам
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E9F2EF" />
              <XAxis dataKey="month" stroke="#475B53" style={{ fontSize: '14px' }} />
              <YAxis stroke="#475B53" style={{ fontSize: '14px' }} tickFormatter={(v) => new Intl.NumberFormat('ru-KZ').format(Number(v))} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#FFFFFF', 
                  border: '1px solid #E9F2EF',
                  borderRadius: '12px',
                  boxShadow: '0 10px 30px rgba(13, 46, 40, 0.08)'
                }}
                formatter={(value: any, name: any, props: any) => [formatKZT(Number(value)), props?.dataKey === 'income' ? 'Доход' : 'Расход']}
              />
              <Legend wrapperStyle={{ fontSize: '14px' }} />
              <Bar dataKey="income" name="Доходы" fill="#2D9A86" radius={[8, 8, 0, 0]} />
              <Bar dataKey="outcome" name="Расходы" fill="#1A5C50" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ZCard>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <ZCard>
            <h2 className="text-[#0B1F1A] mb-4" style={{ fontSize: '24px', fontWeight: 700 }}>
              Последние транзакции
            </h2>
            <div className="space-y-3">
              {recent.map((transaction, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-[#E9F2EF] rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      transaction.type === 'income' ? 'bg-[#2D9A86]' : 'bg-[#1A5C50]'
                    }`}>
                      {transaction.type === 'income' ? (
                        <ArrowUpRight className="w-5 h-5 text-white" />
                      ) : (
                        <ArrowDownRight className="w-5 h-5 text-white" />
                      )}
                    </div>
                    <div>
                      <p className="text-[#0B1F1A]" style={{ fontSize: '16px' }}>{transaction.name}</p>
                      <p className="text-[#475B53]" style={{ fontSize: '14px' }}>{transaction.date}</p>
                    </div>
                  </div>
                  <p className={`${transaction.type === 'income' ? 'text-[#2D9A86]' : 'text-[#1A5C50]'}`} style={{ fontSize: '16px', fontWeight: 700 }}>
                    {transaction.type === 'income' ? '+' : '-'}{formatKZT(transaction.amount)}
                  </p>
                </div>
              ))}
            </div>
          </ZCard>

          <ZCard>
            <h2 className="text-[#0B1F1A] mb-4" style={{ fontSize: '24px', fontWeight: 700 }}>
              Цели накоплений
            </h2>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-[#475B53]" style={{ fontSize: '14px' }}>Резервный фонд</span>
                  <span className="text-[#0B1F1A]" style={{ fontSize: '14px', fontWeight: 700 }}>75%</span>
                </div>
                <div className="w-full h-3 bg-[#E9F2EF] rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[#2D9A86] to-[#EEFF6D]" style={{ width: '75%' }}></div>
                </div>
                <p className="text-[#475B53] mt-1" style={{ fontSize: '14px' }}>{formatKZT(750000)} из {formatKZT(1000000)}</p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-[#475B53]" style={{ fontSize: '14px' }}>Отпуск</span>
                  <span className="text-[#0B1F1A]" style={{ fontSize: '14px', fontWeight: 700 }}>45%</span>
                </div>
                <div className="w-full h-3 bg-[#E9F2EF] rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[#2D9A86] to-[#EEFF6D]" style={{ width: '45%' }}></div>
                </div>
                <p className="text-[#475B53] mt-1" style={{ fontSize: '14px' }}>{formatKZT(270000)} из {formatKZT(600000)}</p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-[#475B53]" style={{ fontSize: '14px' }}>Новый автомобиль</span>
                  <span className="text-[#0B1F1A]" style={{ fontSize: '14px', fontWeight: 700 }}>30%</span>
                </div>
                <div className="w-full h-3 bg-[#E9F2EF] rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[#2D9A86] to-[#EEFF6D]" style={{ width: '30%' }}></div>
                </div>
                <p className="text-[#475B53] mt-1" style={{ fontSize: '14px' }}>{formatKZT(2400000)} из {formatKZT(8000000)}</p>
              </div>

              <ZButton variant="accent" className="w-full mt-4">
                Добавить цель
              </ZButton>
            </div>
          </ZCard>
        </div>

        {mySummary && (
          <ZCard className="mt-6">
            <h2 className="text-[#0B1F1A] mb-4" style={{ fontSize: '24px', fontWeight: 700 }}>
              Сравнение с другими пользователями
            </h2>
            <div className="mb-4 p-3 bg-[#E9F2EF] rounded-xl">
              <div className="flex flex-wrap gap-6 text-[#0B1F1A]" style={{ fontSize: '14px' }}>
                <div><b>Вы</b></div>
                <div>Доход TI: <b>{formatKZT(mySummary.totals.TI)}</b></div>
                <div>Расход TE: <b>{formatKZT(mySummary.totals.TE)}</b></div>
                <div>Нетто NET: <b>{formatKZT(mySummary.totals.NET)}</b></div>
                <div>Сбережения S: <b>{formatKZT(mySummary.totals.S)}</b></div>
                <div>Ставка SR: <b>{pct(mySummary.totals.SR)}</b></div>
                <div>Envelope фактический: E {pct(mySummary.envelope.E_fact)} · D {pct(mySummary.envelope.D_fact)} · S {pct(mySummary.envelope.S_fact)}</div>
                <div>Рекомендация: E≈50% · D≈30% · S≈20%</div>
              </div>
            </div>

            <div className="space-y-4">
              {(others||[]).map(o => (
                <div key={o.id} className="p-3 border border-[#E9F2EF] rounded-xl bg-white">
                  <div className="text-[#0B1F1A] mb-2" style={{ fontSize: '16px', fontWeight: 600 }}>{o.label}</div>
                  <div className="flex flex-wrap gap-6 text-[#475B53]" style={{ fontSize: '14px' }}>
                    <div>TI: <b className="text-[#0B1F1A]">{formatKZT(o.totals.TI)}</b></div>
                    <div>TE: <b className="text-[#0B1F1A]">{formatKZT(o.totals.TE)}</b></div>
                    <div>NET: <b className="text-[#0B1F1A]">{formatKZT(o.totals.NET)}</b></div>
                    <div>SR: <b className="text-[#0B1F1A]">{pct(o.totals.SR)}</b></div>
                    <div>Envelope: E {pct(o.envelope.E_fact)} · D {pct(o.envelope.D_fact)} · S {pct(o.envelope.S_fact)}</div>
                    {mySummary && (
                      <div>
                        Разница SR к вам: <b className="text-[#0B1F1A]">{( (o.totals.SR - mySummary.totals.SR)*100 ).toFixed(1)}%</b>
                      </div>
                    )}
                  </div>
                  {/* Simple MoM expense trend: show last two months delta */}
                  {o.trends.length >= 2 && (
                    <div className="mt-2 text-[#475B53]" style={{ fontSize: '13px' }}>
                      Тренд расходов (MoM): последний месяц {formatKZT(o.trends[o.trends.length-1].totalExpense)}; Δ = {formatKZT(o.trends[o.trends.length-1].deltaAbs)} ({pct(o.trends[o.trends.length-1].deltaPct)})
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t border-[#E9F2EF] text-[#0B1F1A]" style={{ fontSize: '14px' }}>
                    <div className="mb-1" style={{ fontWeight: 600 }}>ИИ‑комментарий</div>
                    {loadingSummaries[o.id] && !o.llmSummary && (
                      <div className="text-[#475B53]">Модель анализирует отчёт...</div>
                    )}
                    {!loadingSummaries[o.id] && o.llmSummary && (
                      <div className="whitespace-pre-wrap">{o.llmSummary}</div>
                    )}
                    {!loadingSummaries[o.id] && o.llmSummary === null && (
                      <div className="text-[#475B53]">Не удалось получить комментарий ИИ. Попробуйте обновить позже.</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ZCard>
        )}
      </div>
    </div>
  );
}
