"use client";
// "YOUR READ" (#563 COWORK #132/#133, PR 2; the mock-up's vote card): three
// buttons, then the split once this browser has voted. The page renders it
// with no tally at all, so a page view costs no read; the split is fetched only
// after a vote, or when the cookie says this browser voted in this window.
// The rules (windows, cookie, shares) are lib/insightVote.ts.
import { useEffect, useState } from "react";
import { VOTE_CHOICES, parseVoteCookie, tallyShares, voteCookieName, type VoteChoice, type VoteTally } from "@/lib/insightVote";

export const VOTE_FAILED = "Votes are unavailable just now. Please try again later.";
const BAR: Record<VoteChoice, string> = { higher: "#22c55e", sideways: "#64748b", lower: "#ef4444" };

function readCookie(name: string): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

export default function InsightVote({ slug, window: windowId }: { slug: string; window: string }) {
  const [mine, setMine] = useState<VoteChoice | null>(null);
  const [tally, setTally] = useState<VoteTally | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // A browser that already voted in this window sees the split, not the buttons.
  useEffect(() => {
    const prior = parseVoteCookie(readCookie(voteCookieName(slug)));
    if (!prior || prior.window !== windowId) return;
    setMine(prior.choice);
    let live = true;
    fetch(`/api/insights/vote?slug=${encodeURIComponent(slug)}&window=${encodeURIComponent(windowId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { tally?: VoteTally }) => { if (live && j.tally) setTally(j.tally); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [slug, windowId]);

  async function vote(choice: VoteChoice) {
    if (busy || mine) return;
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch("/api/insights/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, choice }) });
      const j = (await r.json().catch(() => ({}))) as { tally?: VoteTally; choice?: VoteChoice };
      if ((r.ok || r.status === 409) && j.tally) {
        setMine(j.choice ?? choice);
        setTally(j.tally);
      } else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const shares = tally ? tallyShares(tally) : null;
  return (
    <div className="inVote" data-insight-vote="" data-voted={mine ? mine : undefined}>
      {!mine ? (
        <div className="inVoteRow" role="group" aria-label="Your read">
          {VOTE_CHOICES.map((c) => (
            <button key={c.key} type="button" className="inVoteBtn" data-choice={c.key} disabled={busy} onClick={() => vote(c.key)}>
              <span aria-hidden="true">{c.mark}</span> {c.label}
            </button>
          ))}
        </div>
      ) : null}
      {mine && shares ? (
        <div className="inVoteResult" aria-live="polite">
          <div className="inVoteBar" aria-hidden="true">
            {VOTE_CHOICES.map((c) => <i key={c.key} style={{ width: `${shares.pct[c.key]}%`, background: BAR[c.key] }} />)}
          </div>
          <p className="inRead">
            {VOTE_CHOICES.map((c, i) => <span key={c.key}>{i ? " · " : ""}{c.label} {shares.pct[c.key]}%</span>)}
          </p>
          <p className="inFine" data-fine-print="">
            Your read: {VOTE_CHOICES.find((c) => c.key === mine)?.label}. {shares.total === 1 ? "1 reader has" : `${shares.total} readers have`} voted in this window.
          </p>
        </div>
      ) : null}
      {failed ? <p className="inRead" role="status">{VOTE_FAILED}</p> : null}
    </div>
  );
}
