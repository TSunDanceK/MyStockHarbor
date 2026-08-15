import Link from "next/link";
import type { BottleneckPost } from "@/lib/bottlenecks";

// A plain, fully server-rendered A-Z index of every bottleneck page.
//
// Why this exists alongside BottleneckList
// ----------------------------------------
// BottleneckList is the interactive list: search, Latest/A-Z toggle, and a
// `See more` button that mounts 30 rows at a time (PAGE_SIZE). That cap is a
// sensible client-side decision -- it keeps the DOM small as the set grows --
// but it has an SEO consequence that only showed up in the 2026-08-15 Search
// Console audit: of 103 bottleneck pages, **30 appear as links in the
// rendered HTML and 73 sit behind a <button>**. Googlebot does not click
// buttons. Those 73 pages had no crawlable internal link anywhere on the
// site and were sitting in "Discovered - currently not indexed" with no
// crawl ever recorded.
//
// The ItemList JSON-LD on app/bottlenecks/page.tsx does enumerate all 103
// URLs, which is worth having, but structured data is a description of the
// page -- it is not a link, and it neither passes ranking signal nor creates
// a crawl path.
//
// Rather than complicate the interactive list (server-side pagination would
// fight its client-side search and sort, and raising PAGE_SIZE just moves
// the cliff), this adds a separate, deliberately plain archive block. Every
// page, one link each, always in the HTML. It reads as what it is -- an
// index at the bottom of a listing page -- and it is genuinely useful to a
// reader who knows the company they want.
//
// See claude/seo-recovery-plan-2026-08-15.md (Phase 2.1).

function groupByInitial(posts: BottleneckPost[]) {
  const groups = new Map<string, BottleneckPost[]>();

  for (const post of posts) {
    const first = (post.companyName || post.symbol).charAt(0).toUpperCase();
    const key = /[A-Z]/.test(first) ? first : "#";
    const bucket = groups.get(key);
    if (bucket) bucket.push(post);
    else groups.set(key, [post]);
  }

  return Array.from(groups.entries())
    .map(([letter, items]) => ({
      letter,
      items: items.sort((a, b) =>
        (a.companyName || a.symbol).localeCompare(b.companyName || b.symbol)
      ),
    }))
    .sort((a, b) => {
      if (a.letter === "#") return 1;
      if (b.letter === "#") return -1;
      return a.letter.localeCompare(b.letter);
    });
}

export default function BottleneckArchive({
  posts,
}: {
  posts: BottleneckPost[];
}) {
  if (posts.length === 0) return null;

  const groups = groupByInitial(posts);

  return (
    <section
      aria-labelledby="bottleneck-archive-heading"
      style={{
        marginTop: 32,
        background: "#0b1220",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        padding: 24,
      }}
    >
      <h2
        id="bottleneck-archive-heading"
        style={{
          margin: "0 0 6px",
          fontSize: 20,
          fontWeight: 800,
        }}
      >
        All bottleneck pages A&ndash;Z
      </h2>

      <p
        style={{
          margin: "0 0 18px",
          fontSize: 14,
          lineHeight: 1.6,
          opacity: 0.72,
        }}
      >
        Every one of the {posts.length} companies mapped so far, listed
        alphabetically.
      </p>

      {groups.map((group) => (
        <div key={group.letter} style={{ marginBottom: 18 }}>
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "#93c5fd",
              opacity: 0.85,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              paddingBottom: 5,
            }}
          >
            {group.letter}
          </h3>

          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
              gap: "6px 18px",
            }}
          >
            {group.items.map((post) => (
              <li key={post.slug} style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                <Link
                  href={`/bottlenecks/${post.slug}`}
                  style={{
                    color: "rgba(241,245,249,0.86)",
                    textDecoration: "none",
                  }}
                >
                  {post.companyName || post.symbol}
                  {post.companyName ? (
                    <span style={{ opacity: 0.5 }}> ({post.symbol})</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
