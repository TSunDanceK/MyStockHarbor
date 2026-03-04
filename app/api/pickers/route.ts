import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Tone = "green" | "yellow" | "orange" | "red";

type PickerSection = {
  title: string;
  description?: string;
  items: { symbol: string; note?: string; tone?: Tone }[];
};

export async function GET() {
  // TEMP: hard-coded examples
  // Next step: generate these lists from your composite logic + market/top traded.
  const sections: PickerSection[] = [
    {
      title: "Green Composite (Oversold-leaning)",
      description: "Stocks flashing multiple oversold / dip-style signals.",
      items: [
        { symbol: "AAPL", note: "Example", tone: "green" },
        { symbol: "MSFT", note: "Example", tone: "green" },
      ],
    },
    {
      title: "Red Composite (Overbought-leaning)",
      description: "Stocks looking stretched / extended / euphoric.",
      items: [
        { symbol: "NVDA", note: "Example", tone: "red" },
        { symbol: "TSLA", note: "Example", tone: "red" },
      ],
    },
    {
      title: "Buy The Dip",
      description: "Pullbacks in uptrends (you’ll define the rules).",
      items: [{ symbol: "AMZN", note: "Example", tone: "yellow" }],
    },
    {
      title: "Breakouts",
      description: "Strength + new highs / range breaks (you’ll define the rules).",
      items: [{ symbol: "META", note: "Example", tone: "orange" }],
    },
  ];

  return NextResponse.json({ sections });
}
