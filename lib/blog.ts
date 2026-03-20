import fs from "fs";
import path from "path";
import matter from "gray-matter";

const postsDirectory = path.join(process.cwd(), "content/insights");

export type BlogPost = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  symbol?: string | null;
};

function formatFrontmatterDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(postsDirectory)) return [];

  const fileNames = fs
    .readdirSync(postsDirectory)
    .filter((fileName) => fileName.endsWith(".md"));

  const posts = fileNames.map((fileName) => {
    const slug = fileName.replace(/\.md$/, "");
    const fullPath = path.join(postsDirectory, fileName);
    const fileContents = fs.readFileSync(fullPath, "utf8");

    const { data } = matter(fileContents);

    return {
      slug,
      title: String(data.title || ""),
      date: formatFrontmatterDate(data.date),
      excerpt: String(data.excerpt || ""),
      symbol: data.symbol ? String(data.symbol) : null,
    };
  });

  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostBySlug(slug: string) {
  const fullPath = path.join(postsDirectory, `${slug}.md`);
  const fileContents = fs.readFileSync(fullPath, "utf8");

  const { data, content } = matter(fileContents);

  return {
    slug,
    title: String(data.title || ""),
    date: formatFrontmatterDate(data.date),
    excerpt: String(data.excerpt || ""),
    symbol: data.symbol ? String(data.symbol) : null,
    content,
  };
}
