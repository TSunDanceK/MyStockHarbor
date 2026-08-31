import { unstable_cache } from "next/cache";
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "@/lib/server/redisCacheMode";

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
// another real call to the YouTube API. Extended to 24h -- new videos aren't
// posted hourly, and this still exists specifically to stop failed/quota-exceeded
// lookups from being retried on every single page render — see "quota burn"
// incident notes in YOUTUBE.md / CLAUDE.md. Without this, a bad key or
// exhausted quota causes every page view to re-attempt the API call, which
// is what blew through the 10,000 unit/day quota in a matter of hours.
const RESULT_CACHE_SECONDS = 60 * 60 * 24; // 24 hours

// --- Redis-backed circuit breaker (added 2026-07-21) -----------------------
//
// The 24h unstable_cache above only dedupes repeat requests for the SAME
// cache key (the same `limit` argument, or the same videoId). It does
// nothing to protect against many DIFFERENT keys all missing at once --
// e.g. a fast crawl/bot burst hitting a dozen different /insights/videos/[id]
// pages within a few minutes, each one a legitimate first-time cache miss
// that still has to make a real call. That's exactly what happened on
// 2026-07-16: ~7 distinct videoIds all 403'd within a 15-minute window
// (confirmed via Vercel runtime error logs), alongside a matching spike in
// /api/symbols traffic in the same window -- consistent with a rapid
// multi-page crawl, not steady organic use.
//
// This adds a second, independent layer underneath the per-key cache: a
// shared hourly call budget (real calls to channels.list + playlistItems.list
// + videos.list combined, since they all draw from the same Google Cloud
// project's 10,000-unit/day pool), plus a long-lived "last known good"
// fallback so that once the budget is hit, pages serve slightly-stale real
// data instead of an empty state or a fresh 403. Normal traffic, even with
// the per-key cache totally cold, needs only a handful of real calls per
// hour, so this ceiling is never expected to bind outside of a burst -- and
// even sustained continuous triggering caps total usage well under the
// daily quota, leaving headroom for any other consumer of the same key.
// PAGE_READ_CACHE, like every other client on a page's read path.
//
// This was a bare Redis.fromEnv(), and it is reached from
// app/insights/videos/[videoId]/page.tsx and app/insights/page.tsx.
// @upstash/redis defaults every REST call to cache: "no-store", and a no-store
// fetch on a PRERENDERED route throws DYNAMIC_SERVER_USAGE at request time --
// a 500, not a fallback to dynamic. That is the #310 configuration exactly, and
// #310 was a 3.5-hour production outage.
//
// It has not been failing only because neither of those routes is currently
// prerendered: the videos route has no generateStaticParams, so its
// revalidate = 1800 is inert and every request is a full render. In other
// words the thing keeping this safe is a separate bug. Fixed first and on its
// own, so that making that route static is a one-line change against a client
// that is already correct rather than two risks landing together.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const YOUTUBE_CALL_COUNTER_PREFIX = "msh:yt-calls:v1";
const YOUTUBE_SAFE_CALLS_PER_HOUR = 100;

const UPLOADS_PLAYLIST_KEY = "msh:yt-uploads-playlist:v1";
const UPLOADS_PLAYLIST_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days -- a channel's uploads playlist ID essentially never changes.

const LAST_GOOD_LIST_PREFIX = "msh:yt-lastgood-list:v1";
const LAST_GOOD_VIDEO_PREFIX = "msh:yt-lastgood-video:v1";
const LAST_GOOD_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days of fallback headroom.

function getHourBucket(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  return `${year}${month}${day}${hour}`;
}

// Reserves one "real call" slot against the shared hourly budget. Returns
// true if the call is allowed to proceed. Fails OPEN (returns true) if Redis
// isn't configured or errors, so a Redis outage never blocks YouTube content
// -- worst case in that scenario is a return to the pre-circuit-breaker
// behavior, not a new failure mode.
async function reserveYouTubeCallSlot(): Promise<boolean> {
  if (!redis) return true;

  try {
    const key = `${YOUTUBE_CALL_COUNTER_PREFIX}:${getHourBucket()}`;
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, 3700); // just over an hour, so the bucket always outlives its own window
    }

    return current <= YOUTUBE_SAFE_CALLS_PER_HOUR;
  } catch {
    return true;
  }
}

