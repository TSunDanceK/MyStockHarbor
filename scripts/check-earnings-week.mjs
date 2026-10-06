// "EARNINGS THIS WEEK" (#552 COWORK #170, owner pick), RUN on fixtures, with a
// mutant per rule. The page itself is an async server component with Redis
// reads; its rules live in lib/server/earningsWeek.ts (pure) and its two
// components are rendered here through their real imports.
//
//   1. the 7-day window: today and the six days before it, oldest first;
//   2. the default selection: today if it has filings, else the newest day
//      that does; the pills ("0" on today, "—" on a past empty day);
//   3. a row: the figures only for the ANNOUNCED period; "Shares since" from
//      the last close BEFORE the filing (after-close: that day's close);
//      revenue YoY "—" with no comparable quarter;
//   4. the list rendered: tiles are buttons with aria-pressed, one pressed;
//      an empty day says so; logos alt=""; the letter badge sits in the same box;
//   5. coming up: grouped by calendar week, across a month boundary; a
//      non-empty "Due to report" folds in as the first group;
//   6. the month grid is gone, and the old date URLs resolve.
//
//   node scripts/check-earnings-week.mjs
import { register } from "node:module";

// THE SHIPPED .tsx, through the render hooks measure-reading-size uses.
register("./lib/tsx-render-hooks.mjs", import.meta.url);
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  if (src.split(from).length !== 2) throw Object.assign(new Error(`mutation anchor must match once: ${from.slice(0, 70)}`), { anchor: true });
  return src.replace(from, to);
};

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const WEEK_SRC = fs.readFileSync("lib/server/earningsWeek.ts", "utf8");
/** The shipped module, or a mutated copy beside it (so its imports resolve). */
async function loadWeek(mutate) {
  if (!mutate) return import("../lib/server/earningsWeek.ts");
  const tmp = `lib/server/.check-earnings-week-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;
  fs.writeFileSync(tmp, mutate(WEEK_SRC));
  try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}
const visible = (markup) => markup
  .replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, " ").trim();

// ── fixtures ───────────────────────────────────────────────────────────────
const TODAY = "2026-10-05"; // a Monday
const bars = [["2026-09-30", 0, 0, 0, 100], ["2026-10-01", 0, 0, 0, 104], ["2026-10-02", 0, 0, 0, 98]];
// Share classes on one CIK, with pool volumes (MKC trades far more than MKC-V; BRK-B than BRK-A).
const CIKS = { MKC: "63754", "MKC-V": "63754", "BRK-A": "1067983", "BRK-B": "1067983", AAPL: "320193" };
const VOL = { MKC: 1.4e6, "MKC-V": 1.2e3, "BRK-A": 1.1e3, "BRK-B": 3.9e6, AAPL: 5e7 };
const FILERS = {
  cikOf: (s) => CIKS[s] ?? null,
  siblingsOf: (s) => (s === "MKC-V" ? ["MKC"] : []),
  volumeOf: (s) => VOL[s] ?? null,
};

const RULES = {
  "1. the strip is today and the six days before it, oldest first": (W) => {
    const d = W.weekDays(TODAY);
    return d.length === 7 && d[0] === "2026-09-29" && d[6] === TODAY && d.every((x, i) => i === 0 || x > d[i - 1]);
  },
  "2a. today with filings is the default": (W) => W.defaultDay(W.weekDays(TODAY), new Map([[TODAY, 3], ["2026-10-01", 9]]), TODAY) === TODAY,
  "2b. today empty: the NEWEST day with filings, not the oldest": (W) =>
    W.defaultDay(W.weekDays(TODAY), new Map([["2026-09-30", 4], ["2026-10-02", 2]]), TODAY) === "2026-10-02",
  "2c. no filings all week: today": (W) => W.defaultDay(W.weekDays(TODAY), new Map(), TODAY) === TODAY,
  "2d. the pill: the count; '0' on today before the first filing; '—' on a past empty day": (W) =>
    W.countPill(4, false) === "4" && W.countPill(0, true) === "0" && W.countPill(0, false) === "—",
  "3a. filed after the close: the close before it is THAT day's": (W) =>
    W.closeBeforeFiling(bars, "2026-10-01", "after-close")?.date === "2026-10-01",
  "3b. filed before the open: the PREVIOUS trading day's close": (W) =>
    W.closeBeforeFiling(bars, "2026-10-01", "before-open")?.date === "2026-09-30" && W.closeBeforeFiling(bars, "2026-10-01", null)?.date === "2026-09-30",
  "3c. shares since: from that close to the latest, signed; never from a later close": (W) => {
    const up = W.sharesSince({ date: "2026-09-30", close: 100 }, { date: "2026-10-02", close: 98 });
    return Math.abs(up - -2) < 1e-9 && W.sharesSince({ date: "2026-10-02", close: 100 }, { date: "2026-10-01", close: 98 }) === null;
  },
  "3d. figures only for the announced period (the 10-Q may not be in yet)": (W) =>
    W.figuresForAnnouncement("2026-09-27", { end: "2026-06-28", revenue: 1, revenueYoY: 1, epsDiluted: 1 }) === null &&
    W.figuresForAnnouncement("2026-09-27", { end: "2026-09-27", revenue: 11.7e9, revenueYoY: 4.1, epsDiluted: 1.42 })?.revenue === 11.7e9 &&
    W.figuresForAnnouncement(null, { end: "2026-09-27", revenue: 1, revenueYoY: 1, epsDiluted: 1 }) === null,
  // COMING UP AS FOUR WEEK WINDOWS (#552 COWORK #179): the rest of this week,
  // then the next three Mon–Sun weeks; date windows, never a day.
  "5a. four columns: the rest of this week, then three Mon–Sun weeks": (W) => {
    const c = W.comingUpColumns([], "2026-10-07", { thisWeekHasDue: true }); // a Wednesday
    return c.map((x) => `${x.label} ${x.range}`).join(" | ") ===
      "This week 7–11 Oct | Next week 12–18 Oct | Week of 19 Oct 19–25 Oct | Week of 26 Oct 26 Oct–1 Nov";
  },
  "5b. ...across a month boundary, and on a Sunday the first window is one day": (W) =>
    W.comingUpColumns([], "2026-10-21", { thisWeekHasDue: true }).map((x) => x.range).join(" | ") === "21–25 Oct | 26 Oct–1 Nov | 2–8 Nov | 9–15 Nov" &&
    W.comingUpColumns([], "2026-10-11", { thisWeekHasDue: true })[0].range === "11 Oct",
  "5c. each row in its window, by market cap (unknown last); past the fourth window, not placed": (W) => {
    const r = (symbol, estimatedOn, cap) => ({ symbol, estimatedOn, cap });
    const c = W.comingUpColumns([r("A", "2026-10-09", 5), r("B", "2026-10-08", 50), r("C", "2026-10-10", null), r("D", "2026-10-14", 1), r("E", "2026-11-02", 9)], "2026-10-07");
    return c[0].items.map((x) => x.symbol).join() === "B,A,C" && c[1].items.map((x) => x.symbol).join() === "D" &&
      c.flatMap((x) => x.items).length === 4;
  },
  // AN EMPTY THIS WEEK IS NOT A COLUMN (COWORK #180): the next four weeks instead.
  "5d. an empty 'This week' with no due names gives way to the next four weeks": (W) => {
    const r = (symbol, estimatedOn) => ({ symbol, estimatedOn, cap: 1 });
    const skipped = W.comingUpColumns([r("X", "2026-11-03")], "2026-10-07");
    const kept = W.comingUpColumns([r("X", "2026-11-03")], "2026-10-07", { thisWeekHasDue: true });
    const busy = W.comingUpColumns([r("Y", "2026-10-09")], "2026-10-07");
    return skipped.map((c) => c.range).join(" | ") === "12–18 Oct | 19–25 Oct | 26 Oct–1 Nov | 2–8 Nov" &&
      !skipped[0].isThisWeek && skipped[3].items.map((x) => x.symbol).join() === "X" &&
      kept[0].isThisWeek && kept.length === 4 && busy[0].isThisWeek && busy[0].items.length === 1;
  },
  // ONE ROW PER COMPANY (COWORK #180): GOOGL and GOOG are one Alphabet row.
  "5e. one row per company: the larger-cap class leads, the other rides as 'also'": (W) => {
    const cik = { GOOGL: "1652044", GOOG: "1652044", "BRK-A": "1067983", "BRK-B": "1067983" };
    const out = W.onePerCompany([{ symbol: "GOOG", cap: 2.0e12 }, { symbol: "GOOGL", cap: 2.1e12 }, { symbol: "MSFT", cap: 3e12 }, { symbol: "BRK-B", cap: null }, { symbol: "BRK-A", cap: null }], (s) => cik[s] ?? null);
    const by = Object.fromEntries(out.map((x) => [x.symbol, x.also.join()]));
    return out.length === 3 && by.GOOGL === "GOOG" && by.MSFT === "" && by["BRK-A"] === "BRK-B";
  },
  "7a. one row per filer, under its most-traded class (MKC, not MKC-V)": (W) => {
    const out = W.primaryPerFiler([{ symbol: "MKC-V" }, { symbol: "MKC" }, { symbol: "AAPL" }], FILERS);
    return out.length === 2 && out.map((x) => x.symbol).join() === "MKC,AAPL";
  },
  "7b. a lone secondary class shows as its base ticker on the same CIK": (W) =>
    W.primaryPerFiler([{ symbol: "MKC-V" }], FILERS).map((x) => `${x.row.symbol}>${x.symbol}`).join() === "MKC-V>MKC",
  "7c. two listed classes: the more traded wins (BRK-B over BRK-A), whatever the order": (W) =>
    W.primaryPerFiler([{ symbol: "BRK-A" }, { symbol: "BRK-B" }], FILERS)[0]?.symbol === "BRK-B" &&
    W.primaryPerFiler([{ symbol: "BRK-B" }, { symbol: "BRK-A" }], FILERS)[0]?.symbol === "BRK-B",
};

const W0 = await loadWeek();
console.log("1–3, 5. the rules (lib/server/earningsWeek.ts)");
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(W0)); } catch (e) { console.log(`    ${e.message}`); }
  check(name, ok);
}

console.log("\n4. the list, rendered (EarningsWeek)");
const Week = (await import("../app/earnings-calendar/EarningsWeek.tsx")).default;
const day = (date, rows, extra = {}) => ({
  date, weekday: W0.tileWeekday(date), dateLabel: W0.tileDate(date), count: rows.length,
  pill: W0.countPill(rows.length, date === TODAY), isToday: date === TODAY,
  eyebrow: W0.dayEyebrow(date, rows.length), emptyLine: rows.length ? null : `No results filed on ${W0.dayLong(date)}.`, rows, ...extra,
});
const ROWS = [
  { symbol: "AAPL", company: "Apple Inc.", revenue: "$94.04B", revenueYoY: 9.6, eps: "$1.57", since: 2.3 },
  { symbol: "NEWCO", company: "Newco Holdings", revenue: "$11.7M", revenueYoY: null, eps: "−$0.12", since: null },
];
const days = W0.weekDays(TODAY).map((d) => day(d, d === "2026-10-01" ? ROWS : []));
const html = renderToStaticMarkup(React.createElement(Week, { days, initial: "2026-10-01" }));
const pressed = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*data-week-day="([^"]+)"/g)];
check("seven tiles, each a button with aria-pressed, the selected one pressed",
  pressed.length === 7 && pressed.filter((p) => p[1] === "true").map((p) => p[2]).join() === "2026-10-01");
check("today's tile is marked (dashed outline class)", /class="ewTile ewToday"[^>]*data-week-day="2026-10-05"/.test(html));
check("today, empty, shows '0'; a past empty day '—'", /data-week-day="2026-10-05"[\s\S]*?data-count="0">0</.test(html) && /data-week-day="2026-10-04"[\s\S]*?data-count="0">—</.test(html));
check("the eyebrow names the day and the count", visible(html).includes("Thursday 1 October · 2 companies"));
check("revenue with YoY, signed and inked", /\$94\.04B<span class="ewYoY" data-yoy="" style="color:#4ade80">\+9\.6%</.test(html));
check("no comparable quarter: the YoY reads '—'", /\$11\.7M<span class="ewYoY" data-yoy="">—</.test(html));
check("no close: 'Shares since' reads '—'", /data-row="NEWCO"[\s\S]*?data-since="">—</.test(html));
check("each ticker links to its earnings page", html.includes('href="/stock/AAPL/earnings"'));
check("logos carry alt=\"\" (the ticker names the company)", /<img[^>]*alt=""/.test(html) && !/alt="AAPL logo"/.test(html));
check("no Backfill control unless the page turns it on (it is off on production)",
  !/Backfill/.test(visible(html)) && /Backfill this date/.test(visible(renderToStaticMarkup(React.createElement(Week, { days, initial: "2026-10-01", backfill: true })))));
{
  const PAGE_SRC = readCodeOnly("app/earnings-calendar/page.tsx");
  const offProd = (src) => /backfill=\{!isProductionDeployment\(\)\}/.test(src);
  check("the page turns it on only off production", offProd(PAGE_SRC));
  check("MUTATION: Backfill on everywhere → caught", !offProd(PAGE_SRC.replace("backfill={!isProductionDeployment()}", "backfill={true}")));
}
check("EPS and Shares since hide below 640 px", /@media \(max-width: 640px\) \{[\s\S]*?\.ewWide \{ display: none; \}/.test(html));
const CREDIT = React.createElement("a", { href: "https://www.tiingo.com", target: "_blank", rel: "noopener noreferrer" }, "Market data from Tiingo.com");
const credited = renderToStaticMarkup(React.createElement(Week, { days, initial: "2026-10-01", credit: CREDIT }));
const creditRule = (h, e) => /<p class="ewFine" data-fine-print="">[\s\S]*?Shares since[\s\S]*?<a href="https:\/\/www\.tiingo\.com"[^>]*>Market data from Tiingo\.com<\/a><\/p>/.test(h) && !/<p class="ewFine"/.test(e);
const empty = renderToStaticMarkup(React.createElement(Week, { days, initial: "2026-10-04" }));
check("the Tiingo credit is in this card's fine print, under a day with rows only",
  creditRule(credited, renderToStaticMarkup(React.createElement(Week, { days, initial: "2026-10-04", credit: CREDIT }))));
check("an empty day says so, once, and shows no table", (visible(empty).match(/No results filed on Sunday 4 October\./g) ?? []).length === 1 && !/class="ewTable"/.test(empty));
{
  // THE LETTER BADGE SITS IN THE SAME BOX: TickerLogo's fallback branch, at the list's size.
  const Logo = (await import("../app/components/TickerLogo.tsx")).default;
  const badge = renderToStaticMarkup(React.createElement(Logo, { symbol: "", name: "Newco", size: 22, radius: 6, alt: "" }));
  const img = renderToStaticMarkup(React.createElement(Logo, { symbol: "AAPL", size: 22, radius: 6, alt: "" }));
  const box = (h) => (h.match(/width:22px;height:22px;border-radius:6px/) ?? []).length;
  const sameBox = (b, i) => />N</.test(b) && box(b) === 1 && box(i) === 1;
  check("a company with no logo gets a letter badge in the same 22 px box", sameBox(badge, img));
  // MUTANT: the badge drawn without the shared box (a different size, rows misaligned).
  const LOGO = fs.readFileSync("app/components/TickerLogo.tsx", "utf8");
  const tmp = `app/components/.check-logo-${process.pid}.tsx`;
  fs.writeFileSync(tmp, once(LOGO, "        style={{\n          ...box,\n          background: \"rgba(95,212,199,0.12)\",", "        style={{\n          background: \"rgba(95,212,199,0.12)\","));
  let MLogo; try { MLogo = (await import(`../${tmp}`)).default; } finally { fs.rmSync(tmp, { force: true }); }
  const mb = renderToStaticMarkup(React.createElement(MLogo, { symbol: "", name: "Newco", size: 22, radius: 6, alt: "" }));
  check("MUTATION: the letter badge outside the shared box → caught", !sameBox(mb, img));

  // THE ERROR HEARD AFTER HYDRATION (#552 COWORK #174): TMQ (no file) and JOBY
  // (the stock page header) showed a blank white tile, because the request
  // failed before React attached onError. TickerLogo reads the finished image
  // after mount and falls back.
  const L = await import("../app/components/TickerLogo.tsx");
  const failedRule = (f) => f({ complete: true, naturalWidth: 0 }) === true && f({ complete: false, naturalWidth: 0 }) === false && f({ complete: true, naturalWidth: 72 }) === false && f(null) === false;
  check("a finished image with no pixels is a failure; a loading or loaded one is not", failedRule(L.imageFailed));
  const LOGO_CODE = readCodeOnly("app/components/TickerLogo.tsx");
  const wired = (src) => /useEffect\(\(\) => \{[\s\S]*?imageFailed\(imgRef\.current\)\) setFallback\(\{ sym, idx: idx \+ 1 \}\)[\s\S]*?\}, \[sym, idx\]\);/.test(src) && /ref=\{imgRef\}/.test(src);
  check("...read after mount, on the rendered <img>, advancing to the next source or the letter badge", wired(LOGO_CODE));
  check("MUTATION: the after-mount read removed → caught", !wired(LOGO_CODE.replace("ref={imgRef}", "")));
  check("MUTATION: a loading image treated as failed → caught", !failedRule((img) => Boolean(img && img.naturalWidth === 0)));
}

console.log("\n5. coming up (EarningsComingUp)");
const ComingUp = (await import("../app/earnings-calendar/EarningsComingUp.tsx")).default;
const exp = (symbol, daysAway) => ({ symbol, band: "d8_21", daysAway, periodEnd: "2026-09-30", medianLagDays: 15, fromPeriods: 12, precision: 0.9, isFpi: false, lastReportedOn: "2026-07-15", lastReportedPeriodEnd: "2026-06-30" });
const capOf = { UNH: 500e9, JPM: 700e9, NFLX: 400e9, MU: 100e9 };
const facts = (syms) => Object.fromEntries(syms.map((sy) => [sy, { company: `${sy} Inc.`, cap: capOf[sy] ?? null }]));
const many = Array.from({ length: 11 }, (_, i) => `T${String(i).padStart(2, "0")}`);
const cuProps = {
  today: TODAY,
  expected: { kind: "listed", considered: 50, rows: [exp("UNH", 10), exp("JPM", 2), exp("NFLX", 26), ...many.map((sy) => exp(sy, 9))] },
  due: { kind: "listed", coverage: 1, entries: [{ symbol: "MU", periodEnd: "2026-08-27", dueFrom: "2026-09-15", expectedOn: "2026-09-19", daysOutstanding: 39 }] },
  facts: facts(["UNH", "JPM", "NFLX", "MU", ...many]),
};
cuProps.expected.rows.push(exp("GOOGL", 10), exp("GOOG", 10));
Object.assign(cuProps.facts, {
  GOOGL: { company: "Alphabet Inc.", cap: 2.1e12, cik: "1652044" },
  GOOG: { company: "Alphabet Inc.", cap: 2.0e12, cik: "1652044" },
});
const cu = renderToStaticMarkup(React.createElement(ComingUp, cuProps));
/** One column's markup, from its opening tag to the next column's. */
const colOf = (key) => (cu.match(new RegExp(`<div class="cuCol[^"]*" data-col="${key}"[\\s\\S]*?(?=<div class="cuCol[ "]|<style)`)) ?? [""])[0];
const heads = [...cu.matchAll(/class="cuColLabel">([^<]+)<\/h3><div class="cuColMeta"><span class="cuRange">([^<]+)<\/span> · <span data-count="(\d+)"/g)].map((g) => `${g[1]} ${g[2]} (${g[3]})`);
check("four columns, each with its label, window and company count",
  heads.join(" | ") === "This week 5–11 Oct (2) | Next week 12–18 Oct (13) | Week of 19 Oct 19–25 Oct (0) | Week of 26 Oct 26 Oct–1 Nov (1)", heads.join(" | "));
check("the header: the title, ONE amber ESTIMATED tag, and a closed 'How we estimate' tap with the one sentence",
  /<h2 id="cuHeading" class="cuHeading">Coming up<\/h2><span class="cuTag" data-estimated-tag="">Estimated<\/span><details class="cuHow"><summary><span aria-hidden="true">ⓘ<\/span> How we estimate<\/summary><p>[^<]*usual SEC reporting pattern[^<]*may differ\.<\/p><p data-coverage="">[^<]*<\/p><\/details>/.test(cu) &&
  (cu.match(/data-estimated-tag/g) ?? []).length === 1);
check("NO day on a row: no '~date' and no date inside any row",
  !/~\d/.test(cu) && !/cuWhen/.test(cu) && ![...cu.matchAll(/<li class="cuRow"[\s\S]*?<\/li>/g)].some((m) => /\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(m[0].replace(/<[^>]*>/g, " "))));
check("'This week' is marked, and carries the due name first under its heading, then the estimates",
  /^<div class="cuCol cuThisWeek" data-col="w0"/.test(colOf("w0")) &&
  /<p class="cuSub" data-group="due">Period ended, not filed yet<\/p><ul class="cuList"><li class="cuRow" data-row="MU" data-due="">[\s\S]*?<ul class="cuList cuAfterDue"><li class="cuRow" data-row="JPM"/.test(colOf("w0")) &&
  !/cuThisWeek/.test(colOf("w1")));
const w1rows = [...colOf("w1").matchAll(/data-row="([^"]+)"/g)].map((g) => g[1]);
check("rows sort by market cap, largest first (unknown last, then A–Z)", w1rows.slice(0, 3).join() === "GOOGL,UNH,T00", w1rows.join());
check("8 shown, the rest behind '+ N more' within the column (native details)",
  /<ul class="cuList">(?:<li class="cuRow"[\s\S]*?<\/li>){8}<\/ul><details class="cuMore"><summary><span class="cuMoreOpen">\+ 5 more<\/span>/.test(colOf("w1")) && w1rows.length === 13);
check("GOOGL and GOOG are ONE row, the larger cap leading, 'also GOOG' on its name line, counted once",
  !/data-row="GOOG"/.test(cu) && /data-row="GOOGL"[\s\S]*?<span class="cuName">Alphabet Inc\.<\/span><span class="cuAlso" data-also="">also GOOG<\/span>/.test(cu));
check("the coverage sentence is back inside the tap, with the live counts",
  /<details class="cuHow">[\s\S]*?<p data-coverage="">Showing 15 of the 50 largest companies we track\.[^<]*<\/p><\/details>/.test(cu));
{
  // AN EMPTY THIS WEEK (COWORK #180): one line above the grid, then four weeks.
  const lone = renderToStaticMarkup(React.createElement(ComingUp, { today: TODAY, due: { kind: "none-outstanding", coverage: 1 },
    expected: { kind: "listed", considered: 50, rows: [exp("AMD", 29)] }, facts: facts(["AMD"]) }));
  const ranges = [...lone.matchAll(/class="cuRange">([^<]+)</g)].map((g) => g[1]).join(" | ");
  check("an empty 'This week' becomes one line, and the next four weeks show (the fourth holding AMD)",
    /<p class="cuThisWeekEmpty" data-this-week-empty="">Nothing estimated for the rest of this week\.<\/p><div class="cuGrid">/.test(lone) &&
    ranges === "12–18 Oct | 19–25 Oct | 26 Oct–1 Nov | 2–8 Nov" && !/cuThisWeek"|cuThisWeek /.test(lone.replace(/<style[\s\S]*<\/style>/, "")) && /data-row="AMD"/.test(lone), ranges);
  check("...and with names this week, no such line", !/data-this-week-empty/.test(cu));
}
check("each row: logo, ticker, name, linked to its earnings page",
  /<li class="cuRow" data-row="UNH"><a href="\/stock\/UNH\/earnings" class="cuRowLink">[\s\S]*?<span class="cuSym">UNH<\/span><span class="cuName">UNH Inc\.<\/span><\/a><\/li>/.test(cu));
check("an empty week says so", /<p class="cuEmpty">None estimated\.<\/p>/.test(colOf("w2")));
check("4 / 2 / 1 columns at desktop / ≤900px / ≤560px",
  /\.cuGrid \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/.test(cu) &&
  /@media \(max-width: 900px\) \{ \.cuGrid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(cu) &&
  /@media \(max-width: 560px\) \{ \.cuGrid \{ grid-template-columns: minmax\(0, 1fr\)/.test(cu));

// THE COMPONENT'S MUTANTS. Each is written NEXT TO the shipped file (so its
// "@/…" and "./…" imports resolve as the real one's do), rendered with the
// same props, and deleted. Each must break one of these properties.
{
  const CU = "app/earnings-calendar/EarningsComingUp.tsx";
  const CU_SRC = fs.readFileSync(CU, "utf8");
  const props = (m) => {
    const col = (key) => (m.match(new RegExp(`<div class="cuCol[^"]*" data-col="${key}"[\\s\\S]*?(?=<div class="cuCol[ "]|<style)`)) ?? [""])[0];
    return {
      "8 rows, then '+ 5 more'": /<ul class="cuList">(?:<li class="cuRow"[\s\S]*?<\/li>){8}<\/ul><details class="cuMore"><summary><span class="cuMoreOpen">\+ 5 more</.test(col("w1")),
      "due first in This week": /^<div class="cuCol cuThisWeek" data-col="w0"[\s\S]*?<p class="cuSub" data-group="due">[\s\S]*?data-row="MU"[\s\S]*?data-row="JPM"/.test(col("w0")),
      "one ESTIMATED tag": (m.match(/data-estimated-tag=""/g) ?? []).length === 1,
      "one Alphabet row": !/data-row="GOOG"/.test(m) && /data-row="GOOGL"/.test(m),
      "the coverage sentence in the tap": /<p data-coverage="">Showing \d+ of the 50/.test(m),
      "four columns": (m.match(/<div class="cuCol[ "]/g) ?? []).length === 4,
      "no day on a row": ![...m.matchAll(/<li class="cuRow"[\s\S]*?<\/li>/g)].some((x) => /\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|~\d/.test(x[0].replace(/<[^>]*>/g, " "))),
    };
  };
  const shipped = props(cu);
  check("the component's mutant properties all hold on the shipped render", Object.values(shipped).every(Boolean), JSON.stringify(shipped));
  let n = 0;
  const bitesCu = async (mutate) => {
    const src = mutate(CU_SRC);
    const file = `app/earnings-calendar/EarningsComingUp.mutant${++n}.tsx`;
    fs.writeFileSync(file, src);
    try {
      const M = (await import(`../${file}`)).default;
      return !Object.values(props(renderToStaticMarkup(React.createElement(M, cuProps)))).every(Boolean);
    } catch { return true; } finally { fs.rmSync(file, { force: true }); }
  };
  const CU_MUTANTS = [
    ["nine rows before '+ N more'", (s) => once(s, "export const VISIBLE_PER_COLUMN = 8;", "export const VISIBLE_PER_COLUMN = 9;")],
    ["the due heading over the estimates, the due names after them", (s) => once(s, "const d = items.filter((r) => r.due), e = items.filter((r) => !r.due);", "const d = items.filter((r) => !r.due), e = items.filter((r) => r.due);")],
    ["the due names left out of This week", (s) => once(s, "const colDue = c.isThisWeek ? dueRows : [];", "const colDue: Row[] = [];")],
    ["the ESTIMATED tag dropped", (s) => once(s, '<span className="cuTag" data-estimated-tag="">{ESTIMATED_TAG}</span>', "")],
    ["the two Alphabet classes as two rows again", (s) => once(s, "const cikOf = (s: string) => facts[s]?.cik ?? null;", "const cikOf = (_s: string): string | null => null;")],
    ["the coverage sentence dropped", (s) => once(s, '<p data-coverage="">', '<p data-coverage="" hidden>')],
    ["the estimated day back on each row", (s) => once(s, '<span className="cuName">{r.company}</span>', '<span className="cuName">{r.company}</span><span>~15 Oct</span>')],
  ];
  for (const [label, m] of CU_MUTANTS) {
    let caught = false;
    try { caught = await bitesCu(m); } catch (e) { console.log(`    ${e.message}`); }
    check(`MUTATION (component): ${label} → caught`, caught);
  }
}

console.log("\n6. the page");
const PAGE = readCodeOnly("app/earnings-calendar/page.tsx");
const gridGone = (src) => !/buildCalendarWeeks|WEEKDAY_LABELS|← Prev|Next →|\?year=\$\{/.test(src) && /<EarningsWeek\s/.test(src);
check("the month grid and Prev / Today / Next are gone", gridGone(PAGE));
// ONE SORT FOR BOTH SECTIONS (#552 COWORK #181): cap, largest first; no cap after, A–Z.
const stripSort = (src) => /\.map\(\(c\) => \(\{ \.\.\.c, cap: capOf\(c\.symbol\) \}\)\)\s*\.sort\(byCapThenSymbol\)/.test(src);
check("'Last 7 days' rows sort by the same cap-then-A–Z rule as Coming up", stripSort(PAGE));
check("MUTATION: the strip back to a cap-only sort → caught",
  !stripSort(PAGE.replace(".sort(byCapThenSymbol)", ".sort((a, b) => (b.cap ?? -1) - (a.cap ?? -1))")));
check("the title and description keep \"Earnings calendar\"",
  /const PAGE_TITLE = "Earnings Calendar[^"]*"/.test(PAGE) && /"Earnings calendar: /.test(PAGE));
const T = await lift(grabFunction(fs.readFileSync("app/earnings-calendar/page.tsx", "utf8"), "oldUrlTarget"), "", "oldUrlTarget");
const OLD = {
  "an old ?date= inside the strip opens that day": (t) => JSON.stringify(t.oldUrlTarget({ date: "2026-10-01", year: "2026", month: "10" }, W0.weekDays(TODAY))) === '{"selected":"2026-10-01","redirect":false}',
  "any other old ?date= / ?year=&month= redirects to the page": (t) =>
    t.oldUrlTarget({ date: "2026-08-03" }, W0.weekDays(TODAY)).redirect && t.oldUrlTarget({ year: "2026", month: "9" }, W0.weekDays(TODAY)).redirect,
  "the bare URL neither selects nor redirects": (t) => JSON.stringify(t.oldUrlTarget({}, W0.weekDays(TODAY))) === '{"selected":null,"redirect":false}',
};
for (const [name, rule] of Object.entries(OLD)) { let ok = false; try { ok = Boolean(rule(T)); } catch { ok = false; } check(name, ok); }
check("...and the redirect is permanent (301), to the bare page",
  /if \(old\.redirect\) permanentRedirect\("\/earnings-calendar"\);/.test(PAGE));

console.log("\nmutants: each must break a rule");
const bites = async (mutate) => {
  let W; try { W = await loadWeek(mutate); } catch (e) { if (e?.anchor) throw e; return true; }
  return !Object.values(RULES).every((r) => { try { return r(W); } catch { return false; } });
};
const MUTANTS = [
  ["an eight-day strip", (s) => once(s, "export const STRIP_DAYS = 7;", "export const STRIP_DAYS = 8;")],
  ["the strip shifted a day into the future", (s) => once(s, "addDays(today, i - (STRIP_DAYS - 1))", "addDays(today, i - (STRIP_DAYS - 2))")],
  ["the default is the OLDEST day with filings", (s) => once(s, "for (let i = days.length - 1; i >= 0; i--) if", "for (let i = 0; i < days.length; i++) if")],
  ["'0' on a past empty day", (s) => once(s, 'return isToday ? "0" : "—";', 'return "0";')],
  ["shares since from the filing day's close whatever the timing", (s) => once(s, 'const sameDayCounts = timing === "after-close";', "const sameDayCounts = true;")],
  ["any stored quarter shown against the announcement", (s) => once(s, "|| latest.end !== announcedPeriodEnd", "")],
  ["an empty This week kept as a column", (s) => once(s, "const skip = all[0].items.length === 0 && !opts.thisWeekHasDue;", "const skip = false;")],
  ["an empty This week skipped even with due names", (s) => once(s, "const skip = all[0].items.length === 0 && !opts.thisWeekHasDue;", "const skip = all[0].items.length === 0;")],
  ["one row per TICKER in Coming up (GOOGL and GOOG both)", (s) => once(s, "const key = cikOf(r.symbol) ?? `sym:${r.symbol}`;", "const key = `sym:${r.symbol}`;")],
  ["the smaller-cap class leads", (s) => once(s, "    const [lead, ...rest] = [...g].sort((a, b) =>\n      (b.cap ?? -1) - (a.cap ?? -1)", "    const [lead, ...rest] = [...g].sort((a, b) =>\n      (a.cap ?? -1) - (b.cap ?? -1)")],
  ["weeks start on Sunday", (s) => once(s, "const mondayOf = (d: string) => addDays(d, -((dow(d) + 6) % 7));", "const mondayOf = (d: string) => addDays(d, -dow(d));")],
  ["one row per TICKER again (MKC and MKC-V both listed)", (s) => once(s, "const key = opts.cikOf(r.symbol) ?? `sym:${r.symbol}`;", "const key = `sym:${r.symbol}`;")],
  ["the class picked by suffix alone, not by trading", (s) => once(s, "      (opts.volumeOf(b) ?? -1) - (opts.volumeOf(a) ?? -1)\n      || ", "      ")],
  ["a fifth week column", (s) => once(s, "export const COMING_UP_COLUMNS = 4;", "export const COMING_UP_COLUMNS = 5;")],
  ["column one starts on Monday, not today", (s) => once(s, "const start = w === 0 ? today : weekStart;", "const start = weekStart;")],
  ["Coming up sorted smallest cap first", (s) => once(s, "(b.cap ?? -1) - (a.cap ?? -1) || (a.symbol", "(a.cap ?? -1) - (b.cap ?? -1) || (a.symbol")],
];
for (const [label, m] of MUTANTS) {
  let caught = false;
  try { caught = await bites(m); } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, caught);
}
{
  const WK = fs.readFileSync("app/earnings-calendar/EarningsWeek.tsx", "utf8");
  const tmp = `app/earnings-calendar/.check-week-${process.pid}.tsx`;
  fs.writeFileSync(tmp, once(WK, "{credit && day.rows.length ? (", "{credit ? ("));
  let MW; try { MW = (await import(`../${tmp}`)).default; } finally { fs.rmSync(tmp, { force: true }); }
  check("MUTATION: the credit printed under an empty day as well → caught",
    !creditRule(renderToStaticMarkup(React.createElement(MW, { days, initial: "2026-10-01", credit: CREDIT })), renderToStaticMarkup(React.createElement(MW, { days, initial: "2026-10-04", credit: CREDIT }))));
}
check("MUTATION: the month grid back → caught", !gridGone(PAGE.replace(/<EarningsWeek\s/, "<div>{buildCalendarWeeks(2026, 10)}</div><EarningsWeek ")));
{
  const PAGE_RAW = fs.readFileSync("app/earnings-calendar/page.tsx", "utf8");
  const Tm = await lift(grabFunction(once(PAGE_RAW, "if (date && days.includes(date)) return", "if (date) return"), "oldUrlTarget"), "", "oldUrlTarget-mut");
  check("MUTATION: any old ?date= accepted (a day outside the strip) → caught", !Object.values(OLD).every((r) => { try { return r(Tm); } catch { return false; } }));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
