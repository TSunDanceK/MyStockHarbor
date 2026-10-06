import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { getPostBySlug } from "@/lib/blog";
import { getInsightPageDataCached } from "@/lib/server/insightPage";

/**
 * THE POST'S PICTURE AS THE SHARE IMAGE (#563 COWORK #133): the hero's library
 * art, as a JPEG data URI (next/og draws no WebP). Read from the deployment's
 * own public/ folder, else from the production site; null on any failure, and
 * the image falls back to the branded card.
 */
async function heroArt(src: string): Promise<string | null> {
  if (!/^\/news-art\/[\w.-]+\.webp$/.test(src)) return null;
  try {
    let buf: Buffer | null = null;
    try {
      buf = fs.readFileSync(path.join(process.cwd(), "public", src));
    } catch {
      const res = await fetch(`https://www.mystockharbor.com${src}`, { signal: AbortSignal.timeout(4000) });
      buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    }
    if (!buf) return null;
    const sharp = (await import("sharp")).default;
    const jpg = await sharp(buf).resize(1200, 630, { fit: "cover" }).jpeg({ quality: 78 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString("base64")}`;
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "MyStockHarbor Insight";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Props = {
  params: Promise<{ slug: string }>;
};

function setupBadge(timeframe: "d" | "w", indicators: string[]): string {
  const tf = timeframe === "w" ? "Weekly" : "Daily";
  if (!indicators.length) return tf;

  const label = indicators[0]
    .replace("MACD(12,26,9)", "MACD")
    .replace("RSI(14)", "RSI")
    .replace("Stochastic(14,3)", "Stochastic")
    .replace("Bollinger(20,2)", "Bollinger")
    .replace("VWMA(20)", "VWMA")
    .replace("ATR(14)", "ATR");

  return `${tf} · ${label}`;
}

export default async function OGImage({ params }: Props) {
  const { slug } = await params;

  let title = "Stock Market Insight";
  let symbol: string | null = null;
  let badge = "Daily · Technical Analysis";

  let art: string | null = null;
  try {
    const post = getPostBySlug(slug);
    title = post.title;
    symbol = post.symbol ?? null;
    badge = setupBadge(post.timeframe, post.chartIndicators);
    // The page's own label and picture, from its cached data: the badge
    // matches the page's one setup label (#132), never the frontmatter.
    const d = await getInsightPageDataCached(slug).catch(() => null);
    if (d?.label) badge = `${post.timeframe === "w" ? "Weekly" : "Daily"} · ${d.label.text}`;
    if (d?.art.kind === "library") art = await heroArt(d.art.art.src);
  } catch {
    // Slug not found — render generic fallback
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "linear-gradient(135deg, #060c18 0%, #0b1628 60%, #0d1f35 100%)",
          padding: "64px 72px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* The post's picture under a dark gradient, when it has one. */}
        {art ? (
          <img src={art} width={1200} height={630} alt="" style={{ position: "absolute", inset: 0, width: 1200, height: 630, objectFit: "cover" }} />
        ) : null}
        {art ? (
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(6,12,24,0.35) 0%, rgba(6,12,24,0.82) 60%, rgba(6,12,24,0.96) 100%)" }} />
        ) : null}
        {/* Subtle grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(95,212,199,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(95,212,199,0.04) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Top row — branding */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                border: "2px solid #5fd4c7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#5fd4c7",
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              ⚓
            </div>
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "#6fe0d0",
                letterSpacing: 0.5,
              }}
            >
              MyStockHarbor
            </span>
          </div>

          {/* Setup badge */}
          <div
            style={{
              background: "rgba(95,212,199,0.12)",
              border: "1px solid rgba(95,212,199,0.3)",
              borderRadius: 8,
              padding: "8px 18px",
              fontSize: 18,
              color: "#5fd4c7",
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            {badge}
          </div>
        </div>

        {/* Middle — ticker + title */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            flex: 1,
            justifyContent: "center",
          }}
        >
          {symbol && (
            <div
              style={{
                fontSize: 88,
                fontWeight: 800,
                color: "#5fd4c7",
                letterSpacing: -1,
                lineHeight: 1,
                textShadow: "0 0 40px rgba(95,212,199,0.25)",
              }}
            >
              {symbol}
            </div>
          )}

          <div
            style={{
              fontSize: symbol ? 36 : 48,
              fontWeight: 600,
              color: "#eaf2ff",
              lineHeight: 1.3,
              maxWidth: 960,
            }}
          >
            {title}
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: 24,
          }}
        >
          <div
            style={{
              fontSize: 18,
              color: "rgba(241,245,249,0.45)",
              letterSpacing: 0.5,
            }}
          >
            Stock analysis · Not financial advice
          </div>
          <div
            style={{
              fontSize: 18,
              color: "rgba(111,224,208,0.6)",
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            mystockharbor.com
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
