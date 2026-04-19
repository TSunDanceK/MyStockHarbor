import OpenAI from "openai";

export type MarketAnalysis = {
  summary: string;
  bullish: string[];
  bearish: string[];
  watch: string[];
  generatedAt: string;
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function getSpxMarketAnalysis(): Promise<MarketAnalysis | null> {
  try {
    const prompt = `
Provide a concise S&P 500 market summary.

Return JSON only:
{
  "summary": "...",
  "bullish": ["...", "..."],
  "bearish": ["...", "..."],
  "watch": ["...", "..."]
}
Keep it simple, factual, and non-hyped.
`;

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    });

    const text = res.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(text);

    return {
      ...parsed,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