async function readCachedUploadsPlaylistId(): Promise<string | null> {
  if (!redis) return null;

  try {
    const id = await redis.get<string>(UPLOADS_PLAYLIST_KEY);
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

async function writeCachedUploadsPlaylistId(id: string) {
  if (!redis) return;

  try {
    await redis.set(UPLOADS_PLAYLIST_KEY, id, { ex: UPLOADS_PLAYLIST_TTL_SECONDS });
  } catch {
    // fail open
  }
}

async function readLastGoodVideoList(limit: number): Promise<YouTubeVideo[] | null> {
  if (!redis) return null;

  try {
    const data = await redis.get<YouTubeVideo[]>(`${LAST_GOOD_LIST_PREFIX}:${limit}`);
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

async function writeLastGoodVideoList(limit: number, videos: YouTubeVideo[]) {
  if (!redis || videos.length === 0) return;

  try {
    await redis.set(`${LAST_GOOD_LIST_PREFIX}:${limit}`, videos, { ex: LAST_GOOD_TTL_SECONDS });
  } catch {
    // fail open
  }
}

async function readLastGoodVideo(videoId: string): Promise<YouTubeVideo | null> {
  if (!redis) return null;

  try {
    const data = await redis.get<YouTubeVideo>(`${LAST_GOOD_VIDEO_PREFIX}:${videoId}`);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

async function writeLastGoodVideo(videoId: string, video: YouTubeVideo) {
  if (!redis) return;

  try {
    await redis.set(`${LAST_GOOD_VIDEO_PREFIX}:${videoId}`, video, { ex: LAST_GOOD_TTL_SECONDS });
  } catch {
    // fail open
  }
}
// -----------------------------------------------------------------------

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
    return (await readLastGoodVideoList(limit)) ?? [];
  }

  try {
    // Individual fetch-level caching is intentionally disabled here (no-store)
    // because the OUTER function (getLatestYouTubeVideos) is already wrapped
    // in unstable_cache below, which caches the full result — success or
    // empty — for RESULT_CACHE_SECONDS. Layering fetch-level caching on top
    // of that was the source of the earlier quota-burn bug: fetch-level
    // caching alone doesn't reliably prevent re-attempts of a failing/error
    // response across renders, whereas wrapping the whole function does.
    let uploadsPlaylistId = await readCachedUploadsPlaylistId();

    if (!uploadsPlaylistId) {
      const allowed = await reserveYouTubeCallSlot();

      if (!allowed) {
        console.error(
          "[youtube] Hourly call budget exhausted — skipping channels.list, serving last-known-good video list."
        );
        return (await readLastGoodVideoList(limit)) ?? [];
      }

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
        return (await readLastGoodVideoList(limit)) ?? [];
      }

      const channelData = (await channelRes.json()) as ChannelsListResponse;
      uploadsPlaylistId =
        channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;

      if (!uploadsPlaylistId) {
        console.error(
          `[youtube] No uploads playlist found for handle ${CHANNEL_HANDLE}. Raw response: ${JSON.stringify(channelData).slice(0, 500)}`
        );
        return (await readLastGoodVideoList(limit)) ?? [];
      }

      await writeCachedUploadsPlaylistId(uploadsPlaylistId);
    }

    // YouTube playlist API supports up to 50 results per request
    const clampedLimit = Math.max(1, Math.min(limit, 50));

    const playlistAllowed = await reserveYouTubeCallSlot();

    if (!playlistAllowed) {
      console.error(
        "[youtube] Hourly call budget exhausted — skipping playlistItems.list, serving last-known-good video list."
      );
      return (await readLastGoodVideoList(limit)) ?? [];
    }

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
      return (await readLastGoodVideoList(limit)) ?? [];
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
      return (await readLastGoodVideoList(limit)) ?? [];
    }

    await writeLastGoodVideoList(limit, videos);
    return videos;
  } catch (err) {
    console.error("[youtube] getLatestYouTubeVideos threw:", err);
    return (await readLastGoodVideoList(limit)) ?? [];
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
    return await readLastGoodVideo(videoId);
  }

  try {
    const allowed = await reserveYouTubeCallSlot();

    if (!allowed) {
      console.error(
        `[youtube] Hourly call budget exhausted — skipping videos.list for ${videoId}, serving last-known-good video.`
      );
      return await readLastGoodVideo(videoId);
    }

    const res = await fetch(
      `${YOUTUBE_API_BASE}/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[youtube] videos.list failed for ${videoId}: ${res.status} ${res.statusText} — ${body.slice(0, 500)}`
      );
      return await readLastGoodVideo(videoId);
    }

    const data = (await res.json()) as VideosListResponse;
    const item = data.items?.[0];
    if (!item) {
      console.error(`[youtube] videos.list returned no item for videoId ${videoId}`);
      return await readLastGoodVideo(videoId);
    }

    const title = item.snippet?.title?.trim() || "";
    const publishedAt = item.snippet?.publishedAt || "";
    const thumbnailUrl = pickThumbnail(item.snippet?.thumbnails);

    if (!title) {
      console.error(`[youtube] videos.list item for ${videoId} had no title.`);
      return await readLastGoodVideo(videoId);
    }

    const video: YouTubeVideo = {
      id: videoId,
      title,
      publishedAt,
      thumbnailUrl,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    };

    await writeLastGoodVideo(videoId, video);
    return video;
  } catch (err) {
    console.error(`[youtube] getYouTubeVideoById(${videoId}) threw:`, err);
    return await readLastGoodVideo(videoId);
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
