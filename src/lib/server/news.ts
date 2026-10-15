/**
 * News intelligence service — fetches live financial news (Yahoo search,
 * Finnhub when configured), dedupes, classifies category / importance /
 * gold sentiment with an explainable keyword+rule model, persists to DB and
 * computes the aggregated sentiment used by the Fundamental Engine.
 */
import { db } from "@/lib/db";
import { yahooNews } from "../providers/yahoo";
import * as finnhub from "../providers/finnhub";
import { cache } from "./cache";

export interface ClassifiedNews {
  id: string;
  headline: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
  category: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
  sentiment: "BULLISH_GOLD" | "BEARISH_GOLD" | "NEUTRAL";
  sentimentScore: number;
  impact: string;
  aiSummary: string;
  status: "LIVE";
}

interface Rule { kw: RegExp; weight: number; category: string; why: string }

// Explainable keyword/rule sentiment model for gold.
const RULES: Rule[] = [
  { kw: /(rate cut|cutting rates|dovish|easing|lower rates|rate-cut)/i, weight: +0.5, category: "FED", why: "Lower policy rates reduce the opportunity cost of holding non-yielding gold." },
  { kw: /(rate hike|hiking|hawkish|higher for longer|tightening)/i, weight: -0.5, category: "FED", why: "Higher-for-longer rates raise real yields, typically pressuring gold." },
  { kw: /(cpi|inflation|pce).{0,40}(hotter|higher than expected|accelerat|beat|above forecast)/i, weight: -0.25, category: "INFLATION", why: "Hot inflation can delay cuts (bearish), though it also supports gold as an inflation hedge (mixed)." },
  { kw: /(cpi|inflation|pce).{0,40}(cooler|softer|below forecast|slows|eases)/i, weight: +0.35, category: "INFLATION", why: "Cooling inflation supports rate-cut expectations, bullish for gold." },
  { kw: /(weak dollar|dollar slides|dollar falls|dxy down|softer dollar)/i, weight: +0.4, category: "USD", why: "A weaker dollar makes gold cheaper for foreign buyers — bullish." },
  { kw: /(dollar strengthens|dollar rises|dollar rally|dxy up|strong dollar)/i, weight: -0.4, category: "USD", why: "A stronger dollar usually weighs on gold." },
  { kw: /(central bank.{0,30}buy|gold purchases|adds gold to reserves|bullion buying)/i, weight: +0.5, category: "CENTRAL_BANKS", why: "Official-sector buying is persistent structural gold demand." },
  { kw: /(geopolit|war|conflict|escalat|strike|sanction|tension)/i, weight: +0.3, category: "GEOPOLITICS", why: "Geopolitical risk raises safe-haven demand for gold." },
  { kw: /(ceasefire|de-escalat|peace deal|truce)/i, weight: -0.3, category: "GEOPOLITICS", why: "De-escalation reduces safe-haven bids." },
  { kw: /(yields? (?:rise|jump|climb|surge)|yield spike)/i, weight: -0.3, category: "YIELDS", why: "Rising nominal yields raise gold's opportunity cost." },
  { kw: /(yields? (?:fall|drop|slide|decline))/i, weight: +0.3, category: "YIELDS", why: "Falling yields are supportive for gold." },
  { kw: /(recession|hard landing|slowdown|contraction)/i, weight: +0.2, category: "MACRO", why: "Growth fears often drive defensive gold allocation." },
  { kw: /(gold (?:climbs|rises|jumps|gains|rallies|surges)|gold higher)/i, weight: +0.45, category: "GOLD", why: "Direct bullish price action reported." },
  { kw: /(gold (?:falls|drops|slips|declines|tumbles)|gold lower)/i, weight: -0.45, category: "GOLD", why: "Direct bearish price action reported." },
  { kw: /(nfp|payrolls|jobs report|unemployment claims)/i, weight: 0.05, category: "NFP", why: "Labour data moves rate expectations; direction depends on the print." },
];

function classify(headline: string, summary: string): { sentiment: ClassifiedNews["sentiment"]; score: number; category: string; impact: string; ai: string; importance: ClassifiedNews["importance"] } {
  const text = `${headline} ${summary}`.slice(0, 500);
  let score = 0;
  const matched: Rule[] = [];
  for (const r of RULES) {
    if (r.kw.test(text)) {
      score += r.weight;
      matched.push(r);
    }
  }
  const highImpact = /(fomc|fed decision|cpi|payrolls|powell|emergency|war|nuclear)/i.test(text);
  const importance: ClassifiedNews["importance"] = highImpact ? "HIGH" : matched.length ? "MEDIUM" : "LOW";
  const category = matched[0]?.category ?? (/(gold|bullion|xau)/i.test(text) ? "GOLD" : "MACRO");
  const sentiment = score > 0.15 ? "BULLISH_GOLD" : score < -0.15 ? "BEARISH_GOLD" : "NEUTRAL";
  const impact = matched.length
    ? `Rule-based impact: ${matched.slice(0, 2).map((m) => m.why).join(" ")}`
    : "No strong gold-relevant driver detected in headline/summary — treated as background context.";
  const ai = matched.length
    ? `Classified ${sentiment.replace("_", " ").toLowerCase()} for gold from ${matched.length} rule match(es): ${matched.map((m) => `"${m.kw.source.slice(0, 24)}…" (${m.weight > 0 ? "+" : ""}${m.weight})`).join(", ")}.`
    : "Neutral classification (no gold-sentiment rules matched).";
  return { sentiment, score: +Math.max(-1, Math.min(1, score)).toFixed(2), category, impact, ai, importance };
}

