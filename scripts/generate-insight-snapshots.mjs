import fs from "fs";
import path from "path";
import matter from "gray-matter";

const root = process.cwd();
const postsDirectory = path.join(root, "content/insights");
const snapshotsDirectory = path.join(root, "content/insight-snapshots");
const baseUrl = process.env.SNAPSHOT_BASE_URL || "http://localhost:3000";

function movingAverage(values, window) {
  const out = Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }

  return out;
}

function buildWeeklyCloses(points) {
  if (!points.length) return [];

  const weekly = [];
  let currentWeekKey = "";
  let lastCloseForWeek = null;

  for (const point of points) {
    const d = new Date(point.date);
    if (Number.isNaN(d.getTime())) continue;

    const utcDay = d.getUTCDay();
    const diffToMonday = utcDay === 0 ? -6 : 1 - utcDay;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + diffToMonday);

    const weekKey = `${monday.getUTCFullYear()}-${String(
      monday.getUTCMonth() + 1
    ).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;

    if (weekKey !== currentWeekKey) {
      if (lastCloseForWeek !== null) weekly.push(lastCloseForWeek);
      currentWeekKey = weekKey;
    }

    lastCloseForWeek = point.close;
  }

  if (lastCloseForWeek !== null) weekly.push(lastCloseForWeek);

  return weekly;
}

function lastNum(arr) {
  return arr.length ? arr[arr.length - 1] : null;
}

function pctFromBase(last, base) {
  if (
    typeof last !== "number" ||
    typeof base !== "number" ||
    !Number.isFinite(last) ||
    !Number.isFinite(base) ||
    base === 0
  ) {
    return null;
  }

  return ((last - base) / base) * 100;
}

function trendLabel({ lastClose, ma50, ma200 }) {
  if (
    typeof lastClose === "number" &&
    typeof ma50 === "number" &&
    typeof ma200 === "number"
  ) {
    if (lastClose > ma50 && ma50 > ma200) return "Uptrend";
    if (lastClose < ma50 && ma50 < ma200) return "Downtrend";
  }

  return "Range / Mixed";
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Request failed: ${url} (${res.status})`);
  }
  return res.json();
}

async function buildSnapshotForPost(fileName) {
  const slug = fileName.replace(/\.md$/, "");
  const fullPath = path.join(postsDirectory, fileName);
  const fileContents = fs.readFileSync(fullPath, "utf8");
  const { data } = matter(fileContents);

  const symbol = data.symbol ? String(data.symbol).toUpperCase() : "";
  if (!symbol) {
    console.log(`Skipping ${slug} (no symbol)`);
    return;
  }

  console.log(`Generating snapshot for ${slug} (${symbol})`);

  const [quoteData, historyData, symbolsData] = await Promise.all([
    fetchJson(`${baseUrl}/api/quote?symbol=${encodeURIComponent(symbol)}`),
    fetchJson(`${baseUrl}/api/history?symbol=${encodeURIComponent(symbol)}&days=2200`),
    fetchJson(`${baseUrl}/api/symbols?q=${encodeURIComponent(symbol)}`),
  ]);

  const ptsRaw = Array.isArray(historyData.points) ? historyData.points : [];
  const points = ptsRaw
    .map((p) => ({
      date: String(p?.date ?? ""),
      close: Number(p?.close),
      high: p?.high == null ? undefined : Number(p.high),
      low: p?.low == null ? undefined : Number(p.low),
      volume: p?.volume == null ? undefined : Number(p.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close));

  if (!points.length) {
    throw new Error(`No valid history for ${slug}`);
  }

  const closes = points.map((p) => p.close);
  const weeklyCloses = buildWeeklyCloses(points);

  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);
  const weeklyMA200 = movingAverage(weeklyCloses, 200);

  const lastClose = points[points.length - 1]?.close ?? null;
  const lastMA50 = lastNum(ma50);
  const lastMA200 = lastNum(ma200);
  const lastWeeklyMA200 = lastNum(weeklyMA200);

  const trend = trendLabel({
    lastClose,
    ma50: typeof lastMA50 === "number" ? lastMA50 : null,
    ma200: typeof lastMA200 === "number" ? lastMA200 : null,
  });

  const ma50Pct = pctFromBase(lastClose, lastMA50);
  const ma200Pct = pctFromBase(lastClose, lastMA200);
  const weeklyMA200Pct = pctFromBase(lastClose, lastWeeklyMA200);

  const results = Array.isArray(symbolsData.results) ? symbolsData.results : [];
  const exact = results.find(
    (r) => String(r?.symbol ?? "").toUpperCase() === symbol
  );
  const companyName = exact?.name ? String(exact.name) : "";

  const snapshot = {
    symbol,
    companyName,
    snapshotDate: quoteData?.date ? String(quoteData.date) : "",
    snapshotTime: quoteData?.time ? String(quoteData.time) : "",
    price:
      typeof quoteData?.price === "number" && Number.isFinite(quoteData.price)
        ? quoteData.price
        : null,
    trend,
    lastMA50: typeof lastMA50 === "number" ? Number(lastMA50.toFixed(4)) : null,
    lastMA200: typeof lastMA200 === "number" ? Number(lastMA200.toFixed(4)) : null,
    lastWeeklyMA200:
      typeof lastWeeklyMA200 === "number"
        ? Number(lastWeeklyMA200.toFixed(4))
        : null,
    ma50Pct: typeof ma50Pct === "number" ? Number(ma50Pct.toFixed(4)) : null,
    ma200Pct: typeof ma200Pct === "number" ? Number(ma200Pct.toFixed(4)) : null,
    weeklyMA200Pct:
      typeof weeklyMA200Pct === "number"
        ? Number(weeklyMA200Pct.toFixed(4))
        : null,
    chartPoints: points.slice(-240),
  };

  if (!fs.existsSync(snapshotsDirectory)) {
    fs.mkdirSync(snapshotsDirectory, { recursive: true });
  }

  const outPath = path.join(snapshotsDirectory, `${slug}.json`);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

  console.log(`Saved ${outPath}`);
}

async function main() {
  if (!fs.existsSync(postsDirectory)) {
    throw new Error("content/insights does not exist");
  }

  const fileNames = fs
    .readdirSync(postsDirectory)
    .filter((fileName) => fileName.endsWith(".md"));

  for (const fileName of fileNames) {
    await buildSnapshotForPost(fileName);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
