import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "@/lib/server/redisCacheMode";
import { submitUrlsToIndexNow } from "@/lib/indexnow";

function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  // Read from /insights/[slug]'s render (submitInsightToIndexNowOnce), so it is
  // on a prerendered page's read path and takes PAGE_READ_CACHE for the same
  // reason as the snapshot client above it.
  return Redis.fromEnv(PAGE_READ_CACHE);
}

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }

  if (process.env.SITE_URL) {
    return process.env.SITE_URL.replace(/\/$/, "");
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, "")}`;
  }

  return "https://www.mystockharbor.com";
}

export async function submitInsightToIndexNowOnce(slug: string) {
  const cleanSlug = String(slug ?? "").trim().toLowerCase();
  if (!cleanSlug) return null;

  const redis = getRedisClient();
  if (!redis) return null;

  const key = `indexnow:insight:${cleanSlug}`;
  const alreadySubmitted = await redis.get<string | null>(key);

  if (alreadySubmitted) {
    return {
      ok: true,
      skipped: true,
      reason: "Already submitted before",
    };
  }

  const baseUrl = getBaseUrl();

  const result = await submitUrlsToIndexNow([
    `${baseUrl}/insights`,
    `${baseUrl}/insights/${cleanSlug}`,
  ]);

  if (result.ok) {
    await redis.set(key, new Date().toISOString());
  }

  return result;
}
