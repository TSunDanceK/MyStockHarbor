/**
 * GuideJsonLd — drop-in JSON-LD for SEO guide / educational pages.
 *
 * Emits a @graph with:
 *   - WebPage   (for Google's understanding of the page itself)
 *   - Article   (marks it as educational content, eligible for rich results)
 *   - BreadcrumbList (sitelinks breadcrumb in SERPs)
 *
 * Usage:
 *   import GuideJsonLd from "@/app/components/GuideJsonLd";
 *   // inside the page's default export JSX:
 *   <GuideJsonLd
 *     path="/what-is-rsi-indicator"
 *     title="What Is RSI Indicator?"
 *     description="Learn what the RSI indicator is and how traders use it."
 *     breadcrumbs={[{ name: "Learn", href: "/learn" }]}
 *   />
 */

const BASE = "https://www.mystockharbor.com";
const ORG_ID = `${BASE}/#organization`;
const SITE_ID = `${BASE}/#website`;

type Crumb = {
  name: string;
  href: string;
};

type Props = {
  /** e.g. "/what-is-rsi-indicator" */
  path: string;
  /** Plain text page title (without " | MyStockHarbor") */
  title: string;
  description: string;
  /**
   * Optional intermediate breadcrumbs between Home and this page.
   * Home is always position 1; this page is always the last item.
   * Example: [{ name: "Learn", href: "/learn" }]
   */
  breadcrumbs?: Crumb[];
};

export default function GuideJsonLd({ path, title, description, breadcrumbs = [] }: Props) {
  const url = `${BASE}${path}`;
  const pageId = `${url}#webpage`;

  const crumbItems = [
    { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
    ...breadcrumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 2,
      name: c.name,
      item: `${BASE}${c.href}`,
    })),
    {
      "@type": "ListItem",
      position: breadcrumbs.length + 2,
      name: title,
      item: url,
    },
  ];

  const graph = [
    {
      "@type": "WebPage",
      "@id": pageId,
      url,
      name: `${title} | MyStockHarbor`,
      description,
      isPartOf: { "@id": SITE_ID },
      publisher: { "@id": ORG_ID },
    },
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: title,
      description,
      url,
      mainEntityOfPage: { "@id": pageId },
      author: { "@id": ORG_ID },
      publisher: {
        "@id": ORG_ID,
        "@type": "Organization",
        name: "MyStockHarbor",
        logo: {
          "@type": "ImageObject",
          url: `${BASE}/logo.png`,
        },
      },
      image: {
        "@type": "ImageObject",
        url: `${BASE}/og-image-v2.png`,
        width: 1200,
        height: 630,
      },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: crumbItems,
    },
    // Always include the site-level nodes so Google can resolve the @ids
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: "MyStockHarbor",
      url: BASE,
      logo: {
        "@type": "ImageObject",
        url: `${BASE}/logo.png`,
      },
    },
    {
      "@type": "WebSite",
      "@id": SITE_ID,
      name: "MyStockHarbor",
      url: BASE,
      publisher: { "@id": ORG_ID },
    },
  ];

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }) }}
    />
  );
}
