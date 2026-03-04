import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type PickerItem = {
  symbol: string;
  note?: string;
  tone?: "green" | "yellow" | "orange" | "red";
};

type PickerSection = {
  title: string;
  description?: string;
  items: PickerItem[];
};

export async function GET() {
  // ✅ Always return a stable shape: { sections: PickerSection[] }
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
      description: "Pullbacks in uptrends (rules to be defined).",
      items: [{ symbol: "AMZN", note: "Example", tone: "yellow" }],
    },
    {
      title: "Breakouts",
      description: "Strength + new highs / range breaks (rules to be defined).",
      items: [{ symbol: "META", note: "Example", tone: "orange" }],
    },
  ];

  return NextResponse.json({ sections });
}
