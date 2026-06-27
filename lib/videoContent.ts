import fs from "fs";
import path from "path";
import matter from "gray-matter";

const videosDirectory = path.join(process.cwd(), "content/videos");

export type VideoContent = {
  youtubeId: string;
  ticker: string | null;
  datasheetImage: string | null;
  content: string;
};

// Minimal metadata needed to render a static card on the /insights page
// without touching the YouTube API. All fields come from the .md frontmatter
// and the first paragraph of the body.
export type VideoMeta = {
  youtubeId: string;
  ticker: string | null;       // e.g. "AVAV", or null for multi-stock videos
  label: string;               // statLabel1 — used as the card subtitle
  value: string;               // statValue1 — the headline figure
  excerpt: string;             // first non-empty paragraph of the body
};

export function getVideoContent(youtubeId: string): VideoContent | null {
  const filePath = path.join(videosDirectory, `${youtubeId}.md`);

  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const { data, content } = matter(raw);

    return {
      youtubeId,
      ticker: typeof data.ticker === "string" && data.ticker.trim() ? data.ticker.trim().toUpperCase() : null,
      datasheetImage: typeof data.datasheetImage === "string" && data.datasheetImage.trim() ? data.datasheetImage.trim() : null,
      content: content.trim(),
    };
  } catch {
    return null;
  }
}

// Returns all YouTube video IDs that have a content file in content/videos/
// Used by the sitemap to register video pages for indexing.
export function getAllVideoIds(): string[] {
  if (!fs.existsSync(videosDirectory)) return [];

  return fs
    .readdirSync(videosDirectory)
    .filter((file) => file.endsWith(".md") && file !== ".gitkeep")
    .map((file) => file.replace(/\.md$/, ""));
}

// Returns lightweight metadata for every video that has a content file.
// Reads only from content/videos/*.md — no YouTube API call.
// Used by /insights to render a fully SSR static list of video page links
// so Googlebot can discover and crawl them without relying on client-side
// JavaScript or the YouTube API being available.
export function getAllVideoMeta(): VideoMeta[] {
  if (!fs.existsSync(videosDirectory)) return [];

  const files = fs
    .readdirSync(videosDirectory)
    .filter((file) => file.endsWith(".md") && file !== ".gitkeep");

  return files
    .map((file): VideoMeta | null => {
      const youtubeId = file.replace(/\.md$/, "");
      const filePath = path.join(videosDirectory, file);

      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const { data, content } = matter(raw);

        const ticker =
          typeof data.ticker === "string" && data.ticker.trim()
            ? data.ticker.trim().toUpperCase()
            : null;

        const label =
          typeof data.statLabel1 === "string" ? data.statLabel1.trim() : "";

        const value =
          typeof data.statValue1 === "string" ? String(data.statValue1).trim() : "";

        // Extract the first non-empty, non-heading paragraph from the body
        const excerpt =
          content
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("-"))
            .find((l) => l.length > 40) ?? "";

        return { youtubeId, ticker, label, value, excerpt };
      } catch {
        return null;
      }
    })
    .filter((m): m is VideoMeta => m !== null)
    // Most recent files listed last by filesystem order — reverse so newest first
    .reverse();
}
