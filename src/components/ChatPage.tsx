import React, { useState, useRef, useEffect } from 'react';
import { ZButton } from './ZButton';
import { ZCard } from './ZCard';
import { Send, User, Bot, Menu, Plus, MessageSquare, X, Trash2, Mic } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Retriever } from '@/rag/retriever';
import { HybridRetriever } from '@/rag/hybrid';
import { openRagDB, getMeta as idbGetMeta, getAllChunks as idbGetAllChunks, setMeta as idbSetMeta, putChunks as idbPutChunks } from '@/rag/idbStore';
import { openTxDB, getMeta as txGetMeta, setMeta as txSetMeta, putTxChunks as txPutTxChunks, putSumChunks as txPutSumChunks, setRaw as txSetRaw } from '@/rag/txIdbStore';

interface Message {
  id: number;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

interface ChatPageProps {
  onNavigate: (page: string) => void;
}

// RAG index types
interface RagChunk { id: string; text: string; embedding: number[]; }
interface RagIndex { model: string; dims: number; createdAt: string; chunks: RagChunk[]; }

export function ChatPage({ onNavigate }: ChatPageProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [ragIndex, setRagIndex] = useState<RagIndex | null>(null);
  const [ragMissing, setRagMissing] = useState(false);
  const [showRagBanner, setShowRagBanner] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const retrieverRef = useRef<Retriever | null>(null);
    const hybridRef = useRef<HybridRetriever | null>(null);

  // Helper: sort conversations by most recent updatedAt (descending)
  const sortByUpdatedAtDesc = (arr: Conversation[]) =>
    [...arr].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  // Load conversations from localStorage on mount
  useEffect(() => {
    const savedConversations = localStorage.getItem('chatConversations');
    if (savedConversations) {
      const parsed = JSON.parse(savedConversations);
      // Convert date strings back to Date objects
      const restored: Conversation[] = parsed.map((conv: any) => ({
        ...conv,
        createdAt: new Date(conv.createdAt),
        updatedAt: new Date(conv.updatedAt),
        messages: conv.messages.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        }))
      }));
      const sorted = sortByUpdatedAtDesc(restored);
      setConversations(sorted);
      
      // Set the most recent conversation as current
      if (sorted.length > 0) {
        setCurrentConversationId(sorted[0].id);
      }
    } else {
      // Create initial conversation
      createNewConversation();
    }
  }, []);

  // Save conversations to localStorage whenever they change
  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem('chatConversations', JSON.stringify(conversations));
    }
  }, [conversations]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentConversationId, conversations]);

  // Initialize RAG VectorDB from IndexedDB; if empty, migrate from JSON once
  useEffect(() => {
    const init = async () => {
      const r = new Retriever();
      let loaded = false;

      // 1) Try to load from IndexedDB (preferred persistent VectorDB)
      const ok = await r.loadFromIDB();
      if (ok) {
        retrieverRef.current = r;
        loaded = true;
        try {
          const db = await openRagDB();
          const meta = await idbGetMeta(db);
          const chunks = await idbGetAllChunks(db);
          if (meta && chunks) setRagIndex({ model: meta.model, dims: meta.dims, createdAt: meta.createdAt, chunks: chunks as any });
        } catch {}
        setRagMissing(false);
        return;
      }

      // 2) If IDB empty, migrate from existing rag_index.json (seed) into IDB, then load
      const url = new URL('../data/rag_index.json', import.meta.url).toString();
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('no json');
        const j = (await res.json()) as RagIndex;
        try {
          const db = await openRagDB();
          await idbSetMeta(db, { model: j.model, dims: j.dims, createdAt: j.createdAt });
          await idbPutChunks(db, j.chunks.map(ch => ({ id: ch.id, text: ch.text, embedding: ch.embedding })) as any);
          // Now load from IDB for runtime
          const ok2 = await r.loadFromIDB();
          if (ok2) {
            retrieverRef.current = r;
            setRagIndex(j);
            console.info('[RAG] Migrated rag_index.json into VectorDB (IndexedDB)');
            loaded = true;
            setRagMissing(false);
            return;
          }
        } catch {}
      } catch {}

      // 3) As a last resort, try loading JSON into in-memory VectorDB (legacy)
      try {
        const url2 = new URL('../data/rag_index.json', import.meta.url).toString();
        await r.loadIndex(url2);
        retrieverRef.current = r;
        loaded = true;
        fetch(url2).then(res => (res.ok ? res.json() : null)).then(j => { if (j && j.chunks && Array.isArray(j.chunks)) setRagIndex(j as RagIndex); }).catch(() => {});
        setRagMissing(false);
      } catch {}

      if (!loaded) setRagMissing(true);
    };

    init();
  }, []);

  // Migrate transaction indexes and JSONL into IndexedDB (txRagDB) once
  useEffect(() => {
    const migrateTx = async () => {
      try {
        const db = await openTxDB();
        const meta = await txGetMeta(db);
        if (meta) {
          return; // already migrated
        }
        const txUrl = new URL('../data/tx_index.json', import.meta.url).toString();
        const sumUrl = new URL('../data/sum_index.json', import.meta.url).toString();
        const txDocsUrl = new URL('../data/tx_docs.jsonl', import.meta.url).toString();
        const sumDocsUrl = new URL('../data/sum_docs.jsonl', import.meta.url).toString();

        const [txRes, sumRes, txDocsRes, sumDocsRes] = await Promise.all([
          fetch(txUrl), fetch(sumUrl), fetch(txDocsUrl), fetch(sumDocsUrl)
        ]);
        if (!txRes.ok || !sumRes.ok) return; // nothing to migrate
        const txIndex = await txRes.json();
        const sumIndex = await sumRes.json();
        const txDocsText = txDocsRes.ok ? await txDocsRes.text() : '';
        const sumDocsText = sumDocsRes.ok ? await sumDocsRes.text() : '';

        await txSetMeta(db, { model: txIndex.model, dims: txIndex.dims, createdAt: txIndex.createdAt });
        await txPutTxChunks(db, txIndex.chunks.map((c: any) => ({ id: c.id, text: c.text, embedding: c.embedding, metadata: c.metadata })));
        await txPutSumChunks(db, sumIndex.chunks.map((c: any) => ({ id: c.id, text: c.text, embedding: c.embedding, metadata: c.metadata })));
        if (txDocsText) await txSetRaw(db, 'tx_docs', txDocsText);
        if (sumDocsText) await txSetRaw(db, 'sum_docs', sumDocsText);
        console.info('[TxRAG] Migrated tx_index.json, sum_index.json, and JSONL into IndexedDB');
      } catch (e) {
        // silent fail to avoid breaking the app
      }
    };
    migrateTx();
  }, []);

  const EMB_API = 'http://localhost:11434/v1/embeddings';
  const CHAT_API = 'http://localhost:11434/v1/chat/completions';
  const API_KEY = 'sk-roG3OusRr0TLCHAADks6lw';

  // --- Dual-path router helpers ---
  const [csvData, setCsvData] = useState<any[] | null>(null);

  function monthStringToRange(q: string): { year?: number; month?: number } {
    const now = new Date();
    const s = q.toLowerCase();
    // Relative periods
    if (/\b(this month|current month|этот месяц|текущий месяц)\b/.test(s)) {
      return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
    }
    if (/\b(last month|previous month|прошлый месяц|предыдущий месяц)\b/.test(s)) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    }
    if (/\b(this year|этот год|текущий год)\b/.test(s)) {
      return { year: now.getUTCFullYear() };
    }
    // Explicit month names or YYYY-MM patterns
    const mEn = s.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b\s*(\d{4})?/i);
    const mRu = s.match(/\b(январ[ья]|феврал[ья]|март[ае]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[ае]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])\b\s*(\d{4})?/i);
    const months = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 } as any;
    const ru = { январ:1, феврал:2, март:3, апрел:4, май:5, июня:6, июл:7, август:8, сентябр:9, октябр:10, ноябр:11, декабр:12 } as any;
    if (mEn) return { month: months[mEn[1].toLowerCase()], year: mEn[2] ? Number(mEn[2]) : undefined };
    if (mRu) {
      const key = (mRu[1] as string).toLowerCase().slice(0,5);
      return { month: ru[key], year: mRu[2] ? Number(mRu[2]) : undefined };
    }
    const ym = s.match(/(20\d{2})[-\/.](\d{1,2})/);
    if (ym) return { year: Number(ym[1]), month: Number(ym[2]) };
    return {};
  }

  function classifyQuery(q: string): 'structured' | 'semantic' {
    const s = q.toLowerCase();
    const structuredHints = [
      'how much','сколько','итого','сумма','total','average','avg','средн','потрат','расход','доход','net','всего',
      'income','earning','earnings','revenue','expense','expenses','spend','spent','outcome','outgo','outgoing','balance'
    ];
    const hasNum = /\d/.test(s);
    const hasIncomeOutcomePair = /(income\s+and\s+(outcome|expense|expenses|spend|spent))|(доход\s+и\s+расход)/.test(s);
    if (hasIncomeOutcomePair) return 'structured';
    if (structuredHints.some(h => s.includes(h)) || (hasNum && !!monthStringToRange(s).month)) return 'structured';
    return 'semantic';
  }

  function extractConstraints(q: string) {
    const s = q.toLowerCase();
    const time = monthStringToRange(s);
    const catMatch = s.match(/\b(grocery|grocer(y|ies)|супермаркет|продукт|кафе|развлечен|entertainment|fuel|топлив|транспорт|аренд|rent|подписк|subscription|связь|internet|mobile)\b/);
    const category = catMatch ? catMatch[0] : undefined;
    const merchMatch = s.match(/(?:at|у|в)\s+([a-zа-я0-9][a-zа-я0-9\-_.]+)/i);
    const merchant = merchMatch ? merchMatch[1].toLowerCase() : undefined;
    const currency = s.includes('kzt') || s.includes('₸') ? 'KZT' : undefined;
    return { time, category, merchant, currency } as { time: {year?:number;month?:number}, category?: string, merchant?: string, currency?: string };
  }

  async function loadCsv(): Promise<any[]> {
    if (csvData) return csvData;
    try {
      const url = new URL('../data/user-transactions.csv', import.meta.url).toString();
      const res = await fetch(url);
      if (!res.ok) return [];
      const raw = await res.text();
      const lines = raw.trim().split(/\r?\n/);
      const header = lines[0].split(',').map(s=>s.trim());
      const rows: any[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const row: any = {};
        for (let j = 0; j < header.length; j++) row[header[j]] = (cols[j] || '').trim();
        const amountKey = header.find(h => h.toLowerCase().startsWith('amount')) || 'Amount';
        // sanitize amount: remove currency symbols, spaces, and thousand separators; normalize comma to dot
        const rawAmt = String(row[amountKey] || '').replace(/[^0-9+\-.,]/g, '').replace(/,/g, '.');
        const parsedAmount = Number(rawAmt);
        const rec = {
          date: row['Date'] || row['date'] || row['DATE'],
          category: row['Category'] || row['category'],
          description: row['Description'] || row['description'],
          amount: parsedAmount
        };
        // skip bad rows with invalid date or amount
        if (!rec.date || !isFinite(rec.amount)) continue;
        rows.push(rec);
      }
      setCsvData(rows);
      return rows;
    } catch {
      return [];
    }
  }

  function withinMonth(d: Date, y?: number, m?: number) {
    if (!y || !m) return true;
    return d.getUTCFullYear() === y && (d.getUTCMonth()+1) === m;
  }

  async function runStructuredQuery(q: string) {
    const rows = await loadCsv();
    const c = extractConstraints(q);
    const y = c.time.year; const m = c.time.month;
    const cat = c.category; const merch = c.merchant;
    let income = 0, expense = 0;
    const details: any[] = [];
    for (const r of rows) {
      const d = new Date(r.date);
      if (!isFinite(r.amount)) continue; // guard invalid amounts
      if (isNaN(d.getTime())) continue;
      if (!withinMonth(d, y, m)) continue;
      if (cat && !(String(r.category||'').toLowerCase().includes(cat))) continue;
      if (merch && !(String(r.description||'').toLowerCase().includes(merch))) continue;
      if (r.amount >= 0) income += r.amount; else expense += -r.amount;
      details.push(r);
    }
    const net = income - expense;
    const snippet = `Tool output (aggregates):\nperiod=${y??'any'}-${m??'any'}; category=${cat??'any'}; merchant=${merch??'any'}\nIncome=${Math.round(income)} KZT; Expense=${Math.round(expense)} KZT; Net=${Math.round(net)} KZT; count=${details.length}`;
    return { snippet, details };
  }

  function cosine(a: number[], b: number[]) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length && i < b.length; i++) {
      const x = a[i], y = b[i];
      dot += x * y; na += x * x; nb += y * y;
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  async function embedQuery(q: string): Promise<number[] | null> {
    try {
      const res = await fetch(EMB_API, {
        method: 'POST',
        headers: { accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'mxbai-embed-large:latest', input: q })
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.data?.[0]?.embedding) console.log(data?.data?.[0]?.embedding)
      return data?.data?.[0]?.embedding || null;
    } catch {
      return null;
    }
  }

  const createNewConversation = () => {
    const newConversation: Conversation = {
      id: Date.now().toString(),
      title: 'Новый чат',
      messages: [
        {
          id: 1,
          text: 'Здравствуйте! Чем я могу помочь вам сегодня?',
          sender: 'bot',
          timestamp: new Date()
        }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    setConversations(prev => sortByUpdatedAtDesc([newConversation, ...prev]));
    setCurrentConversationId(newConversation.id);
  };

  const deleteConversation = (id: string) => {
    setConversations(prev => {
      const updated = sortByUpdatedAtDesc(prev.filter(conv => conv.id !== id));
      
      // If we deleted the current conversation, switch to another one
      if (id === currentConversationId) {
        if (updated.length > 0) {
          setCurrentConversationId(updated[0].id);
        } else {
          // Create a new conversation if none left
          setTimeout(() => createNewConversation(), 0);
        }
      }
      
      return updated;
    });
  };

  const currentConversation = conversations.find(conv => conv.id === currentConversationId);
  const messages = currentConversation?.messages || [];

  const handleSend = () => {
    if (!inputValue.trim() || !currentConversationId) return;

    const userMessage: Message = {
      id: messages.length + 1,
      text: inputValue,
      sender: 'user',
      timestamp: new Date()
    };

    // Update conversation with new message and title
    setConversations(prev => {
      const updated = prev.map(conv => {
        if (conv.id === currentConversationId) {
          // Обновить заголовок на первое сообщение пользователя, если это всё ещё "Новый чат"
          const newTitle = conv.title === 'Новый чат' && conv.messages.length === 1
            ? inputValue.slice(0, 50) + (inputValue.length > 50 ? '...' : '')
            : conv.title;

          return {
            ...conv,
            title: newTitle,
            messages: [...conv.messages, userMessage],
            updatedAt: new Date()
          };
        }
        return conv;
      });
      return sortByUpdatedAtDesc(updated);
    });

    setInputValue('');

    // Call AI endpoint
    const apiRequest = async () => {
      try {
        const history = [...messages, userMessage].map(m => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: m.text,
        }));

        // Build RAG context using VectorDB retriever if available, with a local fallback
        let messagesForApi = history;
        const systemInstruction = {
          role: 'system' as const,
          content:
            'Ты — тёплый и заботливый ассистент банка Zaman. Твоя речь должна быть максимально человечной и доверительной, как у внимательного консультанта. Отвечай строго на русском языке, простыми словами и короткими абзацами (до 6–8 предложений).\n\nГлавные принципы:\n- Основа ответа — предоставленный контекст (база знаний) или выводы инструмента данных. Если информации в контексте недостаточно, кратко скажи об этом и только затем добавь общий, практичный совет.\n- Поддерживай пользователя: проявляй эмпатию, признавай чувства, избегай сухих «канцеляризмов».\n- Давай рекомендации по снижению стресса без трат: дыхательные упражнения, короткие прогулки, паузы, сон, разговор с близкими, планирование задач, ведение заметок, техники благодарности и др. Не предлагай покупки как способ справиться со стрессом.\n- Финансовые советы — бережные и реалистичные: помогай избегать импульсных трат, предлагай бесплатные/низкозатратные альтернативы.\n- Если вопрос связан с самочувствием, избегай медицинских диагнозов. При признаках кризиса мягко предложи обратиться за профессиональной помощью.\n- Когда уместно, задай 1 уточняющий вопрос, чтобы лучше понять ситуацию.\n- Если цитируешь контекст, делай это кратко и указывай источник по номеру.\n\nШаблон ответа (важно):\n- Рассуждай только на основе извлечённых документов или вывода инструмента данных; не фантазируй.\n- Если нужен подсчёт/агрегация по транзакциям — сперва используй инструмент данных (уже выполнен), затем объясняй результат.\n- Приводи короткие цитаты/факты с пометкой «Источник #N» или «Данные инструмента».\n- Если в контексте/данных нет ответа — прямо скажи «В контексте нет такой информации».\n\nВсегда ставь интересы пользователя и его спокойствие на первое место.'
        };

        async function assembleWithContext(contextText: string | null) {
          if (!contextText) return null;
          const wrappedHistory = [...history];
          for (let i = wrappedHistory.length - 1; i >= 0; i--) {
            if (wrappedHistory[i].role === 'user') {
              const originalQ = wrappedHistory[i].content as string;
              wrappedHistory[i] = {
                role: 'user',
                content:
                  `Контекст (из базы знаний):\n${contextText}\n\n---\nВопрос пользователя: ${originalQ}\n\nИнструкция: Используй контекст выше как первоисточник. Если чего-то не хватает — скажи об этом явно.`
              } as any;
              break;
            }
          }
          return [systemInstruction, ...wrappedHistory];
        }

        let contextAssembled = false;

        // Router: decide structured vs semantic
        const route = classifyQuery(userMessage.text);
        if (route === 'structured') {
          const { snippet } = await runStructuredQuery(userMessage.text);
          const wrappedHistory = [...history];
          for (let i = wrappedHistory.length - 1; i >= 0; i--) {
            if (wrappedHistory[i].role === 'user') {
              const originalQ = wrappedHistory[i].content as string;
              wrappedHistory[i] = {
                role: 'user',
                content: `Данные инструмента (агрегации по транзакциям):\n${snippet}\n\nВопрос пользователя: ${originalQ}\n\nИнструкция: объясни результат простыми словами и, если уместно, дай практичный совет по управлению расходами.`
              } as any;
              break;
            }
          }
          messagesForApi = [systemInstruction, ...wrappedHistory] as any;
          contextAssembled = true; // skip semantic retrieval
        } else {
          // First try hybrid retrieval over transactions and summaries with metadata filters
          try {
            if (!hybridRef.current) {
              // lazy load
              const h = new HybridRetriever();
              const txUrl = new URL('../data/tx_index.json', import.meta.url).toString();
              const sumUrl = new URL('../data/sum_index.json', import.meta.url).toString();
              await h.load(txUrl, sumUrl);
              hybridRef.current = h;
            }
            if (hybridRef.current) {
              const c = extractConstraints(userMessage.text);
              const filter: any = {};
              if (c.time?.year) filter.year = c.time.year;
              if (c.time?.month) filter.month = c.time.month;
              if (c.category) filter.category = c.category.includes('product')||c.category.includes('продукт')?'groceries': c.category.includes('кафе')?'food_out': c.category;
              if (c.merchant) filter.merchant = c.merchant.toLowerCase();
              if (c.currency) filter.currency = c.currency;
              const hybridHits = await hybridRef.current.search(userMessage.text, filter, 6);
              if (hybridHits && hybridHits.length) {
                const lines: string[] = [];
                hybridHits.forEach((h, i) => {
                  lines.push(`Источник ${i+1} [${h.source}]: ${h.text}`);
                });
                const ctx = lines.join('\n\n');
                const assembled = await assembleWithContext(ctx);
                if (assembled) {
                  messagesForApi = assembled as any;
                  contextAssembled = true;
                }
              }
            }
          } catch {}

          // Try primary retriever if context not yet assembled
          if (!contextAssembled && retrieverRef.current) {
            try {
              const ret = await retrieverRef.current.retrieve(userMessage.text, { topK: 5, minScore: 0.12, mmrLambda: 0.6, maxContextChars: 2600 });
              if (ret && ret.context) {
                const maybe = await assembleWithContext(ret.context);
                if (maybe) {
                  messagesForApi = maybe as any; contextAssembled = true;
                  try { console.info('[RAG] Using VectorDB context from Info.pdf:', ret.chunks.map((c, i) => ({ rank: i + 1, id: c.id, score: Number(c.score?.toFixed?.(3) ?? c.score), page: c.page }))); } catch {}
                }
              }
            } catch (e) {
              // ignore and try fallback
            }
          }

          // Fallback: use raw ragIndex + local embedQuery + cosine with metadata filters
          if (!contextAssembled && ragIndex && ragIndex.chunks?.length) {
            try {
              const qEmb = await embedQuery(userMessage.text);
              if (qEmb) {
                // Apply simple metadata filters if present
                const cons = extractConstraints(userMessage.text);
                const candidates = (ragIndex.chunks as any[]).filter((ch: any) => {
                  const meta = ch.meta?.metadata || {};
                  let pass = true;
                  if (cons.time?.year && typeof meta.year === 'number' && meta.year !== cons.time.year) pass = false;
                  if (cons.time?.month && typeof meta.month === 'number' && meta.month !== cons.time.month) pass = false;
                  if (cons.category && meta.category_lvl1 && String(meta.category_lvl1).includes(cons.category)) {} // ok
                  else if (cons.category && meta.category_lvl1) pass = false;
                  if (cons.merchant && meta.merchant && String(meta.merchant).includes(cons.merchant)) {} else if (cons.merchant && meta.merchant) pass = false;
                  return pass;
                });
                const pool = candidates.length ? candidates : (ragIndex.chunks as any[]);
                const scored = pool.map((ch: any) => ({ id: ch.id, text: ch.text, score: cosine(qEmb, ch.embedding) }));
                scored.sort((a, b) => b.score - a.score);
                const top = scored.filter(s => isFinite(s.score)).slice(0, 5);
                const ctx = top.map((s, i) => `Источник ${i + 1} — score ${s.score.toFixed(3)}\n${s.text}`).join('\n\n');
                const maybe = await assembleWithContext(ctx);
                if (maybe) { messagesForApi = maybe as any; contextAssembled = true; }
              }
            } catch (e) {
              // last resort: no context
            }
          }
        }

        // Robust chat call with fallbacks and better diagnostics
        const candidateModels = ['llama3.1:latest'];
        let data: any = null;
        let lastErrStatus = 0;
        let lastErrText = '';
        for (const mdl of candidateModels) {
          const res = await fetch(CHAT_API, {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: mdl,
              messages: messagesForApi,
              temperature: 0.2,
              top_p: 0.9,
              max_tokens: 500,
            }),
          });
          if (res.ok) {
            try { data = await res.json(); } catch { data = null; }
            if (data) break;
          } else {
            lastErrStatus = res.status;
            try { lastErrText = await res.text(); } catch { lastErrText = ''; }
            console.warn(`[ChatAPI] ${res.status} for model ${mdl}: ${lastErrText?.slice(0,300)}`);
            // On 400/404, try next model; on 5xx also retry; on others continue
            continue;
          }
        }
        if (!data) {
          throw new Error(`API error ${lastErrStatus || 0}${lastErrText ? `: ${lastErrText}` : ''}`);
        }

        const content = data?.choices?.[0]?.message?.content ?? 'Извините, я не смог сгенерировать ответ.';

        const botMessage: Message = {
          id: messages.length + 2,
          text: content,
          sender: 'bot',
          timestamp: new Date(),
        };

        setConversations(prev => {
          const updated = prev.map(conv => {
            if (conv.id === currentConversationId) {
              return {
                ...conv,
                messages: [...conv.messages, botMessage],
                updatedAt: new Date(),
              };
            }
            return conv;
          });
          return sortByUpdatedAtDesc(updated);
        });
      } catch (err) {
        console.error('AI API error:', err);
        const botMessage: Message = {
          id: messages.length + 2,
          text: 'Произошла ошибка при обращении к сервису ИИ. Пожалуйста, попробуйте ещё раз.',
          sender: 'bot',
          timestamp: new Date(),
        };
        setConversations(prev => {
          const updated = prev.map(conv => (conv.id === currentConversationId ? {
            ...conv,
            messages: [...conv.messages, botMessage],
            updatedAt: new Date(),
          } : conv));
          return sortByUpdatedAtDesc(updated);
        });
      }
    };

    apiRequest();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getConversationPreview = (conv: Conversation) => {
    const lastMessage = conv.messages[conv.messages.length - 1];
    return lastMessage.text.slice(0, 60) + (lastMessage.text.length > 60 ? '...' : '');
  };

  return (
    <div className="h-screen overflow-hidden bg-[#E9F2EF] flex flex-col" style={{ height: '100dvh' }}>
      <header className="flex-none bg-white border-b border-[#E9F2EF] p-4" style={{ boxShadow: '0 10px 30px rgba(13, 46, 40, 0.08)' }}>
        <div className="w-full flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden w-10 h-10 flex items-center justify-center hover:bg-[#E9F2EF] rounded-xl transition-colors"
            >
              {sidebarOpen ? <X className="w-5 h-5 text-[#0B1F1A]" /> : <Menu className="w-5 h-5 text-[#0B1F1A]" />}
            </button>
            <div className="w-10 h-10 bg-gradient-to-br from-[#2D9A86] to-[#1A5C50] rounded-full flex items-center justify-center">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-[#0B1F1A]" style={{ fontSize: '24px', fontWeight: 700 }}>
                Zaman AI
              </h1>
              <p className="text-[#475B53]" style={{ fontSize: '14px' }}>Онлайн</p>
            </div>
          </div>
          <div className="flex gap-2">
            <ZButton variant="secondary" onClick={() => onNavigate('profile')}>
              Профиль
            </ZButton>
            <ZButton variant="accent" onClick={() => onNavigate('analysis')}>
              Аналитика
            </ZButton>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className={`${sidebarOpen ? 'w-80' : 'w-0'} lg:w-80 transition-all duration-300 overflow-hidden border-r border-[#E9F2EF] bg-white flex flex-col min-h-0`}>
          <div className="p-4 border-b border-[#E9F2EF]">
            <ZButton variant="primary" onClick={createNewConversation} className="w-full py-3">
              <div className="w-full flex flex-col items-center leading-none">
                <span className="text-2xl">+</span>
                <span className="mt-1">Новый чат</span>
              </div>
            </ZButton>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <h2 className="text-[#475B53] mb-3" style={{ fontSize: '14px', fontWeight: 700 }}>
              ИСТОРИЯ ЧАТА
            </h2>
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group relative p-3 rounded-xl cursor-pointer transition-all ${
                  conv.id === currentConversationId
                    ? 'bg-[#E9F2EF] border-2 border-[#2D9A86]'
                    : 'bg-white hover:bg-[#E9F2EF] border-2 border-transparent'
                }`}
                onClick={() => setCurrentConversationId(conv.id)}
              >
                <div className="flex items-start gap-2">
                  <MessageSquare className="w-4 h-4 text-[#2D9A86] mt-1 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[#0B1F1A] truncate" style={{ fontSize: '14px', fontWeight: 700 }}>
                      {conv.title}
                    </p>
                    <p className="text-[#475B53] truncate" style={{ fontSize: '12px' }}>
                      {getConversationPreview(conv)}
                    </p>
                    <p className="text-[#475B53] mt-1" style={{ fontSize: '11px' }}>
                      {conv.updatedAt.toLocaleDateString()} {conv.updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Вы уверены, что хотите удалить этот диалог?')) {
                        deleteConversation(conv.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-100 rounded"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
            ))}
            
            {conversations.length === 0 && (
              <div className="text-center py-8 text-[#475B53]" style={{ fontSize: '14px' }}>
                Пока нет диалогов. Начните новый чат!
              </div>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <div className="max-w-4xl mx-auto space-y-4">
              {ragMissing && showRagBanner && (
                <div className="bg-yellow-100 border border-yellow-300 text-yellow-900 rounded-xl p-3 flex items-start justify-between gap-3">
                  <div className="text-sm">
                    Векторная база знаний не найдена. Если вы запускаете проект впервые, выполните команду: <code>npm run rag:build</code>, затем перезагрузите страницу. Если база уже создавалась в этом браузере, просто продолжайте — ответы будут без контекста.
                  </div>
                  <button onClick={() => setShowRagBanner(false)} className="text-yellow-900/70 hover:text-yellow-900 text-sm underline">Скрыть</button>
                </div>
              )}
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    message.sender === 'user' 
                      ? 'bg-[#EEFF6D]' 
                      : 'bg-gradient-to-br from-[#2D9A86] to-[#1A5C50]'
                  }`}>
                    {message.sender === 'user' ? (
                      <User className="w-5 h-5 text-[#0B1F1A]" />
                    ) : (
                      <Bot className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <div className={`flex flex-col max-w-md ${message.sender === 'user' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`px-4 py-3 rounded-2xl ${
                        message.sender === 'user'
                          ? 'bg-[#2D9A86] text-white'
                          : 'bg-white border border-[#E9F2EF]'
                      }`}
                      style={message.sender === 'bot' ? { boxShadow: '0 10px 30px rgba(13, 46, 40, 0.08)' } : {}}
                    >
                      <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-pre:my-2 prose-code:px-1 prose-code:rounded" style={{ fontSize: '16px' }}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => <p className="m-0 leading-relaxed">{children}</p>,
                            strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                            em: ({ children }) => <em className="italic">{children}</em>,
                            code: ({ inline, className, children, ...props }) => (
                              inline ? (
                                <code className="bg-black/10 px-1 py-0.5 rounded text-[0.9em]" {...props}>{children}</code>
                              ) : (
                                <pre className="bg-black/10 p-3 rounded overflow-auto"><code {...props} className={className}>{children}</code></pre>
                              )
                            ),
                            a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className={message.sender === 'user' ? 'underline text-white' : 'underline text-[#2D9A86]'}>{children}</a>,
                            ul: ({ children }) => <ul className="list-disc pl-5 my-1">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal pl-5 my-1">{children}</ol>,
                            li: ({ children }) => <li className="my-0.5">{children}</li>,
                            h1: ({ children }) => <h1 className="text-xl font-bold mt-1 mb-1">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-lg font-bold mt-1 mb-1">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-base font-bold mt-1 mb-1">{children}</h3>,
                            blockquote: ({ children }) => <blockquote className="border-l-4 pl-3 opacity-80">{children}</blockquote>,
                            hr: () => <hr className="my-2 border-[#E9F2EF]" />,
                          }}
                        >
                          {message.text}
                        </ReactMarkdown>
                      </div>
                    </div>
                    <span className="text-[#475B53] mt-1" style={{ fontSize: '12px' }}>
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="bg-white border-t border-[#E9F2EF] p-4">
            <div className="max-w-4xl mx-auto flex gap-3">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Напишите сообщение..."
                className="flex-1 h-12 px-4 bg-[#E9F2EF] border border-[#E9F2EF] rounded-xl outline-none transition-shadow duration-200 focus:shadow-[0_0_0_6px_rgba(238,255,109,0.35)]"
              />
              <ZButton
                variant="secondary"
                title="Голосовой ввод (скоро)"
                aria-label="Голосовой ввод"
                onClick={() => { /* TODO: добавить логику голосового ввода */ }}
                className="px-3"
              >
                <Mic className="w-5 h-5" />
              </ZButton>
              <ZButton variant="primary" onClick={handleSend} className="px-6">
                <Send className="w-5 h-5" />
              </ZButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
