// WHICH VIDEO A /insights/videos/[videoId] PAGE SHOWS (#563 COWORK #70).
//
// Three sources, in order, and a 404 only when none of them knows the id:
//   1. getYouTubeVideoById: the API, or its last-known-good copy;
//   2. the latest-videos list the same render already holds: the list the
//      header's "Video Breakdowns" link comes from;
//   3. the written analysis on disk (content/videos/*.md).
//
// Source 2 was missing. A brand-new video has no last-known-good copy yet, so
// when the hourly YouTube budget was spent its by-id read came back null; with
// no article on disk either, the page 404'd on the very link the site's own
// nav had just offered, and ISR cached that 404 for 30 minutes.
import type { YouTubeVideo } from "@/lib/youtube";
import { toFallbackVideo, type VideoContent } from "@/lib/videoContent";

/**
 * How many latest videos the header and the video page both ask for. ONE
 * NUMBER, because getLatestYouTubeVideos caches (and keeps a last-known-good
 * list) per limit: the header reading 1 and the page reading 20 were two
 * separate 24-hour entries, so the header could link to an id the page's list
 * didn't hold yet.
 */
export const LATEST_VIDEOS_LIMIT = 20;

export function resolveVideo(
  videoId: string,
  apiVideo: YouTubeVideo | null,
  apiVideos: readonly YouTubeVideo[],
  videoContent: VideoContent | null,
): YouTubeVideo | null {
  return apiVideo ?? apiVideos.find((v) => v.id === videoId) ?? (videoContent ? toFallbackVideo(videoContent) : null);
}
