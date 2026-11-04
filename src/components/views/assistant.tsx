"use client";

/**
 * AI Trading Assistant — conversational, grounded in the live data snapshot.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Send, Bot, User, Loader2 } from "lucide-react";
import { Chip, GlassPanel, SectionTitle, StatusBadge } from "@/components/glass/primitives";

interface Msg { role: "user" | "assistant"; content: string; time: string }

const SUGGESTIONS = [
  "What is the current XAUUSD bias?",
  "What is the 4H market structure?",
  "Where is the nearest liquidity?",
  "Has a bullish MSS formed?",
  "Is there a valid FVG?",
  "What is the current buyer/seller ratio?",
  "Is Gold approaching a major news event?",
  "What is the strongest confluence?",
  "Why is Gold moving?",
  "What could invalidate the current bias?",
  "Show me potential 1:3 setups.",
  "Compare the current market with historical patterns.",
];

export function AiAssistant() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [instrument, setInstrument] = useState<"XAUUSD" | "GC1!">("XAUUSD");
  const [meta, setMeta] = useState<{ snapshotTime?: string; sources?: string[]; price?: number | null; status?: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || loading) return;
    const userMsg: Msg = { role: "user", content: msg, time: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          instrument,
          history: messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const j = await res.json();
      const answer = j.answer ?? `Error: ${j.error ?? "assistant unavailable"}`;
      setMessages((m) => [...m, { role: "assistant", content: answer, time: new Date().toISOString() }]);
      setMeta({ snapshotTime: j.snapshotTime, sources: j.sources, price: j.dataSnapshot?.price, status: j.dataSnapshot?.status });
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Request failed: ${e instanceof Error ? e.message : "unknown"}`, time: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
      <GlassPanel className="xl:col-span-3 p-4 flex flex-col" strong>
        <div className="h-[560px] flex flex-col">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Bot size={15} className="text-zinc-300" />
              <span className="text-[12px] font-semibold tracking-wide text-zinc-100">AI Trading Assistant</span>
              {meta?.price ? <span className="text-[10px] num text-zinc-500">snapshot @ {meta.price} <StatusBadge status={meta.status ?? "…"} /></span> : null}
            </div>
            <div className="flex gap-1.5">
              <Chip active={instrument === "XAUUSD"} onClick={() => setInstrument("XAUUSD")}>XAUUSD</Chip>
              <Chip active={instrument === "GC1!"} onClick={() => setInstrument("GC1!")}>GC1!</Chip>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1 space-y-3">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <Bot size={28} className="text-zinc-600 mb-3" />
                <p className="text-[12px] text-zinc-400 max-w-md leading-relaxed">
                  Ask about the live market. I answer strictly from the platform&apos;s retrieved data — quotes, ICT/SMC
                  structure, liquidity, order flow, predictions, setups, news and calendar — with timestamps. I will tell
                  you when I cannot see something.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role === "assistant" && <div className="shrink-0 w-6 h-6 rounded-md glass flex items-center justify-center"><Bot size={12} className="text-zinc-400" /></div>}
                <div className={`max-w-[78%] rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-zinc-100/15 border border-white/20 text-zinc-50" : "glass-subtle text-zinc-200"}`}>
                  {m.content}
                  <div className="text-[8.5px] text-zinc-600 mt-1.5 num">{m.time.slice(11, 19)} UTC</div>
                </div>
                {m.role === "user" && <div className="shrink-0 w-6 h-6 rounded-md glass flex items-center justify-center"><User size={12} className="text-zinc-400" /></div>}
              </motion.div>
            ))}
            {loading && (
              <div className="flex gap-2.5">
                <div className="shrink-0 w-6 h-6 rounded-md glass flex items-center justify-center"><Bot size={12} className="text-zinc-400" /></div>
                <div className="glass-subtle rounded-xl px-3.5 py-3 flex items-center gap-2 text-[11px] text-zinc-400">
                  <Loader2 size={12} className="animate-spin" /> retrieving live data & composing answer…
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); void send(input); }}
            className="mt-3 flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about bias, liquidity, structure, setups…"
              className="flex-1 bg-white/[0.04] border border-white/12 rounded-lg px-3 py-2.5 text-[12px] text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-white/30 transition-colors"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3.5 py-2.5 text-zinc-100 hover:bg-white/20 disabled:opacity-40 transition-all"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      </GlassPanel>

      <div className="space-y-3">
        <GlassPanel className="p-4">
          <SectionTitle title="Suggested questions" />
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <Chip key={s} onClick={() => void send(s)}>{s}</Chip>
            ))}
          </div>
        </GlassPanel>
        <GlassPanel className="p-4" delay={0.05}>
          <SectionTitle title="Grounding & data sources" />
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Each answer is generated from a fresh market snapshot built at question time.
            {meta?.sources?.length ? (
              <span className="block mt-2">
                <span className="text-[10px] uppercase tracking-widest text-zinc-600 block mb-1">Last answer sources</span>
                {meta.sources.map((s, i) => <span key={i} className="block text-[10.5px] text-zinc-500 num">· {s}</span>)}
              </span>
            ) : null}
            {meta?.snapshotTime ? <span className="block mt-2 text-[10px] text-zinc-600 num">snapshot: {meta.snapshotTime.slice(0, 19).replace("T", " ")} UTC</span> : null}
          </p>
        </GlassPanel>
      </div>
    </div>
  );
}
