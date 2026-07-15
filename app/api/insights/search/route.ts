import { NextRequest, NextResponse } from "next/server";
import { searchPosts } from "@/lib/blog";

const MAX_RESULTS = 30;
const MIN_QUERY_LENGTH = 2;

// Backs the search box on /insights. Reads frontmatter for every post
// server-side (cheap - no markdown bodies involved) but only ever returns
// a capped result set, so the response size - and what the browser has to
// render - stays flat no matter how large content/insights/ grows.
export async function GET(request: NextRequest) {
  const rawQuery = request.nextUrl.searchParams.get("q") ?? "";
  const query = rawQuery.trim().slice(0, 100);

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ query, count: 0, results: [] });
  }

  const results = searchPosts(query, MAX_RESULTS);

  return NextResponse.json({
    query,
    count: results.length,
    results,
  });
}
