import { unstable_cache } from "next/cache";

export type YouTubeVideo = {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  url: string;
  embedUrl: string;
};

type ChannelsListResponse = {
  items?: Array<{
    contentDetails?: {
      relatedPlaylists?: {
        uploads?: string;
      };
    };
  }>;
};

type PlaylistItemsListResponse = {
  items?: Array<{
    snippet?: {
      title?: string;
      publishedAt?: string;
      thumbnails?: {
        maxres?: { url?: string };
        standard?: { url?: string };
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
      resourceId?: {
        videoId?: string;
      };
    };
    contentDetails?: {
      videoId?: string;
    };
  }>;
};

type VideosListResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      publishedAt?: string;
      thumbnails?: {
        maxres?: { url?: string };
        standard?: { url?: string };
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
};

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const CHANNEL_HANDLE = "@MyStockHarbor";

// How long a result (success OR failure/empty) is reused before we attempt
// another real call to the YouTube API. This is deliberately short-ish (1h)
// but exists specifically to stop failed/quota-exceeded lookups from being
// retried on every single page render — see "quota burn" incident notes in
// YOUTUBE.md / CLAUDE.md. Without this, a bad key or exhausted quota causes
// every page view to re-attempt the API call, which is what blew through
// the 10,000 unit/day quota in a matter of hours.
const RESULT_CACHE_SECONDS = 60 * 60; // 1 hour

function pickThumbnail(
  thumbs:
    | {
        maxres?: { url?: string };
        standard?: { url?: string };
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      }
    | undefined
) {
  return (
    thumbs?.maxres?.url ||
    thumbs?.standard?.url ||
    thumbs?.high?.url ||
    thumbs?.medium?.url ||
    thumbs?.default?.url ||
    ""
  );
}

async function fetchLatestYouTubeVideosUncached(limit: number): Promise<YouTubeVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    console.error("[youtube] YOUTUBE_API_KEY is not set — skipping video fetch.");
    return [];
  }

  try {
    // Individual fetch-level caching is intentionally disabled here (no-store)
    // because the OUTER function (getLatestYouTubeVideos) is already wrapped
    // in unstable_cache below, which caches the full result — success or
    // empty — for RESULT_CACHE_SECONDS. Layering fetch-level caching on top
    // of that was the source of the earlier quota-burn bug: fetch-level
    // caching alone doesn't reliably prevent re-attempts of a failing/error
    // response across renders, whereas wrapping the whole function does.
    const channelRes = await fetch(
      `${YOUTUBE_API_BASE}/channels?part=contentDetails&forHandle=${encodeURIComponent(
        CHANNEL_HANDLE
      )}&key=${encodeURIComponent(apiKey)}`,
      { cache: "no-store" }
    );

    if (!channelRes.ok) {
      const body = await channelRes.text().catch(() => "");
      console.error(
        `[youtube] channels.list failed: ${channelRes.status} ${channelRes.statusText} — ${body.slice(0, 500)}`
      );
      return [];
    }

    const channelData = (await channelRes.json()) as ChannelsListResponse;
    const uploadsPlaylistId =
      channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsPlaylistId) {
      console.error(
        `[youtube] No uploads playlist found for handle ${CHANNEL_HANDLE}. Raw response: ${JSON.stringify(channelData).slice(0, 500)}`
      );
      return [];
    }

    // YouTube playlist API supports up to 50 results per request
    const clampedLimit = Math.max(1, Math.min(limit, 50));

    const playlistRes = await fetch(
      `${YOUTUBE_API_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(
        uploadsPlaylistId
      )}&maxResults=${clampedLimit}&key=${encodeURIComponent(apiKey)}`,
      { cache: "no-store" }
    );

    if (!playlistRes.ok) {
      const body = await playlistRes.text().catch(() => "");
      console.error(
        `[youtube] playlistItems.list failed: ${playlistRes.status} ${playlistRes.statusText} — ${body.slice(0, 500)}`
      );
      return [];
    }

    const playlistData = (await playlistRes.json()) as PlaylistItemsListResponse;

    const videos = (playlistData.items ?? [])
      .map((item) => {
        const videoId =
          item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || "";
        const title = item.snippet?.title?.trim() || "";
        const publishedAt = item.snippet?.publishedAt || "";
        const thumbnailUrl = pickThumbnail(item.snippet?.thumbnails);

        if (!videoId || !title) return null;

        return {
          id: videoId,
          title,
          publishedAt,
          thumbnailUrl,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
        } satisfies YouTubeVideo;
      })
      .filter((video): video is YouTubeVideo => Boolean(video));

    if (videos.length === 0) {
      console.error(
        `[youtube] playlistItems.list returned ${playlistData.items?.length ?? 0} raw items but 0 mapped to valid videos. Raw response: ${JSON.stringify(playlistData).slice(0, 800)}`
      );
    }

    return videos;
  } catch (err) {
    console.error("[youtube] getLatestYouTubeVideos threw:", err);
    return [];
  }
}

// Wrapped in unstable_cache so that, regardless of how many times this is
// called across concurrent/rapid page renders, the actual YouTube API is
// only hit once per RESULT_CACHE_SECONDS window (per distinct `limit`
// argument). This caches failures/empty results too, which is the important
// part — it's what stops a bad key or exhausted quota from being retried on
// every page view.
export const getLatestYouTubeVideos = (limit = 3): Promise<YouTubeVideo[]> =>
  unstable_cache(
    (l: number) => fetchLatestYouTubeVideosUncached(l),
    ["latest-youtube-videos"],
    { revalidate: RESULT_CACHE_SECONDS, tags: ["youtube-videos"] }
  )(limit);

// Fetches a single video by its YouTube video ID.
// Used by /insights/videos/[videoId] to build the page even without a markdown file.
async function fetchYouTubeVideoByIdUncached(videoId: string): Promise<YouTubeVideo | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error("[youtube] YOUTUBE_API_KEY is not set — skipping single-video fetch.");
    return null;
  }

  try {
    const res = await fetch(
      `${YOUTUBE_API_BASE}/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[youtube] videos.list failed for ${videoId}: ${res.status} ${res.statusText} — ${body.slice(0, 500)}`
      );
      return null;
    }

    const data = (await res.json()) as VideosListResponse;
    const item = data.items?.[0];
    if (!item) {
      console.error(`[youtube] videos.list returned no item for videoId ${videoId}`);
      return null;
    }

    const title = item.snippet?.title?.trim() || "";
    const publishedAt = item.snippet?.publishedAt || "";
    const thumbnailUrl = pickThumbnail(item.snippet?.thumbnails);

    if (!title) {
      console.error(`[youtube] videos.list item for ${videoId} had no title.`);
      return null;
    }

    return {
      id: videoId,
      title,
      publishedAt,
      thumbnailUrl,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    };
  } catch (err) {
    console.error(`[youtube] getYouTubeVideoById(${videoId}) threw:`, err);
    return null;
  }
}

// Same rationale as getLatestYouTubeVideos above: cache success AND failure
// per videoId for RESULT_CACHE_SECONDS so a bad key/quota exhaustion can't
// be retried on every render of every video page.
export const getYouTubeVideoById = (videoId: string): Promise<YouTubeVideo | null> =>
  unstable_cache(
    (id: string) => fetchYouTubeVideoByIdUncached(id),
    ["youtube-video-by-id"],
    { revalidate: RESULT_CACHE_SECONDS, tags: ["youtube-videos"] }
  )(videoId);
