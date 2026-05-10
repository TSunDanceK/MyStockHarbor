import { unstable_cache } from "next/cache";

export type AiNewsBriefInputItem = {
  title: string;
  source: string | null;
  pubDate: string | null;
  description: string | null;
};

export type AiNewsBrief = {
  summary: string;
  whyItMatters: string;
  tone: "Bullish leaning" | "Neutral" | "Bearish leaning" | "Mixed";
  confidence: "Low" | "Medium" | "High";
};

type BatchInput = {
  symbol: string;
  companyName: string;
  trend: string;
  newsScoreLabel: string;
  items: AiNewsBriefInputItem[];
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

async function generateAiNewsBriefs(input: BatchInput): Promise<AiNewsBrief[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_NEWS_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    return [];
  }

  const schema = {
    name: "stock_news_briefs",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: {
                  type: "string",
                },
                whyItMatters: {
                  type: "string",
                },
                tone: {
                  type: "string",
                  enum: ["Bullish leaning", "Neutral", "Bearish leaning", "Mixed"],
                },
                confidence: {
                  type: "string",
                  enum: ["Low", "Medium", "High"],
                },
              },
              required: ["summary", "whyItMatters", "tone", "confidence"],
            },
          },
      },
      required: ["items"],
    },
  };

  const systemPrompt =
    "You write short investor context lines for MyStockHarbor, a beginner-friendly stock analysis site. " +
    "Use only the provided headline, source, publication date, feed description, stock symbol, company name, trend context, and news-score label. " +
    "Return one output item for each input article in the exact same order. " +
    "The page already shows the original headline and FMP feed excerpt, so do not rewrite or summarise the article. " +
    "Set summary to an empty string unless a few words are needed for valid JSON. " +
    "Use whyItMatters for one short investor-focused sentence explaining why the item could matter for sentiment, earnings expectations, regulation, demand, margins, valuation, or the chart. " +
    "If the article appears vague, recycled, thin, or low-information, say what traders may watch instead. " +
    "Do not invent facts. Do not imply full article access or independent verification. " +
    "Keep whyItMatters under 28 words. " +
    "Use 'Neutral' when the item is informative without a clear directional lean. Use 'Mixed' only when the article contains genuinely offsetting positives and negatives. " +
    "Avoid hype, predictions, sensational language, fake certainty, and filler.";

  const userPrompt = JSON.stringify(input);

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 550,
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
    return [];
  }

  const data = (await res.json()) as unknown;
  const rawText = extractResponseText(data);

  if (!rawText) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawText) as { items?: AiNewsBrief[] };

    if (!Array.isArray(parsed.items)) {
      return [];
    }

    return parsed.items.slice(0, input.items.length).filter((item) => {
      return (
        typeof item?.summary === "string" &&
        typeof item?.whyItMatters === "string" &&
        typeof item?.tone === "string" &&
        typeof item?.confidence === "string"
      );
    });
  } catch {
    return [];
  }
}

const getCachedAiNewsBriefs = unstable_cache(
  async (payloadJson: string) => {
    const payload = JSON.parse(payloadJson) as BatchInput;
    return generateAiNewsBriefs(payload);
  },
  ["msh-ai-news-briefs-v4-why-only"],
  {
    revalidate: 60 * 60,
  }
);

export async function getAiNewsBriefs(input: BatchInput): Promise<AiNewsBrief[]> {
  if (!input.items.length) {
    return [];
  }

  try {
    return await getCachedAiNewsBriefs(JSON.stringify(input));
  } catch {
    return [];
  }
}
export type AiNewsInsight = {
  beyondHeadline: string;
  whatItMeans: string[];
};

type InsightInput = {
  symbol: string;
  companyName: string;
  trend: string;
  newsScoreLabel: string;
  newsScoreValue: number;
  earningsTone: string;
  rsi: number | null;
  priceVs50: number | null;
  priceVs200: number | null;
  recentHigh: number | null;
  recentLow: number | null;
  items: Array<{
    title: string;
    source: string | null;
    pubDate: string | null;
    description: string | null;
    summary: string | null;
    whyItMatters: string | null;
  }>;
};

async function generateAiNewsInsight(input: InsightInput): Promise<AiNewsInsight | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_NEWS_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    return null;
  }

  const schema = {
    name: "stock_news_insight",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        beyondHeadline: {
          type: "string",
        },
        whatItMeans: {
          type: "array",
          items: {
            type: "string",
          },
          minItems: 2,
          maxItems: 3,
        },
      },
      required: ["beyondHeadline", "whatItMeans"],
    },
  };

  const systemPrompt =
    "You write concise stock-news insight copy for MyStockHarbor, a beginner-friendly stock analysis site. " +
    "Use only the provided symbol, company name, trend, news score, earnings tone, RSI, distance vs moving averages, recent range levels, and the provided top article details. " +
    "Do not invent facts. Do not imply full article access or independent verification. " +
    "Your job is to identify the dominant current catalyst in the provided coverage, then combine that with the chart context into one calm editorial read. " +
    "Weight the freshest and most consequential article most heavily. Use older, weaker, or more generic stories only as supporting background. Do not give equal emphasis to every item if one story clearly leads the narrative. " +
    "Do not flatten a clearly important development into a generic blended summary. " +
    "The beyondHeadline field should be one paragraph of 80 to 140 words. It should explain the leading theme in the current coverage, what remains uncertain, and what traders may be watching next. " +
    "The whatItMeans field should return 2 to 3 short plain-English bullet-style lines, each one sentence, each distinct, and each useful for a beginner. " +
    "Be specific, not generic. Avoid filler, hype, certainty, predictions, and dramatic language.";

  const userPrompt = JSON.stringify(input);

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
      beyondHeadline?: string;
      whatItMeans?: string[];
    };

    if (
      typeof parsed.beyondHeadline !== "string" ||
      !Array.isArray(parsed.whatItMeans) ||
      parsed.whatItMeans.length < 2
    ) {
      return null;
    }

    const cleanedLines = parsed.whatItMeans
      .filter((line) => typeof line === "string" && line.trim())
      .slice(0, 3);

    if (!cleanedLines.length) {
      return null;
    }

    return {
      beyondHeadline: parsed.beyondHeadline.trim(),
      whatItMeans: cleanedLines,
    };
  } catch {
    return null;
  }
}

const getCachedAiNewsInsight = unstable_cache(
  async (payloadJson: string) => {
    const payload = JSON.parse(payloadJson) as InsightInput;
    return generateAiNewsInsight(payload);
  },
  ["msh-ai-news-insight-v3"],
  {
    revalidate: 60 * 60,
  }
);

export async function getAiNewsInsight(input: InsightInput): Promise<AiNewsInsight | null> {
  if (!input.items.length) {
    return null;
  }

  try {
    return await getCachedAiNewsInsight(JSON.stringify(input));
  } catch {
    return null;
  }
}