export interface RawNewsItem { id: string; headline: string; source: string; url: string; summary: string; publishedAt: Date }

/** Yahoo RSS headline feed — resilient fallback when the search API rate-limits. */
async function yahooRss(symbol: string): Promise<RawNewsItem[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/rss+xml,application/xml,text/xml" }, signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return [];
    const xml = await res.text();
    const items: RawNewsItem[] = [];
    const blocks = xml.split("<item>").slice(1);
    for (const b of blocks) {
      const pick = (tag: string) => {
        const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
        if (!m) return "";
        return m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
      };
      const title = pick("title");
      const link = pick("link") || pick("guid");
      if (!title || !link) continue;
      const pub = pick("pubDate");
      const sourceTag = b.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? "Yahoo Finance";
      items.push({
        id: `rss-${symbol}-${hashCode(link)}`,
        headline: title,
        source: sourceTag || "Yahoo Finance",
        url: link,
        summary: pick("description"),
        publishedAt: pub ? new Date(pub) : new Date(),
      });
    }
    return items;
  } catch {
    clearTimeout(timer);
    return [];
  }
}

function hashCode(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h).toString(36);
}

export async function fetchAndStoreNews(): Promise<ClassifiedNews[]> {
  const key = "news:classified";
  const hit = cache.get<ClassifiedNews[]>(key);
  if (hit) return hit;

  const items: RawNewsItem[] = [];

  // Primary: Yahoo news searches (multiple queries for breadth, deduped by URL)
  const queries = ["gold price fed", "gold market inflation", "federal reserve rates gold", "gold central banks"];
  const results = await Promise.allSettled(queries.map((q) => yahooNews(q, 10)));
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const n of r.value) {
      if (!n.title || !n.link) continue;
      items.push({
        id: `yh-${n.uuid ?? n.link}`,
        headline: n.title,
        source: n.publisher ?? "Yahoo Finance",
        url: n.link,
        summary: "",
        publishedAt: new Date((n.providerPublishTime ?? Math.floor(Date.now() / 1000)) * 1000),
      });
    }
  }

  // Fallback: Yahoo RSS headline feeds (GC=F, S&P, DXY) when search returns nothing
  if (items.length < 4) {
    const feeds = await Promise.allSettled([
      yahooRss("GC=F"),
      yahooRss("%5EGSPC"),
      yahooRss("DX-Y.NYB"),
    ]);
    for (const r of feeds) if (r.status === "fulfilled") items.push(...r.value);
  }

  // Secondary: Finnhub when configured
  if (finnhub.isConfigured()) {
    try {
      const fh = await finnhub.finnhubNews("general", 40);
      for (const n of fh) {
        if (!n.headline) continue;
        items.push({
          id: `fh-${n.id}`,
          headline: n.headline,
          source: n.source,
          url: n.url,
          summary: n.summary ?? "",
          publishedAt: new Date(n.datetime * 1000),
        });
      }
    } catch { /* provider down — Yahoo coverage remains */ }
  }

  // Dedupe by URL hash + headline
  const seen = new Set<string>();
  const deduped = items.filter((i) => {
    const k = `${i.url}|${i.headline.toLowerCase().slice(0, 60)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 40);

  const classified: ClassifiedNews[] = deduped.map((i) => {
    const c = classify(i.headline, i.summary);
    return {
      id: i.id,
      headline: i.headline,
      source: i.source,
      url: i.url,
      summary: i.summary || "(Summary not provided by provider — headline used for classification.)",
      publishedAt: i.publishedAt.toISOString(),
      category: c.category,
      importance: c.importance,
      sentiment: c.sentiment,
      sentimentScore: c.score,
      impact: c.impact,
      aiSummary: c.ai,
      status: "LIVE" as const,
    };
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  // persist (best effort) for audit trail
  try {
    for (const n of classified.slice(0, 30)) {
      await db.newsArticle.upsert({
        where: { externalId: n.id },
        create: {
          externalId: n.id, headline: n.headline, source: n.source, url: n.url,
          summary: n.summary, publishedAt: new Date(n.publishedAt), category: n.category,
          importance: n.importance, sentiment: n.sentiment, sentimentScore: n.sentimentScore,
          impact: n.impact, aiSummary: n.aiSummary, status: "LIVE",
        },
        update: {},
      });
    }
  } catch { /* db optional for news display */ }

  cache.set(key, classified, 120);
  return classified;
}

/** Aggregate sentiment score −1..1 weighted by importance. */
export function aggregateSentiment(news: ClassifiedNews[]): number {
  if (!news.length) return 0;
  const w = { HIGH: 1.5, MEDIUM: 1, LOW: 0.5 } as const;
  let num = 0, den = 0;
  for (const n of news.slice(0, 30)) {
    num += n.sentimentScore * w[n.importance];
    den += w[n.importance];
  }
  return den ? +(num / den).toFixed(3) : 0;
}
