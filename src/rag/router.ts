// Simple router and constraint extractor for dual-path retrieval
// Classifies queries as 'semantic' (lookup/why/what) or 'structured' (math/aggregation)

export type Route = 'semantic' | 'structured';

export interface Constraints {
  month?: number;
  year?: number;
  startDate?: string; // ISO
  endDate?: string;   // ISO
  category?: string;
  merchant?: string;
  currency?: string;
}

export interface RouteDecision {
  route: Route;
  constraints: Constraints;
}

const monthMap: Record<string, number> = {
  'january':1,'february':2,'march':3,'april':4,'may':5,'june':6,
  'july':7,'august':8,'september':9,'october':10,'november':11,'december':12,
  'январь':1,'февраль':2,'март':3,'апрель':4,'май':5,'июнь':6,'июль':7,'август':8,'сентябрь':9,'октябрь':10,'ноябрь':11,'декабрь':12,
};

function extractDate(q: string): Partial<Constraints> {
  const s = q.toLowerCase();
  const c: Partial<Constraints> = {};
  // year
  const y = s.match(/\b(20\d{2})\b/);
  if (y) c.year = Number(y[1]);
  // month by name
  for (const [name, num] of Object.entries(monthMap)) {
    if (s.includes(name)) { c.month = num; break; }
  }
  // absolute date range like 2024-07 or July 2024
  if (c.year && c.month) {
    const m = String(c.month).padStart(2, '0');
    c.startDate = `${c.year}-${m}-01`;
    const lastDay = new Date(Date.UTC(c.year, c.month, 0)).getUTCDate();
    c.endDate = `${c.year}-${m}-${String(lastDay).padStart(2,'0')}`;
  }
  return c;
}

function extractCategory(q: string): string | undefined {
  const s = q.toLowerCase();
  const hints = ['groceries','продукт','кафе','ресторан','food','housing','rent','transport','fuel','diesel','entertainment','подписк','subscription','связь','телеком'];
  for (const h of hints) if (s.includes(h)) return h.includes('продукт') ? 'groceries' : h.includes('кафе')||s.includes('ресторан')?'food_out': h;
  return undefined;
}

function extractMerchant(q: string): string | undefined {
  const s = q.toLowerCase();
  // simple vendor patterns
  const merch = s.match(/\b(spotify|netflix|uber|bolt|kaspi|yandex)\b/);
  return merch?.[1];
}

function extractCurrency(q: string): string | undefined {
  const s = q.toUpperCase();
  const m = s.match(/\b(KZT|USD|EUR|RUB)\b/);
  return m?.[1];
}

export function extractConstraints(query: string): Constraints {
  return {
    ...extractDate(query),
    category: extractCategory(query),
    merchant: extractMerchant(query),
    currency: extractCurrency(query),
  };
}

export function routeQuery(query: string): RouteDecision {
  const s = query.toLowerCase();
  const mathHints = ['how much','сколько','итого','сумма','total','avg','average','sum','net','итог','сколько потратил','сколько я потратил'];
  const whyWhat = ['what','why','кто','что','почему','когда','где'];
  const hasMath = mathHints.some(h => s.includes(h)) || /\b(\d+|percent|процент)\b/.test(s);
  const constraints = extractConstraints(query);
  if (hasMath) return { route: 'structured', constraints };
  // default to semantic for lookup/explanatory
  if (whyWhat.some(h => s.includes(h))) return { route: 'semantic', constraints };
  return { route: 'semantic', constraints };
}
