import { Redis } from "@upstash/redis";

export type AiStockAnalysis = {
  symbol: string;
  generatedAt: string;
  businessSummary: string;
  fundamentalsSummary: string;
  futurePotentialSummary: string;
  bullishFactors: string[];
  bearishFactors: string[];
  watchPoints: string[];
  fundamentalsScore: number;
  futurePotentialScore: number;
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const REDIS_PREFIX = "msh:ai:stock-analysis:v1";
const REDIS_TTL_SECONDS = 7 * 24 * 60 * 60;

function getRedisKey(symbol: string) {
  return `${REDIS_PREFIX}:${String(symbol).trim().toUpperCase()}`;
}

function normalizeSymbol(symbol: string) {
  return String(symbol).trim().toUpperCase();
}

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

function clampScore(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 50;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function sanitizeLines(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [] as string[];

  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => String(item).trim())
    .slice(0, maxItems);
}

function isValidAnalysis(payload: unknown): payload is AiStockAnalysis {
  if (!payload || typeof payload !== "object") return false;

  const record = payload as AiStockAnalysis;

  return (
    typeof record.symbol === "string" &&
    typeof record.generatedAt === "string" &&
    typeof record.businessSummary === "string" &&
    typeof record.fundamentalsSummary === "string" &&
    typeof record.futurePotentialSummary === "string" &&
    Array.isArray(record.bullishFactors) &&
    Array.isArray(record.bearishFactors) &&
    Array.isArray(record.watchPoints) &&
    typeof record.fundamentalsScore === "number" &&
    typeof record.futurePotentialScore === "number"
  );
}

async function readCachedAnalysis(symbol: string) {
  if (!redis) return null;

  try {
    const cached = await redis.get<AiStockAnalysis>(getRedisKey(symbol));
    if (!isValidAnalysis(cached)) return null;
    if (cached.symbol !== normalizeSymbol(symbol)) return null;
    return cached;
  } catch {
    return null;
  }
}

async function writeCachedAnalysis(symbol: string, analysis: AiStockAnalysis) {
  if (!redis) return;

  try {
    await redis.set(getRedisKey(symbol), analysis, {
      ex: REDIS_TTL_SECONDS,
    });
  } catch {
    // fail open
  }
}

async function generateAiStockAnalysis(symbol: string): Promise<AiStockAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_NEWS_MODEL || "gpt-4.1-mini";
  const upper = normalizeSymbol(symbol);

  if (!apiKey) {
    return null;
  }

  const schema = {
    name: "stock_company_outlook",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        businessSummary: { type: "string" },
        fundamentalsSummary: { type: "string" },
        futurePotentialSummary: { type: "string" },
        bullishFactors: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
        },
        bearishFactors: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
        },
        watchPoints: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
        },
        fundamentalsScore: {
          type: "integer",
          minimum: 0,
          maximum: 100,
        },
        futurePotentialScore: {
          type: "integer",
          minimum: 0,
          maximum: 100,
        },
      },
      required: [
        "businessSummary",
        "fundamentalsSummary",
        "futurePotentialSummary",
        "bullishFactors",
        "bearishFactors",
        "watchPoints",
        "fundamentalsScore",
        "futurePotentialScore",
      ],
    },
  };

  const systemPrompt =
    "You write cautious stock research summary copy for MyStockHarbor, a beginner-friendly stock analysis site. " +
    "You are generating a broad business and future-potential overview for a stock page using only the ticker symbol provided. " +
    "Because no live fundamentals dataset is being supplied, you must stay high-level, cautious, and educational. " +
    "Do not invent precise revenue, earnings, margins, valuation multiples, dates, or corporate events. " +
    "If uncertainty is high, keep wording broader and focus on business model quality, strategic positioning, common investor considerations, and risk balance. " +
    "Do not give financial advice. Do not tell the user to buy, sell, or predict price direction. " +
    "The businessSummary should be 2 to 3 sentences explaining what the company broadly does and why investors follow it. " +
    "The fundamentalsSummary should be 2 to 3 sentences explaining the likely business-quality and financial-strength picture at a high level, without invented numbers. " +
    "The futurePotentialSummary should be 2 to 3 sentences explaining what could support future upside and what could limit it. " +
    "Bullish factors, bearish factors, and watch points should be short plain-English lines. " +
    "The fundamentalsScore should reflect broad business quality and resilience, not short-term price action. " +
    "The futurePotentialScore should reflect medium-term upside potential versus execution and valuation risk. " +
    "Avoid hype, certainty, sensational language, and fake precision.";

  const userPrompt = JSON.stringify({
    symbol: upper,
  });

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 1200,
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
      businessSummary?: string;
      fundamentalsSummary?: string;
      futurePotentialSummary?: string;
      bullishFactors?: string[];
      bearishFactors?: string[];
      watchPoints?: string[];
      fundamentalsScore?: number;
      futurePotentialScore?: number;
    };

    const businessSummary =
      typeof parsed.businessSummary === "string" ? parsed.businessSummary.trim() : "";
    const fundamentalsSummary =
      typeof parsed.fundamentalsSummary === "string"
        ? parsed.fundamentalsSummary.trim()
        : "";
    const futurePotentialSummary =
      typeof parsed.futurePotentialSummary === "string"
        ? parsed.futurePotentialSummary.trim()
        : "";

    if (!businessSummary || !fundamentalsSummary || !futurePotentialSummary) {
      return null;
    }

    return {
      symbol: upper,
      generatedAt: new Date().toISOString(),
      businessSummary,
      fundamentalsSummary,
      futurePotentialSummary,
      bullishFactors: sanitizeLines(parsed.bullishFactors, 4),
      bearishFactors: sanitizeLines(parsed.bearishFactors, 4),
      watchPoints: sanitizeLines(parsed.watchPoints, 4),
      fundamentalsScore: clampScore(parsed.fundamentalsScore),
      futurePotentialScore: clampScore(parsed.futurePotentialScore),
    };
  } catch {
    return null;
  }
}

export async function getAiStockAnalysis(symbol: string): Promise<AiStockAnalysis | null> {
  const upper = normalizeSymbol(symbol);

  const cached = await readCachedAnalysis(upper);
  if (cached) {
    return cached;
  }

  const generated = await generateAiStockAnalysis(upper);
  if (!generated) {
    return null;
  }

  await writeCachedAnalysis(upper, generated);
  return generated;
}
