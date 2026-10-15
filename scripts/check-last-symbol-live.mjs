// THE "LAST STOCK SYMBOL" IS LIVE (#553 COWORK #238).
//
// Bug: the header's "Company Earnings" entry followed a stale symbol. The owner
// switched the homepage analyser to TSLA and the menu still said "Not on SEC for
// SKHY": the header re-read the remembered symbol only when the path changed,
// and the dashboard changes symbol WITHOUT navigating. Every write funnels
// through rememberSymbol (lib/symbol.ts), which now fires an event in this tab;
// the `storage` event covers other tabs; every reader listens.
//   1. BEHAVIOUR of lib/symbol.ts against a stand-in window: a write reaches a
//      subscriber in the same tab, another tab's storage write reaches it, an
//      unrelated key does not, unsubscribe stops it.
//   2. SOURCE: the header, the mobile home and the stock bottom nav all follow
//      the event (no one-second poll left), and the hook lets a /stock/SYM URL
//      win over a change elsewhere. Each asserted again against a broken source.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import "./lib/register-ts-app.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\n1. lib/symbol.ts: a remembered symbol reaches readers");
const bus = new EventTarget();
const store = new Map();
globalThis.window = Object.assign(bus, {
  localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
  location: { protocol: "http:" },
});
globalThis.document = { cookie: "" };
globalThis.CustomEvent ??= class extends Event { constructor(t, i) { super(t); this.detail = i?.detail; } };
globalThis.StorageEvent ??= class extends Event { constructor(t, i) { super(t); this.key = i?.key; this.newValue = i?.newValue; } };
const { rememberSymbol, onRememberedSymbolChange, SYMBOL_STORAGE_KEY } = await import("../lib/symbol.ts");

const seen = [];
const off = onRememberedSymbolChange((s) => seen.push(s));
rememberSymbol("tsla");
check("a write in this tab reaches a subscriber, normalised", seen.join() === "TSLA", seen.join());
window.dispatchEvent(new StorageEvent("storage", { key: SYMBOL_STORAGE_KEY, newValue: "nvda" }));
check("another tab's storage write reaches it", seen.join() === "TSLA,NVDA", seen.join());
window.dispatchEvent(new StorageEvent("storage", { key: "something_else", newValue: "AMZN" }));
check("an unrelated storage key does not", seen.join() === "TSLA,NVDA", seen.join());
rememberSymbol("");
check("an empty symbol writes and notifies nothing", seen.join() === "TSLA,NVDA", seen.join());
off();
rememberSymbol("JPM");
check("after unsubscribing nothing is delivered", seen.join() === "TSLA,NVDA", seen.join());
check("the value is still stored and cookied as before", store.get(SYMBOL_STORAGE_KEY) === "JPM" && /msh_sym=JPM/.test(document.cookie));

console.log("\n2. the readers follow it");
const nav = readCodeOnly("app/components/SiteHeaderNav.tsx");
const home = readCodeOnly("app/components/MobileHomePage.tsx");
const bottom = readCodeOnly("app/components/StockPagesBottomNav.tsx");
const hook = readCodeOnly("app/components/useLastStockSymbol.ts");
const lib = readCodeOnly("lib/symbol.ts");
const once = (src, find, repl) => { if (src.split(find).length - 1 !== 1) throw new Error(`mutation anchor not unique: ${find.slice(0, 50)}`); return src.replace(find, repl); };
const props = [
  ["rememberSymbol fires SYMBOL_CHANGED with the symbol", lib, (s) => /new CustomEvent\(SYMBOL_CHANGED, \{ detail: symbol \}\)/.test(s), (s) => once(s, "new CustomEvent(SYMBOL_CHANGED, { detail: symbol })", "new CustomEvent('other', { detail: symbol })")],
  ["the hook subscribes to changes", hook, (s) => /onRememberedSymbolChange\(\(symbol\) =>/.test(s), (s) => once(s, "onRememberedSymbolChange((symbol) =>", "noop((symbol) =>")],
  ["a /stock/SYM URL wins over a change elsewhere", hook, (s) => /if \(pathSymbolRef\.current\) return;/.test(s), (s) => once(s, "if (pathSymbolRef.current) return;", "")],
  ["the header uses the live hook", nav, (s) => /useLastStockSymbol\(pathname\)/.test(s) && /from "@\/app\/components\/useLastStockSymbol"/.test(s) && !/function useLastStockSymbol/.test(s), (s) => once(s, "useLastStockSymbol(pathname)", "readOnceSymbol(pathname)")],
  ["the mobile home tile uses the live hook (not a one-time localStorage read)", home, (s) => /useLastStockSymbol\(null\)/.test(s) && !/getItem\("msh_last_symbol"\)/.test(s), (s) => once(s, "useLastStockSymbol(null)", "useState(\"AAPL\")[0]")],
  ["the stock bottom nav follows the event, with no polling interval", bottom, (s) => /onRememberedSymbolChange\(/.test(s) && !/setInterval/.test(s), (s) => once(s, "return onRememberedSymbolChange(", "const timer = window.setInterval(() => {}, 1000); return onRememberedSymbolChange(")],
];
for (const [label, src, ok, mutate] of props) {
  check(label, ok(src));
  let broke;
  try { broke = ok(mutate(src)); } catch (e) { check(`MUTATION anchor for: ${label}`, false, e.message); continue; }
  check(`MUTATION: ${label} — broken source is caught`, !broke);
}

console.log(failures ? `\n${failures} FAILED` : "\nThe last symbol is live.");
process.exit(failures ? 1 : 0);
