// THE READER VOTE'S ROUTE (#563 COWORK #132/#133, PR 2).
//
//   POST {slug, choice}   counts one vote in the post's CURRENT window, worked out
//                         here from the symbol's SEC report dates (the client never
//                         names the window it writes to), sets the "{window}:{choice}"
//                         cookie and returns the tally. A second vote in the same
//                         window is refused with the tally as it stands (409).
//                         Commands: 1 GET (report dates) + 3 (HINCRBY, EXPIRE, HGETALL).
//   GET ?slug=&window=    the tally of one window, for a browser that already voted.
//                         Commands: 1 HGETALL.
//
// BotID-guarded both ways (instrumentation-client.ts lists the path). Previews
// vote into their own keys (lib/server/insightVoteStore.ts).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isUnwantedBot } from "@/lib/botid-guard";
import { readInsightSource } from "@/lib/server/insightPage";
import { readReportDatesChecked } from "@/lib/server/secReportDatesStore";
import { announcedDates } from "@/lib/server/insightVoteStore";
import { castVote, readLiveTally } from "@/lib/server/insightVoteWrite";
import {
  VOTE_COOKIE_MAX_AGE, VOTE_SLUG_RE, isVoteChoice, isVoteWindow, parseVoteCookie, voteCookieName, voteWindows,
} from "@/lib/insightVote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deny = () => NextResponse.json({ error: "Access denied" }, { status: 403 });
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/** The post's symbol, or null when the slug isn't a post this deployment serves. */
function symbolOf(slug: string): string | null {
  if (!VOTE_SLUG_RE.test(slug)) return null;
  try {
    return readInsightSource(slug).n.symbol || null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (await isUnwantedBot()) return deny();
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "", windowId = url.searchParams.get("window") ?? "";
  if (!symbolOf(slug) || !isVoteWindow(windowId)) return bad("unknown post or window");
  const tally = await readLiveTally(slug, windowId);
  if (!tally) return NextResponse.json({ error: "Votes are unavailable just now." }, { status: 503 });
  return NextResponse.json({ window: windowId, tally }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (await isUnwantedBot()) return deny();
  let body: { slug?: unknown; choice?: unknown };
  try { body = await request.json(); } catch { return bad("bad body"); }
  const slug = typeof body.slug === "string" ? body.slug : "";
  const sym = symbolOf(slug);
  if (!sym || !isVoteChoice(body.choice)) return bad("unknown post or choice");
  const choice = body.choice;

  // THE WINDOW IS THE SERVER'S: the newest results announcement on or before today.
  const dates = await readReportDatesChecked(sym);
  if (!dates.ok) return NextResponse.json({ error: "Votes are unavailable just now." }, { status: 503 });
  const windowId = voteWindows(announcedDates(dates.rec), new Date().toISOString().slice(0, 10)).current.id;

  const jar = await cookies();
  const prior = parseVoteCookie(jar.get(voteCookieName(slug))?.value);
  if (prior?.window === windowId) {
    const tally = await readLiveTally(slug, windowId);
    return NextResponse.json({ window: windowId, tally, choice: prior.choice, already: true }, { status: 409 });
  }

  const tally = await castVote(slug, windowId, choice);
  if (!tally) return NextResponse.json({ error: "Votes are unavailable just now." }, { status: 503 });
  const res = NextResponse.json({ window: windowId, tally, choice }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(voteCookieName(slug), `${windowId}:${choice}`, {
    maxAge: VOTE_COOKIE_MAX_AGE, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production",
  });
  return res;
}
