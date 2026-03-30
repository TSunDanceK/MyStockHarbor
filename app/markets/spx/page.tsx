import SPXChartClient from "./SPXChartClient";
import { getDailyHistory } from "@/lib/server/historyCache";

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

function mapToChartPoints(data: Point[]) {
  return data.map((p) => ({
    time: p.date,
    value: p.close,
  }));
}

export default async function SPXPage() {
  const symbol = "^GSPC";

  let chartPoints: { time: string; value: number }[] = [];

  try {
    const history = await getDailyHistory(symbol);

    if (Array.isArray(history) && history.length > 0) {
      chartPoints = mapToChartPoints(history);
    }
  } catch (error) {
    console.error("SPX history fetch failed:", error);
  }

  return (
    <div style={{ padding: "20px" }}>
      <h1 style={{ marginBottom: "20px" }}>S&amp;P 500 (SPX)</h1>

      <SPXChartClient chartPoints={chartPoints} />

      {chartPoints.length === 0 && (
        <div style={{ marginTop: "20px", opacity: 0.6 }}>
          No chart data available.
        </div>
      )}
    </div>
  );
}
