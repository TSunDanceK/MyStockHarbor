import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllPosts, getPostBySlug } from "@/lib/blog";
import { getOrCreateInsightSnapshot } from "@/lib/insightSnapshots";
import { remark } from "remark";
import html from "remark-html";
import InsightPostClient from "./InsightPostClient";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  const posts = getAllPosts();

  return posts.map((post) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const post = getPostBySlug(slug);

    return {
      title: `${post.title} | MyStockHarbor`,
      description: post.excerpt,
      alternates: {
        canonical: `https://mystockharbor.com/insights/${slug}`,
      },
      openGraph: {
        title: `${post.title} | MyStockHarbor`,
        description: post.excerpt,
        url: `https://mystockharbor.com/insights/${slug}`,
        siteName: "MyStockHarbor",
        type: "article",
      },
      twitter: {
        card: "summary_large_image",
        title: `${post.title} | MyStockHarbor`,
        description: post.excerpt,
      },
    };
  } catch {
    return {
      title: "Insight | MyStockHarbor",
      description: "Stock market insight from MyStockHarbor.",
    };
  }
}

export default async function InsightPostPage({ params }: Props) {
  const { slug } = await params;

  let post: ReturnType<typeof getPostBySlug>;

  try {
    post = getPostBySlug(slug);
  } catch {
    notFound();
  }

  const processedContent = await remark().use(html).process(post.content);
  const contentHtml = processedContent.toString();

const snapshot = await getOrCreateInsightSnapshot({
  slug: post.slug,
  symbol: post.symbol ?? null,
});

  const snapshot = redisSnapshot ?? post.snapshot ?? null;

  return (
    <InsightPostClient
      post={{
        slug: post.slug,
        title: post.title,
        date: post.date,
        excerpt: post.excerpt,
        symbol: post.symbol ?? null,
        contentHtml,
      }}
      snapshot={snapshot}
    />
  );
}
