"use client";

/**
 * PriceChart — TradingView Lightweight Charts v5 wrapper.
 * Features:
 * - Robust StrictMode-safe lifecycle with autoSize & ResizeObserver fallback
 * - Series reuse: updates data in-place without tearing down the chart
 * - Real-time live quote updates with sub-second candle tick updates
 * - Safe marker and price line management (time-ordered, deduplicated)
 */
import { useEffect, useRef, useState, useTransition } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  BarSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type IPriceLine,
} from "lightweight-charts";
import type { Candle } from "@/lib/engines/types";

export interface ChartOverlays {
  fvg?: { top: number; bottom: number; direction: string; filled: boolean }[];
  orderBlocks?: { top: number; bottom: number; direction: string; kind: string }[];
  liquidityPools?: { price: number; label: string; side: string }[];
  fib?: { price: number; label: string }[];
  vwap?: { time: number; value: number }[];
  pdhPdl?: { price: number; label: string }[];
  structureEvents?: { time: number; kind: string; direction: string; price: number }[];
}

export interface PriceChartProps {
  candles: Candle[];
  chartType: "candles" | "line" | "area" | "bars";
  overlays?: ChartOverlays;
  overlayToggles?: Record<string, boolean>;
  liveQuote?: { price: number; time?: string } | null;
  height?: number;
  precision?: number;
  className?: string;
}

// Institutional Trading Terminal theme constants
const BULLISH_COLOR = "#FFE600"; // Bright neon gold / electric yellow
const BEARISH_COLOR = "#A6A6A6"; // Light grey
const BG_CHART = "#000000"; // Pure black chart canvas
const BG_PANEL = "#050505"; // Deep terminal black container
const GRID_COLOR = "#151515"; // Very subtle grid lines
const TEXT_MUTED = "#858585"; // Muted grey text & axis labels
const BORDER_SCALE = "#151515"; // Subtle scale border
const CROSSHAIR_COLOR = "rgba(133,133,133,0.4)"; // Subtle grey dotted crosshair

