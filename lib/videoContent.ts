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
