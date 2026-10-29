"use client";

/**
 * Client data hooks — SWR-style fetching with polling + socket.io live quotes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { io, type Socket } from "socket.io-client";

export const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
};

export function useApi<T>(url: string | null, refreshInterval = 0) {
  const { data, error, isLoading, mutate } = useSWR<T>(url, fetcher, {
    refreshInterval,
    revalidateOnFocus: false,
    dedupingInterval: 4000,
  });
  return { data, error, isLoading, mutate };
}

export interface LiveQuote {
  instrument: string;
  price: number;
  direction: number;
  prev: number | null;
  status: string;
  source: string;
  time: string;
}

export interface AlertEvent {
  alertId: string;
  kind: string;
  instrument: string;
  message: string;
  time: string;
}

/** Live quotes via socket.io through the Caddy gateway (XTransformPort=3003). */
export function useLiveQuotes(): { quotes: Record<string, LiveQuote>; connected: boolean; alertEvents: AlertEvent[] } {
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [connected, setConnected] = useState(false);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);
  const sockRef = useRef<Socket | null>(null);

  useEffect(() => {
    const streamUrl =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
        ? `${window.location.protocol}//${window.location.hostname}:3003`
        : "/?XTransformPort=3003";

    const socket = io(streamUrl, {
      path: "/",
      reconnectionDelay: 1000,
      reconnectionDelayMax: 4000,
      transports: ["websocket", "polling"],
      timeout: 8000,
    });
    sockRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("quote", (q: LiveQuote) => {
      setQuotes((prev) => ({ ...prev, [q.instrument]: q }));
    });
    socket.on("alert", (a: AlertEvent) => {
      setAlertEvents((prev) => [a, ...prev].slice(0, 20));
    });
    socket.emit("subscribe", { instruments: ["XAUUSD", "GC1!"] });
    return () => {
      socket.disconnect();
      sockRef.current = null;
    };
  }, []);

  return { quotes, connected, alertEvents };
}

/** Animated number counter. */
export function useCountUp(target: number | null, durationMs = 700): number | null {
  const [value, setValue] = useState<number | null>(target);
  const fromRef = useRef<number>(target ?? 0);
  useEffect(() => {
    if (target === null) return;
    const from = fromRef.current ?? target;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

export function useNow(intervalMs = 1000): Date | null {
  // null on first render (SSR) to avoid hydration mismatch
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date()); // set immediately after mount (client only)
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Stable callback for interval refresh. */
export function useInterval(cb: () => void, ms: number | null) {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  }, [cb]);
  useEffect(() => {
    if (ms === null) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function usePost<T>() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const post = useCallback(async (url: string, body: unknown): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Failed: ${res.status}`);
      return j as T;
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  return { post, loading, error };
}
