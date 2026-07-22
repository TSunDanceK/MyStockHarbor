"use client";

import { useEffect, useId, useRef } from "react";

type Props = {
  symbol: string;
  height?: number;
};

declare global {
  interface Window {
    TradingView?: {
      widget: new (config: Record<string, unknown>) => unknown;
    };
  }
}

// Renders TradingView's free "Advanced Chart" widget (tv.js). This component
// is only ever mounted when the user clicks the "Switch to TradingView
// chart" toggle in PriceChart.tsx -- so the ~500KB tv.js script, and the
// widget itself, are never fetched/created for the default (custom SVG
// chart) experience. Unmounting this component (switching back) does not
// unload the already-cached script -- a second toggle click on the same
// page load reuses it instantly instead of re-fetching.
//
// `allow_symbol_change` is deliberately FALSE: the dashboard drives which
// ticker is being analysed from its own header search, and the TradingView
// pane is meant to mirror that active symbol. With symbol-change enabled,
// tv.js persists the last symbol a user typed into the widget (in the
// browser's localStorage) and restores it on the next mount -- so opening
// TradingView while analysing TSLA could show a previously-viewed ticker
// (e.g. Hasbro) instead of TSLA. Pinning the symbol makes the pane always
// open on the stock currently in view. Users who want to explore other
// tickers freely can use the "Open in TradingView ↗" link.
export default function TradingViewChartEmbed({ symbol, height = 480 }: Props) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const containerId = `tradingview-embed-${rawId}`;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const existingScript = document.getElementById(
      "tradingview-tv-js-script"
    ) as HTMLScriptElement | null;

    function createWidget() {
      if (cancelled) return;
      if (!containerRef.current) return;
      if (typeof window.TradingView === "undefined") return;

      containerRef.current.innerHTML = "";

      new window.TradingView.widget({
        autosize: true,
        symbol,
        interval: "D",
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        toolbar_bg: "#0b1220",
        enable_publishing: false,
        allow_symbol_change: false,
        hide_top_toolbar: false,
        withdateranges: true,
        container_id: containerId,
      });
    }

    if (existingScript) {
      if (typeof window.TradingView !== "undefined") {
        createWidget();
      } else {
        existingScript.addEventListener("load", createWidget);
      }
    } else {
      const script = document.createElement("script");
      script.id = "tradingview-tv-js-script";
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = createWidget;
      document.body.appendChild(script);
    }

    return () => {
      cancelled = true;
      existingScript?.removeEventListener("load", createWidget);
    };
  }, [symbol, containerId]);

  return (
    <div
      style={{
        width: "100%",
        height,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #3333",
      }}
    >
      <div id={containerId} ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
