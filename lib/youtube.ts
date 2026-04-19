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
      return [];
    }

    const channelData = (await channelRes.json()) as ChannelsListResponse;
    const uploadsPlaylistId =
      channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsPlaylistId) {
      return [];
    }

    const playlistRes = await fetch(
      `${YOUTUBE_API_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(
        uploadsPlaylistId
      )}&maxResults=${Math.max(1, Math.min(limit, 10))}&key=${encodeURIComponent(apiKey)}`,
      {
        next: { revalidate: 60 * 60 * 12 },
      }
    );

    if (!playlistRes.ok) {
      return [];
    }

    const playlistData = (await playlistRes.json()) as PlaylistItemsListResponse;

    return (playlistData.items ?? [])
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
  } catch {
    return [];
  }
}
