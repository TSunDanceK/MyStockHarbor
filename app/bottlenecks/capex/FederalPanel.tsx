import type { StoredFederal } from "@/lib/server/capexFederal";

// "FEDERAL CONTRACTS" (#563 D5): the listed companies that received the most
// US federal contract money over the last 12 complete months, in real dollars
// as USAspending.gov publishes them. One company per bar, largest first; the
// bars share one dollar scale because every figure is the same kind of number.
// A company's own subsidiaries are rolled into it (Electric Boat into General
// Dynamics); different companies are never added together.

const SHOWN = 20;
const BAR = "#60a5fa";
const MUTED = "rgba(241,245,249,0.62)";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function usd(v: number): string {
  return v >= 1e9 ? `US$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}bn` : `US$${Math.round(v / 1e6)}m`;
}

/** SEC's registrant names carry a state-of-incorporation tag ("NORTHROP GRUMMAN CORP /DE/"); drop it. */
function displayName(name: string): string {
  return name.replace(/\s*\/[A-Z]{2}\/?\s*$/, "").trim();
}

function share(part: number, whole: number): string {
  if (!(whole > 0)) return "–";
  const p = (part / whole) * 100;
  // Say "about a third", not "33.0%": the matched share depends on how many
  // recipients the alias list covers, so a decimal would overstate precision.
  if (p >= 30 && p < 37) return "about a third";
  if (p >= 45 && p < 55) return "about half";
  return `about ${Math.round(p / 5) * 5}%`;
}

export default function FederalPanel({ data, isBaseline }: { data: StoredFederal | null; isBaseline: boolean }) {
  if (!data || !data.companies.length) {
    return (
      <section className="capexCard" aria-labelledby="capex-federal">
        <h2 id="capex-federal" className="capexH2">
          Federal contracts
        </h2>
        <p className="capexLead">Federal contract figures are not available right now.</p>
      </section>
    );
  }
  const top = data.companies.slice(0, SHOWN);
  const max = top[0].amount;
  return (
    <section className="capexCard" aria-labelledby="capex-federal">
      <h2 id="capex-federal" className="capexH2">
        Federal contracts
      </h2>
      <p className="capexLead">
        The US government committed {usd(data.totalObligations)} to contracts in the 12 months to{" "}
        {monthYear(data.window.end)}. {share(data.matchedObligations, data.totalObligations)[0].toUpperCase()}
        {share(data.matchedObligations, data.totalObligations).slice(1)} of it went to companies we can match to a
        US-listed stock; the rest went to private firms, universities, national laboratories and joint ventures.
        These are the {top.length} largest listed recipients.
      </p>
      <ul className="capexList">
        {top.map((c) => (
          <li
            key={c.ticker}
            className="fedRow"
            title={`${c.ticker} (${displayName(c.name)}): ${usd(c.amount)} across ${c.recipients} contracting ${c.recipients === 1 ? "entity" : "entities"}`}
          >
            <div className="fedName">
              <span style={{ fontWeight: 800 }}>{c.ticker}</span> <span className="capexSub">{displayName(c.name)}</span>
            </div>
            <div className="capexBarCell">
              <div className="capexTrack" aria-hidden="true">
                <div
                  style={{
                    width: `${Math.max((c.amount / max) * 100, 1.5)}%`,
                    background: BAR,
                    height: "100%",
                    borderRadius: "0 4px 4px 0",
                  }}
                />
              </div>
              <span className="capexPct">{usd(c.amount)}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="capexSources">
        Contract obligations (money the government committed in the period, not necessarily paid), award types A–D,{" "}
        {data.window.start} to {data.window.end}. Source: USAspending.gov. Recipient names come from SAM.gov
        registrations; subsidiaries are matched to their listed parent using a reviewed list, and joint ventures are
        not attributed to any one company.
        {isBaseline ? ` Snapshot taken ${data.updatedAt.slice(0, 10)}; refreshed weekly.` : ` Updated ${data.updatedAt.slice(0, 10)}; refreshed weekly.`}
      </p>
      <style>{`
        .fedRow { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.2fr); gap:4px 16px; padding:8px 0; border-top:1px solid rgba(255,255,255,0.06); align-items:center; }
        .fedName { font-size:14px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .fedName .capexSub { color:${MUTED}; }
        @media (max-width: 640px) { .fedRow { grid-template-columns:1fr; } }
      `}</style>
    </section>
  );
}