export default function PriceChart({
  candles,
  chartType,
  overlays = {},
  overlayToggles = {},
  liveQuote = null,
  height = 480,
  precision = 2,
  className,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<"Candlestick" | "Line" | "Area" | "Bar"> | null>(null);
  const currentChartTypeRef = useRef<string | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastCandleRef = useRef<Candle | null>(null);
  const hasFramedRef = useRef<boolean>(false);

  const [hover, setHover] = useState<Candle | null>(null);
  const [, startTransition] = useTransition();

  // 1. Initialize Chart Instance Once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let chart = chartRef.current;
    let roCleanup: (() => void) | undefined;

    if (!chart) {
      chart = createChart(el, {
        width: el.clientWidth || el.parentElement?.clientWidth || 800,
        height,
        layout: {
          background: { type: ColorType.Solid, color: BG_CHART },
          textColor: TEXT_MUTED,
          fontSize: 10,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: GRID_COLOR },
          horzLines: { color: GRID_COLOR },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: CROSSHAIR_COLOR,
            width: 1,
            style: LineStyle.Dotted,
            labelBackgroundColor: "#0c0c0e",
          },
          horzLine: {
            color: CROSSHAIR_COLOR,
            width: 1,
            style: LineStyle.Dotted,
            labelBackgroundColor: "#0c0c0e",
          },
        },
        rightPriceScale: {
          borderColor: BORDER_SCALE,
          scaleMargins: { top: 0.08, bottom: 0.22 },
        },
        timeScale: {
          borderColor: BORDER_SCALE,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 6,
        },
        handleScroll: true,
        handleScale: true,
      });

      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
        color: "rgba(166,166,166,0.5)",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

      chart.subscribeCrosshairMove((param) => {
        const main = mainSeriesRef.current;
        if (!param.time || !main) {
          setHover((prev) => (prev === null ? prev : null));
          return;
        }
        const d = param.seriesData.get(main) as Record<string, number> | undefined;
        if (!d) {
          setHover((prev) => (prev === null ? prev : null));
          return;
        }
        const nextTime = param.time as number;
        const nextOpen = d.open ?? d.value ?? 0;
        const nextHigh = d.high ?? d.value ?? 0;
        const nextLow = d.low ?? d.value ?? 0;
        const nextClose = d.close ?? d.value ?? 0;

        setHover((prev) => {
          if (
            prev &&
            prev.time === nextTime &&
            prev.open === nextOpen &&
            prev.high === nextHigh &&
            prev.low === nextLow &&
            prev.close === nextClose
          ) {
            return prev;
          }
          return {
            time: nextTime,
            open: nextOpen,
            high: nextHigh,
            low: nextLow,
            close: nextClose,
          };
        });
      });

      chartRef.current = chart;
      volSeriesRef.current = volSeries;

      // ResizeObserver: fires whenever the container's width changes (including
      // after Framer Motion animation completes) and re-applies correct width.
      const ro = new ResizeObserver((entries) => {
        const c = chartRef.current;
        if (!c) return;
        for (const entry of entries) {
          const w = entry.contentRect.width;
          if (w > 50) {
            c.applyOptions({ width: w, height });
          }
        }
      });
      ro.observe(el);
      roCleanup = () => ro.disconnect();

      // Kick a forced resize after the Framer animation (450ms) completes
      // so the chart fills its container even if ResizeObserver fires late.
      const raf1 = requestAnimationFrame(() => {
        const w = el.clientWidth || el.parentElement?.clientWidth;
        if (w && w > 50 && chartRef.current) {
          chartRef.current.applyOptions({ width: w, height });
        }
      });
      const t1 = setTimeout(() => {
        const w = el.clientWidth || el.parentElement?.clientWidth;
        if (w && w > 50 && chartRef.current) {
          chartRef.current.applyOptions({ width: w, height });
        }
      }, 500); // after GlassPanel animation (450ms)
      const t2 = setTimeout(() => {
        const w = el.clientWidth || el.parentElement?.clientWidth;
        if (w && w > 50 && chartRef.current) {
          chartRef.current.applyOptions({ width: w, height });
        }
      }, 1000);

      return () => {
        cancelAnimationFrame(raf1);
        clearTimeout(t1);
        clearTimeout(t2);
        roCleanup?.();
      };
    }

    return () => { roCleanup?.(); };
  }, [height]);

  // 2. Manage Series and Data
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const pf = { type: "price" as const, precision, minMove: 1 / 10 ** precision };

    // Recreate series only if chartType changed or main series is null
    if (!mainSeriesRef.current || currentChartTypeRef.current !== chartType) {
      if (mainSeriesRef.current) {
        try {
          chart.removeSeries(mainSeriesRef.current);
        } catch {}
      }
      markersRef.current = null;
      priceLinesRef.current = [];

      let s: ISeriesApi<"Candlestick" | "Line" | "Area" | "Bar">;
      if (chartType === "candles") {
        s = chart.addSeries(CandlestickSeries, {
          upColor: BULLISH_COLOR,
          downColor: BEARISH_COLOR,
          borderVisible: true,
          borderUpColor: BULLISH_COLOR,
          borderDownColor: BEARISH_COLOR,
          wickVisible: true,
          wickUpColor: BULLISH_COLOR,
          wickDownColor: BEARISH_COLOR,
          priceFormat: pf,
        });
      } else if (chartType === "line") {
        s = chart.addSeries(LineSeries, {
          color: BULLISH_COLOR,
          lineWidth: 2,
          priceFormat: pf,
        });
      } else if (chartType === "area") {
        s = chart.addSeries(AreaSeries, {
          lineColor: BULLISH_COLOR,
          topColor: "rgba(255,230,0,0.22)",
          bottomColor: "rgba(255,230,0,0.00)",
          lineWidth: 2,
          priceFormat: pf,
        });
      } else {
        s = chart.addSeries(BarSeries, {
          upColor: BULLISH_COLOR,
          downColor: BEARISH_COLOR,
          priceFormat: pf,
        });
      }

      mainSeriesRef.current = s;
      currentChartTypeRef.current = chartType;
      try {
        markersRef.current = createSeriesMarkers(s, []);
      } catch {}
    }

    const s = mainSeriesRef.current;
    if (!s) return;

    // Load candle data
    if (candles && candles.length > 0) {
      // Ensure strictly sorted ascending by timestamp
      const sorted = [...candles].sort((a, b) => a.time - b.time);
      const data = sorted
        .map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          value: c.close,
        }))
        .filter((d, i, arr) => i === 0 || d.time > arr[i - 1].time);

      s.setData(data as never);
      lastCandleRef.current = sorted[sorted.length - 1];

      // Volume series with bright neon yellow (bullish) and muted grey (bearish) ~45-55% opacity
      if (volSeriesRef.current) {
        const volData = sorted
          .map((c) => ({
            time: c.time as UTCTimestamp,
            value: c.volume ?? 0,
            color: c.close >= c.open ? "rgba(255,230,0,0.55)" : "rgba(166,166,166,0.50)",
          }))
          .filter((d, i, arr) => i === 0 || d.time > arr[i - 1].time);
        volSeriesRef.current.setData(volData as never);
      }

      // Initial frame of recent bars (only once per candle dataset)
      if (!hasFramedRef.current && data.length > 2) {
        const barsShown = Math.min(140, data.length);
        chart.timeScale().setVisibleLogicalRange({
          from: data.length - barsShown,
          to: data.length + 4,
        });
        hasFramedRef.current = true;
      }
    }

    // ---- Clear and Re-add Price Lines on Active Series ----
    for (const l of priceLinesRef.current) {
      try {
        s.removePriceLine(l);
      } catch {}
    }
    priceLinesRef.current = [];

    const addPriceLine = (
      price: number,
      title: string,
      style: LineStyle,
      color: string,
      width: 1 | 2 | 3 | 4 = 1
    ) => {
      try {
        if (!isNaN(price) && isFinite(price) && price > 0) {
          const pl = s.createPriceLine({
            price,
            color,
            lineWidth: width,
            lineStyle: style,
            axisLabelVisible: true,
            title,
          });
          priceLinesRef.current.push(pl);
        }
      } catch {}
    };

    if (overlayToggles.fvg) {
      for (const z of (overlays.fvg ?? []).filter((f) => !f.filled).slice(-6)) {
        addPriceLine(
          z.top,
          `FVG ${z.direction === "BULLISH" ? "▲" : "▼"}`,
          LineStyle.Dotted,
          z.direction === "BULLISH" ? "rgba(255,255,255,0.45)" : "rgba(160,160,170,0.5)"
        );
        addPriceLine(
          z.bottom,
          "",
          LineStyle.Dotted,
          z.direction === "BULLISH" ? "rgba(255,255,255,0.25)" : "rgba(160,160,170,0.3)"
        );
      }
    }

    if (overlayToggles.orderBlocks) {
      for (const z of (overlays.orderBlocks ?? []).slice(-5)) {
        addPriceLine(
          z.top,
          `${z.kind.replace("_", " ")} ${z.direction === "BULLISH" ? "▲" : "▼"}`,
          LineStyle.Solid,
          z.direction === "BULLISH" ? "rgba(255,255,255,0.4)" : "rgba(160,160,170,0.45)"
        );
        addPriceLine(z.bottom, "", LineStyle.Solid, "rgba(160,160,170,0.25)");
      }
    }

    if (overlayToggles.liquidity) {
      for (const p of (overlays.liquidityPools ?? []).slice(0, 8)) {
        addPriceLine(p.price, "LIQ", LineStyle.Dashed, "rgba(212,212,216,0.55)");
      }
    }

    if (overlayToggles.fib) {
      for (const f of overlays.fib ?? []) {
        addPriceLine(f.price, `FIB ${f.label}`, LineStyle.LargeDashed, "rgba(212,212,216,0.35)");
      }
    }

    if (overlayToggles.pdhPdl) {
      for (const p of overlays.pdhPdl ?? []) {
        addPriceLine(p.price, p.label, LineStyle.Solid, "rgba(255,255,255,0.5)", 2);
      }
    }

    // ---- VWAP overlay ----
    if (vwapSeriesRef.current) {
      try {
        chart.removeSeries(vwapSeriesRef.current);
      } catch {}
      vwapSeriesRef.current = null;
    }
    if (overlayToggles.vwap && overlays.vwap?.length) {
      const v = chart.addSeries(LineSeries, {
        color: "rgba(212,212,216,0.55)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      vwapSeriesRef.current = v;
      const seen = new Set<number>();
      v.setData(
        overlays.vwap
          .filter((p) => {
            if (seen.has(p.time)) return false;
            seen.add(p.time);
            return true;
          })
          .map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      );
    }

    // ---- Structure markers (strictly time-ordered and unique) ----
    if (markersRef.current && candles.length > 0) {
      try {
        const candleTimes = new Set(candles.map((c) => c.time));
        const events = overlayToggles.structure
          ? (overlays.structureEvents ?? [])
              .filter((e) => candleTimes.has(e.time))
              .sort((a, b) => a.time - b.time)
              .filter((e, idx, arr) => idx === 0 || e.time > arr[idx - 1].time)
              .slice(-14)
          : [];

        markersRef.current.setMarkers(
          events.map((e) => ({
            time: e.time as UTCTimestamp,
            position: e.direction === "BULLISH" ? "belowBar" : "aboveBar",
            color: e.direction === "BULLISH" ? "rgba(255,255,255,0.9)" : "rgba(140,140,150,0.9)",
            shape: e.kind === "MSS" || e.kind === "CHoCH" ? "circle" : e.direction === "BULLISH" ? "arrowUp" : "arrowDown",
            text:
              e.kind === "BOS"
                ? e.direction === "BULLISH"
                  ? "▲BOS"
                  : "▼BOS"
                : e.kind === "CHoCH"
                ? "●CHoCH"
                : e.kind === "MSS"
                ? "●MSS"
                : "",
            size: 1,
          }))
        );
      } catch {}
    }
  }, [candles, chartType, precision, overlays, overlayToggles]);

  // 3. Real-time Live Quote Tick: update last candle immediately with zero latency
  useEffect(() => {
    if (!liveQuote?.price || !mainSeriesRef.current || !lastCandleRef.current) return;
    const price = liveQuote.price;
    const last = lastCandleRef.current;
    try {
      mainSeriesRef.current.update({
        time: last.time as UTCTimestamp,
        open: last.open,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
        close: price,
        value: price,
      });
      lastCandleRef.current = {
        ...last,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
        close: price,
      };
    } catch {}
  }, [liveQuote]);

  // 4. Dispose on Unmount
  useEffect(() => {
    return () => {
      try {
        chartRef.current?.remove();
      } catch {}
      chartRef.current = null;
      mainSeriesRef.current = null;
      volSeriesRef.current = null;
      vwapSeriesRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  const last = candles && candles.length ? candles[candles.length - 1] : null;
  const currentPrice = liveQuote?.price ?? last?.close;

  return (
    <div className={className} style={{ backgroundColor: BG_PANEL }}>
      <div className="flex items-center justify-between px-3 pt-2 pb-1 border-b border-[#151515]" style={{ backgroundColor: BG_PANEL }}>
        <div className="flex items-center gap-3 text-[10px] text-[#858585]">
          {hover ? (
            <span className="num text-[#d4d4d8]">
              <span className="text-[#858585]">O</span> {hover.open?.toFixed(precision)} · <span className="text-[#858585]">H</span> {hover.high?.toFixed(precision)} · <span className="text-[#858585]">L</span> {hover.low?.toFixed(precision)} · <span className="text-[#858585]">C</span> {hover.close?.toFixed(precision)}
            </span>
          ) : last ? (
            <span className="num text-[#d4d4d8]">
              <span className="text-[#858585]">O</span> {last.open.toFixed(precision)} · <span className="text-[#858585]">H</span> {last.high.toFixed(precision)} · <span className="text-[#858585]">L</span> {last.low.toFixed(precision)} · <span className="text-[#858585]">C</span> {currentPrice?.toFixed(precision) ?? last.close.toFixed(precision)}
            </span>
          ) : (
            <span className="text-[#858585]">Connecting to Gold feed…</span>
          )}
        </div>
        <div className="text-[9px] uppercase tracking-widest text-[#858585] flex items-center gap-2">
          {liveQuote?.price ? (
            <span className="flex items-center gap-1.5 text-[#FFE600] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FFE600] animate-pulse" />
              LIVE TICK {liveQuote.price.toFixed(precision)}
            </span>
          ) : null}
          <span className="text-[#555555]">TradingView Lightweight Charts</span>
        </div>
      </div>
      <div
        ref={containerRef}
        className="tv-chart w-full"
        style={{ height, minHeight: height, position: "relative", backgroundColor: BG_CHART }}
      />
    </div>
  );
}
