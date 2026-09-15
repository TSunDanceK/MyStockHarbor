// Drives real renders against a deployment, and prints NOTHING of the response
// body.
//
// WHY NOT JUST FETCH THE PAGE. Two reasons, and the second is the real one.
// The agent sandbox is refused *.vercel.app outright. And a stock news page is
// a few hundred KB of HTML: pulling four of them back through the agent to
// trigger a render would cost more than the measurement is worth, when the
// thing actually being measured is written to the Vercel runtime log, not to
// the response. So this asks for the page and throws the body away, reporting
// only status, bytes and wall time.
//
// The measurement itself is then read from the [timing] lines those renders
// emit, which need MSH_TIMING=1 on the environment being hit.
//
// THE TARGET RIDES IN THE EXISTING `symbols` INPUT, deliberately. relay.yml's
// header is explicit that adding a phase should be an edit to relay-run.mjs on
// a branch with NO workflow change and no merge; adding a bespoke input here
// would spend that property for one probe. Format:
//
//   <base-url>|<path>,<path>,...[|<rounds>]
//
//   node scripts/render-probe.mjs "https://example.vercel.app|/stock/TXN/news|2"
const [spec = ""] = process.argv.slice(2);
const [BASE = "", pathList = "", rounds = "1"] = spec.split("|");
const PATHS = pathList.split(",").map((p) => p.trim()).filter(Boolean);
const ROUNDS = Number(rounds) || 1;

if (!BASE || !PATHS.length) {
  console.error('FATAL: expected "<base-url>|<path>,<path>[|rounds]" in the symbols input.');
  process.exit(1);
}

// A BROWSER-SHAPED UA. The site sits behind bot protection and a probe that
// announces itself as a script can be challenged -- which would measure the
// firewall rather than the render, and look like a fast page.
const UA =
  process.env.PROBE_USER_AGENT ??
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Fetch, following redirects by hand so cookies survive them.
 *
 * Node's fetch follows redirects but does NOT carry Set-Cookie across them, and
 * Vercel's SSO bounce is exactly that: 302 to vercel.com/sso-api, which sets a
 * cookie and redirects back. Without the jar the probe lands on the redirect
 * and reports a few milliseconds, which looks like a very fast page.
 */
async function fetchFollowingSso(startUrl, max = 6) {
  const jar = new Map();
  let url = startUrl;
  for (let i = 0; i <= max; i += 1) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": UA, accept: "text/html", ...(cookie ? { cookie } : {}) },
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    return Object.assign(res, { redirects: i });
  }
  throw new Error(`more than ${max} redirects`);
}

for (let round = 1; round <= ROUNDS; round += 1) {
  console.log(`\n===== round ${round}`);
  for (const path of PATHS) {
    const url = `${BASE}${path}`;
    const t0 = Date.now();
    try {
      // FOLLOWS VERCEL'S SSO REDIRECT WITH A COOKIE JAR, because previews are
      // protected (ssoProtection: all_except_custom_domains) and a plain fetch
      // gets the 302 rather than the page -- which would report a 5ms "render"
      // and measure the redirect. The jar is per-process and in memory; the
      // share token rides in the URL the caller passes.
      const res = await fetchFollowingSso(url);
      const body = await res.text();
      console.log(
        `  ${path}  HTTP ${res.status}  ${Date.now() - t0}ms  ${body.length}B  ` +
          `age=${res.headers.get("age") ?? "-"} cache=${res.headers.get("x-vercel-cache") ?? "-"}` +
          `${res.redirects ? `  (${res.redirects} redirect${res.redirects > 1 ? "s" : ""})` : ""}`
      );
      // WHICH OF THE THREE OUTCOMES THE PAGE RENDERED. The whole point of a
      // cold-render measurement is lost if the number is a 404 or a pending
      // card, so the body is inspected for the marker even though it is never
      // printed.
      const marker =
        // THE THREE no-data CARDS, TOLD APART. They were one card until the
        // IFRS work, and lumping them again would let a measurement report
        // "not renderable" for a page that is in fact saying the right thing.
        /reports in [A-Z]{3}/.test(body) ? "currency"
        : /has not filed XBRL financial statements/.test(body) ? "no-xbrl"
        : /does not read .*filings yet/.test(body) ? "not-read-yet"
        : /financials are being fetched/.test(body) ? "PENDING"
        : /latest earnings snapshot/.test(body) ? "rendered"
        : res.status === 404 ? "404"
        : "unrecognised";
      console.log(`      outcome: ${marker}`);
    } catch (err) {
      console.log(`  ${path}  FAILED after ${Date.now() - t0}ms — ${err.message}`);
    }
  }
}
