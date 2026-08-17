import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { YouTubeVideo } from "@/lib/youtube";

const videosDirectory = path.join(process.cwd(), "content/videos");

export type VideoContent = {
  youtubeId: string;
  ticker: string | null;
  title: string;
  publishedAt: string;
  datasheetImage: string | null;
  content: string;
};

// Minimal metadata needed to render a static card on the /insights page
// without touching the YouTube API. All fields come from the .md frontmatter
// and the first paragraph of the body.
export type VideoMeta = {
  youtubeId: string;
  ticker: string | null;       // e.g. "AVAV", or null for multi-stock videos
  title: string;               // frontmatter `title`, else derived from ticker
  publishedAt: string;         // frontmatter `date` (ISO), else "" (unknown)
  label: string;               // statLabel1 — used as the card subtitle
  value: string;               // statValue1 — the headline figure
  excerpt: string;             // first non-empty paragraph of the body
};

// Neither field is required in the frontmatter today (none of the existing
// content/videos/*.md files carry them), so both degrade rather than throw:
// a missing `title` becomes a ticker-derived one, a missing `date` becomes
// "" and the card simply renders without a date. Adding either to a .md file
// upgrades that card with no code change.
function readTitle(data: Record<string, unknown>, ticker: string | null): string {
  const raw = typeof data.title === "string" ? data.title.trim() : "";
  if (raw) return raw;
  return ticker ? `${ticker} — stock analysis` : "Stock market video analysis";
}

function readPublishedAt(data: Record<string, unknown>): string {
  const value = data.date;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value.trim());
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return "";
}

function readTicker(data: Record<string, unknown>): string | null {
  return typeof data.ticker === "string" && data.ticker.trim()
    ? data.ticker.trim().toUpperCase()
    : null;
}

export function getVideoContent(youtubeId: string): VideoContent | null {
  const filePath = path.join(videosDirectory, `${youtubeId}.md`);

  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const { data, content } = matter(raw);
    const ticker = readTicker(data);

    return {
      youtubeId,
      ticker,
      title: readTitle(data, ticker),
      publishedAt: readPublishedAt(data),
      datasheetImage:
        typeof data.datasheetImage === "string" && data.datasheetImage.trim()
          ? data.datasheetImage.trim()
          : null,
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
//
// Used by /insights to render a fully SSR static list of video page links so
// Googlebot can discover and crawl them without relying on client-side
// JavaScript or the YouTube API being available.
//
// This function existed for exactly that purpose from the start but was never
// wired up: /insights built its video list from getLatestYouTubeVideos()
// alone, so whenever the API was down or quota-blocked the page shipped ZERO
// links to /insights/videos/*, and even on a good day it only ever linked the
// channel's latest 20 uploads — a different set from the .md files the sitemap
// submits. GSC URL Inspection showed the result plainly: video pages found via
// the sitemap with "Referring page: None detected". Reading from disk makes
// the internal link set deterministic and, by construction, identical to the
// set app/sitemap.ts submits (both derive from content/videos/*.md).
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

        const ticker = readTicker(data);

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

        return {
          youtubeId,
          ticker,
          title: readTitle(data, ticker),
          publishedAt: readPublishedAt(data),
          label,
          value,
          excerpt,
        };
      } catch {
        return null;
      }
    })
    .filter((m): m is VideoMeta => m !== null)
    // Most recent files listed last by filesystem order — reverse so newest first
    .reverse();
}

// Builds a YouTubeVideo-shaped object from disk metadata alone, with no API
// call. Every URL here is deterministic from the video ID, so this is always
// safe to construct:
//   - i.ytimg.com/vi/{id}/hqdefault.jpg is YouTube's stable thumbnail path
//   - youtube-nocookie.com/embed/{id} matches the embedUrl lib/youtube.ts
//     builds, so the player behaves identically either way
//
// The one thing disk cannot supply is the real YouTube title, so callers that
// DO have live API data should overlay it on top of this (see /insights).
// This is the floor, not a replacement.
export function toFallbackVideo(meta: VideoMeta | VideoContent): YouTubeVideo {
  const id = meta.youtubeId;

  return {
    id,
    title: meta.title,
    publishedAt: meta.publishedAt,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
  };
}

// Merges the guaranteed disk-backed list with whatever the YouTube API
// returned. Disk entries always survive (that's the point — they are the ones
// in the sitemap and the ones carrying written analysis); live API data is
// overlaid on top of them for the real title, thumbnail and publish date.
// API-only videos (uploads with no .md file yet) are appended afterwards so
// the channel still lists in full for visitors.
export function mergeVideoLists(
  diskMeta: VideoMeta[],
  apiVideos: YouTubeVideo[]
): YouTubeVideo[] {
  const apiById = new Map(apiVideos.map((video) => [video.id, video]));

  const merged: YouTubeVideo[] = diskMeta.map((meta) => {
    const fallback = toFallbackVideo(meta);
    const live = apiById.get(meta.youtubeId);
    if (!live) return fallback;

    return {
      ...fallback,
      title: live.title || fallback.title,
      thumbnailUrl: live.thumbnailUrl || fallback.thumbnailUrl,
      publishedAt: live.publishedAt || fallback.publishedAt,
      embedUrl: live.embedUrl || fallback.embedUrl,
      url: live.url || fallback.url,
    };
  });

  const diskIds = new Set(diskMeta.map((meta) => meta.youtubeId));
  const apiOnly = apiVideos.filter((video) => !diskIds.has(video.id));

  // Sort the disk-backed block newest-first where a date is known, leaving
  // undated entries in their existing (reversed filesystem) order at the end.
  merged.sort((a, b) => {
    if (a.publishedAt && b.publishedAt) {
      return b.publishedAt.localeCompare(a.publishedAt);
    }
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return 0;
  });

  return [...merged, ...apiOnly];
}
