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
// page, one link each, always in the HTML.
//
// See claude/seo-recovery-plan-2026-08-15.md (Phase 2.1).
//
// WHY IT IS COLLAPSED INTO A <details>
// ------------------------------------
// Expanded, this was ~103 links and roughly ten screens of scroll appended to
// a listing page, which is a lot of clutter for a block whose primary reader
// is a crawler. <details> resolves that without giving up a single link: the
// element renders its children into the markup whether it is open or closed,
// so the served HTML is byte-for-byte the same set of <a> tags either way.
// Crawlers read and follow them; a human sees one row unless they choose to
// open it.
//
// This is the same bet app/components/CrawlableNav.tsx already makes for the
// footer's "Browse all sections", and it is deliberately NOT the other option
// -- a visually-hidden block -- because ~100 links hidden from users and
// served to crawlers is the shape of a hidden-links pattern regardless of
// intent, and that is not a bet worth taking on a finance site.
//
// The <h2> stays inside the <summary> (the spec permits heading content
// there) so the document outline is unchanged and the archive keeps its
// crawlable heading.
//
// prefetch={false} is load-bearing, not cautious. Next's <Link> prefetches on
// viewport entry, so opening this would otherwise fire ~103 prefetches in one
// go. This site has already blocked its own visitors once through exactly
// that mechanism -- see claude/list-link-prefetch-disable-2026-07-21.md.

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
      <details>
        <summary
          style={{
            cursor: "pointer",
            // revert, not none: the disclosure triangle is the only thing
            // telling a reader this row opens.
            listStyle: "revert",
          }}
        >
          <h2
            id="bottleneck-archive-heading"
            style={{
              // inline so the heading sits on the summary's own line rather
              // than dropping below the marker.
              display: "inline",
              margin: 0,
              fontSize: 20,
              fontWeight: 800,
            }}
          >
            All bottleneck pages A&ndash;Z
          </h2>
          <span
            style={{
              marginLeft: 8,
              fontSize: 13.5,
              fontWeight: 600,
              opacity: 0.6,
            }}
          >
            ({posts.length} companies)
          </span>
        </summary>

        <p
          style={{
            margin: "14px 0 18px",
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
                    prefetch={false}
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
      </details>
    </section>
  );
}
