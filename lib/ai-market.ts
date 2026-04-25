import { unstable_cache } from "next/cache";


export type MarketAnalysis = {
  summary: string;
  bullish: string[];
  bearish: string[];
  watch: string[];
  generatedAt: string;
};

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  const record = payload as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }

  if (Array.isArray(record.output)) {
    const text = record.output
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .find((part) => part?.type === "output_text" && typeof part.text === "string")?.text;

    return typeof text === "string" ? text.trim() : "";
  }

  return "";
}

function sanitizeLines(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [] as string[];

  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => String(item).trim())
    .slice(0, maxItems);
}

async function generateSpxMarketAnalysis(_timeBucket?: number): Promise<MarketAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_NEWS_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    return null;
  }

  const schema = {
    name: "spx_market_analysis",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: {
          type: "string",
        },
        bullish: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
        },
        bearish: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
        },
        watch: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
        },
      },
      required: ["summary", "bullish", "bearish", "watch"],
    },
  };

  const systemPrompt =
    "You write concise S&P 500 market overview copy for MyStockHarbor, a beginner-friendly stock analysis site. " +
    "Keep the tone calm, balanced, and educational. " +
    "Do not invent specific macro events, dates, earnings, or exact levels unless they are explicitly provided. " +
    "Do not give financial advice or make dramatic predictions. " +
    "The summary should be one paragraph of 80 to 140 words, explaining the current broad market backdrop in plain English. " +
    "The bullish, bearish, and watch arrays should each contain 2 to 4 short plain-English lines. " +
    "Be specific enough to feel useful, but avoid fake precision, hype, and sensational language.";

  const userPrompt = JSON.stringify({
    market: "S&P 500",
    symbol: "^GSPC",
    context:
      "Generate a broad market backdrop summary for a live SPX analysis page. This page already has its own live chart, so focus on general market structure, risk appetite, and what investors may watch next.",
  });

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 900,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: userPrompt,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          ...schema,
        },
      },
    }),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as unknown;
  const rawText = extractResponseText(data);

  if (!rawText) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawText) as {
      summary?: string;
      bullish?: string[];
      bearish?: string[];
      watch?: string[];
    };

    if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
      return null;
    }

    return {
      summary: parsed.summary.trim(),
      bullish: sanitizeLines(parsed.bullish, 4),
      bearish: sanitizeLines(parsed.bearish, 4),
      watch: sanitizeLines(parsed.watch, 4),
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

const getCachedSpxMarketAnalysis = unstable_cache(
  async () => {
    const nowBucket = Math.floor(Date.now() / (1000 * 60 * 60 * 12));
    return generateSpxMarketAnalysis(nowBucket);
  },
  ["msh-spx-market-analysis-v3"],
  {
    revalidate: 60 * 60 * 12,
  }
);

export async function getSpxMarketAnalysis(): Promise<MarketAnalysis | null> {
  try {
    return await getCachedSpxMarketAnalysis();
  } catch {
    return null;
  }
}
