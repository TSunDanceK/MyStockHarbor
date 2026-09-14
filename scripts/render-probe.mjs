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

for (let round = 1; round <= ROUNDS; round += 1) {
  console.log(`\n===== round ${round}`);
  for (const path of PATHS) {
    const url = `${BASE}${path}`;
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
      const body = await res.text();
      console.log(
        `  ${path}  HTTP ${res.status}  ${Date.now() - t0}ms  ${body.length}B  ` +
          `age=${res.headers.get("age") ?? "-"} cache=${res.headers.get("x-vercel-cache") ?? "-"}`
      );
    } catch (err) {
      console.log(`  ${path}  FAILED after ${Date.now() - t0}ms — ${err.message}`);
    }
  }
}
