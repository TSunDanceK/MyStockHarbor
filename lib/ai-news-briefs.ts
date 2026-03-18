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
    "You write short stock-news briefing copy for MyStockHarbor, a beginner-friendly stock analysis site. " +
    "Use only the provided headline, source, publication date, feed description, stock symbol, company name, trend context, and news-score label. " +
    "Return one output item for each input article in the exact same order. " +
    "Do not include or rewrite the headline. " +
    "Make each summary clearly specific to that article, not a reusable template. " +
    "If the article appears too vague or low-information, say so cautiously and explain what traders may be watching instead. " +
    "Do not invent facts. Do not imply full article access or independent verification. " +
    "Keep attribution light and natural, such as 'Reuters reports that' or 'Barron's highlights'. " +
    "Do not copy likely article wording. Paraphrase clearly. " +
    "Each summary must feel useful, specific, editorial, and cautious. " +
    "Each summary should be 2 to 3 sentences, around 45 to 80 words total. " +
    "The first sentence should explain what the coverage is about. " +
    "The second sentence should explain how traders or investors may interpret it. " +
    "A third sentence is allowed only when it adds genuinely useful context. " +
    "Each whyItMatters line should be 1 sentence in plain English and should differ across articles when the headlines differ. " +
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
  ["msh-ai-news-briefs-v1"],
  {
    revalidate: 60 * 60 * 12,
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
