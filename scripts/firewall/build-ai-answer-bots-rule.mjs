// THE AI ANSWER BOTS BYPASS RULE (owner request, 13 Oct 2026; #553 COWORK #229).
//
// Builds ONE Vercel firewall custom rule, "Allow AI answer bots (verified IPs)",
// action bypass, active, that lets the four answer/search bots through ONLY when
// both their user agent AND their source IP match the operator's own published
// ranges. Training crawlers are not listed and stay denied by the AI Bots rules.
//
//   ChatGPT-User    https://openai.com/chatgpt-user.json
//   OAI-SearchBot   https://openai.com/searchbot.json
//   PerplexityBot   https://www.perplexity.ai/perplexitybot.json
//   Perplexity-User https://www.perplexity.ai/perplexity-user.json
//
// One condition group per bot: user_agent sub <UA> AND ip_address inc <prefixes>.
// The firewall caps a condition's value list at 75 entries, so a longer list is
// split into several groups with the same UA (groups are ORed; each still needs
// both the UA and an IP from that bot's own list).
//
// Throws if a list fails to load or is empty. Range counts go to stderr; the rule
// JSON goes to stdout:
//
//   node scripts/firewall/build-ai-answer-bots-rule.mjs > /tmp/ai-bots-rule.json
//   vercel firewall rules add --json "$(cat /tmp/ai-bots-rule.json)" --scope tsundanceks-projects --yes
//
// The ranges change over time: rebuild and replace the rule, don't hand-edit it.

const BOTS = [
  ["ChatGPT-User", "https://openai.com/chatgpt-user.json"],
  ["OAI-SearchBot", "https://openai.com/searchbot.json"],
  ["PerplexityBot", "https://www.perplexity.ai/perplexitybot.json"],
  ["Perplexity-User", "https://www.perplexity.ai/perplexity-user.json"],
];
const MAX_VALUES = 75; // the firewall's per-condition list limit

async function prefixes(ua, url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${ua}: ${url} returned HTTP ${res.status}`);
  const body = await res.json();
  const list = (body?.prefixes ?? []).map((p) => p?.ipv4Prefix || p?.ipv6Prefix).filter((p) => typeof p === "string" && p.length);
  if (!list.length) throw new Error(`${ua}: ${url} has no ipv4Prefix/ipv6Prefix entries`);
  return [...new Set(list)];
}

const conditionGroup = [];
for (const [ua, url] of BOTS) {
  const ips = await prefixes(ua, url);
  console.error(`${ua}: ${ips.length} ranges`);
  for (let i = 0; i < ips.length; i += MAX_VALUES) {
    conditionGroup.push({
      conditions: [
        { type: "user_agent", op: "sub", value: ua },
        { type: "ip_address", op: "inc", value: ips.slice(i, i + MAX_VALUES) },
      ],
    });
  }
}

const rule = {
  name: "Allow AI answer bots (verified IPs)",
  description: "Bypass for ChatGPT-User, OAI-SearchBot, PerplexityBot, Perplexity-User ONLY from their published IP ranges (UA AND IP). Training bots stay denied. Rebuild with scripts/firewall/build-ai-answer-bots-rule.mjs. Owner request 13 Oct 2026.",
  active: true,
  conditionGroup,
  action: { mitigate: { action: "bypass" } },
};
console.error(`${conditionGroup.length} condition groups`);
process.stdout.write(`${JSON.stringify(rule)}\n`);
