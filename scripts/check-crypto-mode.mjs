// Crypto mode hidden behind one flag (#553 COWORK #62; lib/cryptoMode.ts).
//
// WHAT IS AT RISK: crypto is hidden on the page but still fetched (a toggle
// gone while /api/quote keeps calling FMP for BTCUSD), or the flag gates some
// paths and not others, or a crypto URL shows an error or a stale price.
//
// The flag's two states are exercised on the real module (a fresh import per
// state); each gated site is held by a predicate and a mutant with its gate
// removed must fail it.
//
//   node scripts/check-crypto-mode.mjs
import "./lib/register-ts-here.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const url = pathToFileURL(path.join(ROOT, "lib/cryptoMode.ts")).href;
delete process.env.NEXT_PUBLIC_CRYPTO_MODE_ENABLED;
const OFF = await import(`${url}?state=off`);
process.env.NEXT_PUBLIC_CRYPTO_MODE_ENABLED = "1";
const ON = await import(`${url}?state=on`);
process.env.NEXT_PUBLIC_CRYPTO_MODE_ENABLED = "true";
const TYPO = await import(`${url}?state=typo`);
delete process.env.NEXT_PUBLIC_CRYPTO_MODE_ENABLED;

check("off by default", OFF.CRYPTO_MODE_ENABLED === false);
check("only \"1\" turns it on (\"true\" stays off)", ON.CRYPTO_MODE_ENABLED === true && TYPO.CRYPTO_MODE_ENABLED === false);
check("a crypto pair is recognised: BTCUSD, ETHUSD, SOLUSD, TRXUSD", ["BTCUSD", "ethusd", "SOLUSD", "TRXUSD"].every(OFF.isCryptoPairSymbol));
check("...and no stock is: AAPL, BRK-B, USD, USDC, TSLA", !["AAPL", "BRK-B", "USD", "USDC", "TSLA"].some(OFF.isCryptoPairSymbol));
check("off: a crypto pair is hidden, a stock is not", OFF.cryptoHidden("BTCUSD") && !OFF.cryptoHidden("AAPL"));
check("mutant caught: flag on, crypto comes back", !ON.cryptoHidden("BTCUSD"));

const SITES = [
  {
    label: "the dashboard renders the Stocks/Crypto toggle only with the flag on (both places)",
    file: "app/components/DashboardClient.tsx",
    ok: (c) => (c.match(/\{CRYPTO_MODE_ENABLED \? (<div style=\{\{ marginTop: 14 \}\}>)?<AssetTypeToggle( compact)? \/>/g) ?? []).length === 2 && (c.match(/<AssetTypeToggle/g) ?? []).length === 2,
    mutate: (c) => c.replace("{CRYPTO_MODE_ENABLED ? <AssetTypeToggle compact /> : null}", "<AssetTypeToggle compact />"),
  },
  {
    label: "search returns no crypto rows with the flag off",
    file: "lib/server/symbolSearch.ts",
    ok: (c) => /if \(type === "crypto"\) return CRYPTO_MODE_ENABLED \? searchCryptoPairs\(q\) : \[\];/.test(c),
    mutate: (c) => c.replace('return CRYPTO_MODE_ENABLED ? searchCryptoPairs(q) : [];', "return searchCryptoPairs(q);"),
  },
  {
    label: "crypto benchmarks return empty before any cache read or FMP call",
    file: "lib/server/benchmarksBuilder.ts",
    ok: (c) => {
      const i = c.indexOf('if (scope === "crypto" && !CRYPTO_MODE_ENABLED)');
      // Before the in-memory cache read, which comes before every Redis read
      // and FMP fetch in getBenchmarksDataInner.
      return i > 0 && i < c.indexOf("const cached = cache.get(scope);");
    },
    mutate: (c) => c.replace('if (scope === "crypto" && !CRYPTO_MODE_ENABLED)', "if (false)"),
  },
  ...["app/api/quote/route.ts", "app/api/history/route.ts"].map((file) => ({
    label: `${file} answers "not available" for a crypto pair before any FMP call`,
    file,
    ok: (c) => {
      const i = c.indexOf("if (cryptoHidden(symbol))");
      const firstFetch = Math.min(...["fetchQuoteSnapshot(", "getDailyHistory(", "isUnwantedBot("].map((n) => c.indexOf(n, c.indexOf("export async function GET"))).filter((n) => n > 0));
      return i > 0 && i < firstFetch;
    },
    mutate: (c) => c.replace("if (cryptoHidden(symbol))", "if (false)"),
  })),
  {
    label: "/stock/<PAIR> renders a plain \"not available\" page, and is noindex, before any fetch",
    file: "app/stock/[symbol]/page.tsx",
    ok: (c) => (c.match(/if \(cryptoHidden\(upper\)\)/g) ?? []).length === 2 && /is not available<\/h1>/.test(c) && /index: false/.test(c),
    mutate: (c) => c.replace(/if \(cryptoHidden\(upper\)\)/g, "if (false)"),
  },
];
for (const site of SITES) {
  const code = readCodeOnly(site.file);
  check(site.label, site.ok(code), site.file);
  const mutant = site.mutate(code);
  check("...mutant caught: that gate removed, crypto comes back", mutant !== code && !site.ok(mutant));
}
check("hide, don't delete: CRYPTO_PRESETS and the static pairs are still in the code",
  /const CRYPTO_PRESETS/.test(readCodeOnly("app/components/DashboardClient.tsx")) && /const CRYPTO_USD_PAIRS/.test(readCodeOnly("lib/server/symbolSearch.ts")));

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
