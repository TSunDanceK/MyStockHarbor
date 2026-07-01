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

export async function getLatestYouTubeVideos(limit = 3): Promise<YouTubeVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    console.error("[youtube] YOUTUBE_API_KEY is not set — skipping video fetch.");
    return [];
  }

  try {
    const channelRes = await fetch(
      `${YOUTUBE_API_BASE}/channels?part=contentDetails&forHandle=${encodeURIComponent(
        CHANNEL_HANDLE
      )}&key=${encodeURIComponent(apiKey)}`,
      {
        next: { revalidate: 60 * 60 * 12 },
      }
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
      {
        next: { revalidate: 60 * 60 * 12 },
      }
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

// Fetches a single video by its YouTube video ID.
// Used by /insights/videos/[videoId] to build the page even without a markdown file.
export async function getYouTubeVideoById(videoId: string): Promise<YouTubeVideo | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error("[youtube] YOUTUBE_API_KEY is not set — skipping single-video fetch.");
    return null;
  }

  try {
    const res = await fetch(
      `${YOUTUBE_API_BASE}/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`,
      { next: { revalidate: 60 * 60 * 12 } }
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
