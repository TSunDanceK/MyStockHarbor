// THE CAPEX PAGE'S "WHO IS RECEIVING MOST" CARD (#563 COWORK #124): rules, then mutants.
//
// buildTopReceivers (lib/capexPresent.ts) and the card
// (app/bottlenecks/capex/WhoIsReceivingMost.tsx) are transpiled and run; the
// page (app/bottlenecks/capex/page.tsx) is read as source. Rules: today's five
// rows in order; each exclusion (the cloud group, broad lines, new lines,
// non-USD lines) holds AND its control shows the same line once it qualifies,
// so no rule passes because the line was absent anyway; panel 2's lines and no
// new read; directly under "Who is spending most"; the fine line; sizes from
// rem or the tokens, the fine print tagged; describes, never advises; every
// row of both company cards with its logo or letter (#130). A mutant each.
//
// "Today's data" below is the committed entry list (data/capex/receivers.json)
// with figures standing in for the stored record (which lives in Redis and is
// not readable here): the five expected lines carry the owner's figures, and
// the excluded lines are set large enough that each exclusion decides the top.
//
//   node scripts/check-capex-receiving.mjs
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stripComments } from "./lib/source-code.mjs";

const LIB = "lib/capexPresent.ts", CARD = "app/bottlenecks/capex/WhoIsReceivingMost.tsx", PAGE = "app/bottlenecks/capex/page.tsx";
// THE LOGOS (#563 COWORK #130): both company cards' rows, and the hub leaderboard's own logo they reuse.
const ROW = "app/bottlenecks/capex/CapexLogoRow.tsx", LOGO = "app/components/TickerLogo.tsx", LEADERBOARD = "app/components/BottleneckLeaderboard.tsx";
const read = (f) => fs.readFileSync(f, "utf8");

let n = 0;
const transpile = (src, name) => ts.transpileModule(src.replace(/^import type[^;]+;$/gm, ""), { fileName: `${name}.tsx`, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText
  .replace(/from "next\/link";/, 'from "next/link.js";'); // bare Node needs the extension
/** A module, with the card's row (CapexLogoRow) and the row's TickerLogo transpiled beside it, from `rowSrc` as given. */
async function load(src, name, rowSrc = read(ROW)) {
  const tag = `${process.pid}-${n++}`, tmp = (x) => `scripts/.check-capex-receiving-${tag}-${x}.mjs`;
  fs.writeFileSync(tmp("logo"), transpile(read(LOGO), "logo"));
  fs.writeFileSync(tmp("row"), transpile(rowSrc, "row").replace('from "@/app/components/TickerLogo";', `from "./${tmp("logo").slice(8)}";`));
  fs.writeFileSync(tmp("main"), transpile(src, name).replace('from "./CapexLogoRow";', `from "./${tmp("row").slice(8)}";`).replace('from "@/app/components/TickerLogo";', `from "./${tmp("logo").slice(8)}";`));
  try { return await import(`${process.cwd()}/${tmp("main")}`); } finally { for (const x of ["logo", "row", "main"]) fs.rmSync(tmp(x), { force: true }); }
}
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const ADVICE = /\b(buy|buying|sell(?!s? to\b)|selling|should|must|recommend(?!ation\b)\w*|consider|opportunit\w*|bargain|undervalued|overvalued|cheap|target|upside|downside|will)\b/i;

// ── Today's data ───────────────────────────────────────────────────────────
const ENTRIES = JSON.parse(read("data/capex/receivers.json")).rows;
const F = (current, prior, fyEnd, extra = {}) => ({ fyEnd, currency: "USD", current, prior, changePct: prior && prior > 0 ? ((current - prior) / prior) * 100 : null, subLabelOk: false, staleSince: null, form: "10-K", ...extra });
const TODAY = {
  nvda: F(193.74e9, 115.19e9, "2026-01-25"),
  intc: F(16.92e9, 16.13e9, "2025-12-27", { subLabelOk: true }),
  amd: F(16.64e9, 12.58e9, "2025-12-27"),
  mu: F(13.52e9, 3.79e9, "2025-08-28"),
  wdc: F(11.51e9, 6.65e9, "2025-06-27"),
  mrvl: F(6.0e9, 4.16e9, "2026-01-31"),
  cohr: F(4.1e9, 3.0e9, "2025-06-27"),
  sndk: F(1.2e9, null, "2025-06-27"), // a new line
  "hpe-server": F(17.5e9, null, "2025-10-31"), // a new line, larger than INTC's
  asml: F(10.45e9, 7.86e9, "2025-12-31", { currency: "EUR", form: "20-F" }),
  avgo: F(37.0e9, 30.1e9, "2025-11-02"), // broad
  dell: F(43.6e9, 33.9e9, "2026-01-30"), // broad
  amat: F(20.8e9, 19.91e9, "2025-10-26"), // broad
  msft: F(137.79e9, 106.27e9, "2026-06-30"), // cloud: the spenders
  amzn: F(128.7e9, 107.6e9, "2025-12-31"),
  googl: F(58.7e9, 43.2e9, "2025-12-31"),
  orcl: F(10.2e9, 6.9e9, "2026-05-31"),
};
const EXPECTED = [
  ["NVDA", "Data Center", "FY to Jan 2026", "$194bn"],
  ["INTC", "DCAI — Datacenter and AI", "FY to Dec 2025", "$16.9bn"],
  ["AMD", "Datacenter", "FY to Dec 2025", "$16.6bn"],
  ["MU", "CMBU", "FY to Aug 2025", "$13.5bn"],
  ["WDC", "Cloud", "FY to Jun 2025", "$11.5bn"],
];
const NAMES = { NVDA: "Nvidia", INTC: "Intel", AMD: "AMD", MU: "Micron Technology", WDC: "Western Digital" };
const name = (t) => NAMES[t] ?? "";
const top = (P, figs = TODAY, entries = ENTRIES) => P.buildTopReceivers(entries, figs, name);
const ids = (rows) => rows.map((r) => r.id).join(",");
const BIG = 900e9; // larger than any line, so the exclusion alone decides
const withFig = (id, extra) => ({ ...TODAY, [id]: { ...TODAY[id], current: BIG, ...extra } });
const withEntry = (id, extra) => ENTRIES.map((e) => (e.id === id ? { ...e, ...extra } : e));

const RULES = {
  "today's five rows, in order: NVDA, INTC, AMD, MU, WDC, with line, FY and amount": ({ P }) => {
    const rows = top(P);
    return rows.length === 5 && rows.every((r, i) => r.ticker === EXPECTED[i][0] && r.line === EXPECTED[i][1] && r.fyTo === EXPECTED[i][2] && r.amount === EXPECTED[i][3]) &&
      rows[0].name === "Nvidia" && rows[3].name === "Micron Technology";
  },
  "'Cloud & data centres' is excluded (the spenders); the same line ranks once in a supplier group": ({ P }) =>
    P.SPENDER_GROUP === "cloud-datacentres" && !ids(top(P, withFig("msft"))).includes("msft") &&
    top(P, withFig("msft"), withEntry("msft", { group: "servers-assembly", hyperscaler: false }))[0]?.id === "msft",
  "'Broad line' entries are excluded; the same line ranks once it is not broad": ({ P }) =>
    !ids(top(P, withFig("avgo"))).includes("avgo") && top(P, withFig("avgo"), withEntry("avgo", { broad: false }))[0]?.id === "avgo",
  "'New line' entries are excluded (no prior year); the same line ranks once it has one": ({ P }) =>
    !ids(top(P, withFig("hpe-server"))).includes("hpe-server") && top(P, withFig("hpe-server", { prior: 1e9, changePct: 10 }))[0]?.id === "hpe-server",
  "non-USD lines are excluded (shown as filed, never converted); the same line ranks in USD": ({ P }) =>
    !ids(top(P, withFig("asml"))).includes("asml") && top(P, withFig("asml", { currency: "USD" }))[0]?.id === "asml",
  "ranked by the filed amount, five rows, a company with no figures simply absent": ({ P }) =>
    top(P, { ...TODAY, wdc: undefined }).map((r) => r.ticker).join() === "NVDA,INTC,AMD,MU,MRVL" &&
    P.buildTopReceivers(ENTRIES, { nvda: TODAY.nvda }, name).length === 1 && top(P).every((r) => !/[+−%]/.test(r.amount)),
  "panel 2's lines, no new read: the same entries and record, still three reads": ({ page, card }) =>
    /const topReceivers = buildTopReceivers\(RECEIVER_ENTRIES, receivers\?\.rows \?\? \{\}, companyName\);/.test(page) &&
    /const \[spending, receivers, contracts\] = await Promise\.all\(\[readSpendingRecord\(\), readReceiversRecord\(\), readContractsRecord\(\)\]\);/.test(page) &&
    (page.match(/read\w+Record\(\)/g) ?? []).length === 3 &&
    !/\bfetch\(|redis|@\/lib\/server|import\(/i.test(card),
  "directly under 'Who is spending most', before 'Fastest growing'; once": ({ page }) => {
    const spend = page.indexOf('<div className="cardEyebrow">Who is spending most</div>'), card = page.indexOf("<WhoIsReceivingMost rows={topReceivers} />"), next = page.indexOf('<div className="cardEyebrow">Fastest growing</div>');
    // Only whitespace (or an emptied JSX comment) between the spending card's end, this card and the next card.
    const gapBefore = page.slice(page.lastIndexOf(") : null}", card) + ") : null}".length, card), gapAfter = page.slice(card + "<WhoIsReceivingMost rows={topReceivers} />".length, page.lastIndexOf("{x.fastest ? (", next));
    return spend > 0 && card > spend && next > card && page.lastIndexOf("</section>", card) > spend &&
      page.lastIndexOf("<section", card) < spend && /^(\s|\{\s*\})*$/.test(gapBefore) && /^\s*$/.test(gapAfter) &&
      (page.match(/<WhoIsReceivingMost /g) ?? []).length === 1 && /^import WhoIsReceivingMost from "\.\/WhoIsReceivingMost";$/m.test(page) &&
      !/\.capexReceivingMost\s*\{[^}]*order/.test(page);
  },
  "the card: eyebrow, title, ticker + company + amount, the line and 'FY to' under each": ({ html }) =>
    /<div class="cardEyebrow"[^>]*>Who is receiving most<\/div>/.test(html) && /<h3[^>]*>Largest build-out sales lines<\/h3>/.test(html) &&
    (html.match(/<li /g) ?? []).length === 5 &&
    EXPECTED.every(([t, line, fy, amt]) => new RegExp(`<a href="/stock/${t}">${t}</a><span class="cardName"[^>]*>${NAMES[t]}</span></span><span[^>]*>${line} · ${fy}</span></span><span class="cardAmt"[^>]*>\\${amt}</span>`).test(html)),
  // THE LOGOS (#563 COWORK #130).
  "every row in both company cards shows its logo or the letter tile, the leaderboard's own, at its size": ({ html, row, page, R }) => {
    const rows = (h) => h.split(/<li /).slice(1);
    const hasLogo = (li, t) => new RegExp(`<img [^>]*src="/logos/${t}\\.webp"`).test(li) && /^class="capexLogoRow"/.test(li);
    const spend = renderToStaticMarkup(React.createElement("ul", null, ["MSFT", "AMZN"].map((t) => React.createElement(R.default, { key: t, ticker: t, name: t, amount: "$1bn" }))));
    const letter = renderToStaticMarkup(React.createElement(R.default, { ticker: "", name: "Newco", amount: "$1bn" }));
    const leader = /<TickerLogo symbol=\{c\.ticker\} name=\{c\.name\} size=\{(\d+)\} radius=\{(\d+)\} alt="" \/>/.exec(read(LEADERBOARD));
    return rows(html).length === 5 && rows(html).every((li, i) => hasLogo(li, EXPECTED[i][0])) &&
      rows(spend).length === 2 && rows(spend).every((li, i) => hasLogo(li, ["MSFT", "AMZN"][i])) && />N<\/div>/.test(letter) && !/<img /.test(letter) &&
      !!leader && R.CAPEX_LOGO_PX === Number(leader[1]) && /<TickerLogo symbol=\{ticker\} name=\{name\} size=\{CAPEX_LOGO_PX\} radius=\{8\} alt="" \/>/.test(row) && leader[2] === "8" &&
      /\{x\.topSpenders\.map\(\(t\) => <CapexLogoRow key=\{t\.ticker\} ticker=\{t\.ticker\} name=\{t\.name\} amount=\{t\.amount\} \/>\)\}/.test(page) &&
      !/\bfetch\(|redis|@\/lib\/server/i.test(row);
  },
  "the fine line, verbatim, tagged as fine print at --fs-fine": ({ M, html }) =>
    M.RECEIVING_FINE === "From each company's latest annual report. Fiscal years end in different months. These are what suppliers sold, not a record of who paid them." &&
    /<p data-fine-print="true" style="[^"]*font-size:var\(--fs-fine\)[^"]*">From each company&#x27;s latest annual report\. Fiscal years end in different months\. These are what suppliers sold, not a record of who paid them\.<\/p>/.test(html),
  "sizes in rem or the tokens, nothing in px; no transforms": ({ card, html }) =>
    !/fontSize:\s*\d/.test(card) && !/font-size:\s*\d+(\.\d+)?px/.test(html) && !/transform/i.test(card) &&
    (html.match(/font-size:var\(--fs-read\)/g) ?? []).length === 5 && (html.match(/font-size:var\(--fs-label\)/g) ?? []).length === 10,
  "describes, never advises; nothing estimates who pays whom; empty data, no card": ({ M, html }) =>
    !ADVICE.test(text(html)) && !/pays? (to|whom)|flows? (to|from)|[→⟶⇒➔]/i.test(text(html)) &&
    renderToStaticMarkup(React.createElement(M.default, { rows: [] })) === "",
};

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const measure = async (libSrc, cardSrc, pageSrc, rowSrc = read(ROW)) => {
  const P = await load(libSrc, "lib");
  const M = await load(cardSrc, "card", rowSrc);
  const R = await load(rowSrc, "row", rowSrc);
  return { P, M, R, html: renderToStaticMarkup(React.createElement(M.default, { rows: P.buildTopReceivers(ENTRIES, TODAY, name) })), card: stripComments(cardSrc, { file: CARD }), page: stripComments(pageSrc, { file: PAGE }), row: stripComments(rowSrc, { file: ROW }) };
};
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };

const libSrc = read(LIB), cardSrc = read(CARD), pageSrc = read(PAGE), rowSrc = read(ROW);
console.log("=== Rules ===");
const base = await measure(libSrc, cardSrc, pageSrc);
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));
console.log("  rows: " + base.P.buildTopReceivers(ENTRIES, TODAY, name).map((r) => `${r.ticker} ${r.line} ${r.amount} (${r.fyTo})`).join(" · "));

const R = Object.keys(RULES);
const find = (start) => { const r = R.find((x) => x.startsWith(start)); if (!r) throw new Error(`no rule ${start}`); return r; };
const CARD_JSX = "\n      {/* Who is receiving most (#563 COWORK #124): directly under \"Who is spending most\". */}\n      <WhoIsReceivingMost rows={topReceivers} />\n";
// [rule, "l" (lib), "c" (card), "p" (page) or "r" (the logo row), mutation]
const MUTANTS = [
  ["today's five", "l", (s) => s.replace("picked.sort((a, b) => b.f.current - a.f.current);", "picked.sort((a, b) => (b.f.changePct ?? 0) - (a.f.changePct ?? 0));")],
  ["today's five", "l", (s) => s.replace("const sub = e.subLabel && f.subLabelOk ? e.subLabel.text : null;", "const sub = e.subLabel ? e.subLabel.text : null;")],
  ["'Cloud & data centres'", "l", (s) => s.replace("    if (e.group === SPENDER_GROUP) continue;\n", "")],
  ["'Broad line'", "l", (s) => s.replace("    if (e.broad) continue;\n", "")],
  ["'New line'", "l", (s) => s.replace("    if (f.changePct === null) continue;\n", "")],
  ["non-USD", "l", (s) => s.replace('    if (f.currency !== "USD") continue;\n', "")],
  ["ranked by the filed amount", "l", (s) => s.replace("return picked.slice(0, show).map(", "return picked.slice(0, show + 1).map(")],
  ["panel 2's lines", "p", (s) => s.replace("buildTopReceivers(RECEIVER_ENTRIES, receivers?.rows ?? {}, companyName)", "buildTopReceivers(RECEIVER_ENTRIES, (await readReceiversRecord())?.rows ?? {}, companyName)")],
  ["panel 2's lines", "c", (s) => s.replace("export default function WhoIsReceivingMost(", "export async function peek() { return fetch(\"/x\"); }\nexport default function WhoIsReceivingMost(")],
  ["directly under", "p", (s) => s.replace(CARD_JSX, "\n").replace("    </aside>", "      <WhoIsReceivingMost rows={topReceivers} />\n    </aside>")],
  ["directly under", "p", (s) => s.replace(CARD_JSX, "\n").replace("      {x.topSpenders.length ? (", "      <WhoIsReceivingMost rows={topReceivers} />\n      {x.topSpenders.length ? (")],
  ["directly under", "p", (s) => s.replace(".capexSide { display: grid;", ".capexReceivingMost { order: 9; } .capexSide { display: grid;")],
  ["the card:", "c", (s) => s.replace("Largest build-out sales lines", "Largest sales lines")],
  ["the card:", "c", (s) => s.replace("{r.line} · {r.fyTo}", "{r.line}")],
  ["the fine line", "c", (s) => s.replace(" These are what suppliers sold, not a record of who paid them.", "")],
  ["the fine line", "c", (s) => s.replace("<p data-fine-print style={fineStyle}>", "<p style={fineStyle}>")],
  ["sizes in rem", "c", (s) => s.replace('const rowStyle: CSSProperties = { fontSize: "var(--fs-read)" };', "const rowStyle: CSSProperties = { fontSize: 14 };")],
  ["sizes in rem", "c", (s) => s.replace('const lineStyle: CSSProperties = { display: "block",', 'const lineStyle: CSSProperties = { display: "block", transform: "translateY(1px)",')],
  // The logo dropped from the row: neither card shows one.
  ["every row in both", "r", (s) => s.replace('      <TickerLogo symbol={ticker} name={name} size={CAPEX_LOGO_PX} radius={8} alt="" />\n', "")],
  // The spending card back to its own rows, without the logo.
  ["every row in both", "p", (s) => s.replace("{x.topSpenders.map((t) => <CapexLogoRow key={t.ticker} ticker={t.ticker} name={t.name} amount={t.amount} />)}", "{x.topSpenders.map((t) => <li key={t.ticker}><span>{t.ticker}</span><span className=\"cardAmt\">{t.amount}</span></li>)}")],
  ["describes, never advises", "c", (s) => s.replace("not a record of who paid them.\";", "not a record of who paid them. Suppliers to watch.\";").replace("<h3 style={{ fontSize: \"1.125rem\" }}>Largest build-out sales lines</h3>", "<h3 style={{ fontSize: \"1.125rem\" }}>Largest build-out sales lines</h3><p>Who pays whom: hyperscalers → suppliers. Buy the leaders.</p>")],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [start, where, mutate] of MUTANTS) {
  const label = find(start), src = { l: libSrc, c: cardSrc, p: pageSrc, r: rowSrc }[where], mut = mutate(src);
  if (mut === src) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  let m;
  try { m = await measure(where === "l" ? mut : libSrc, where === "c" ? mut : cardSrc, where === "p" ? mut : pageSrc, where === "r" ? mut : rowSrc); } catch { m = null; }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
