const INDEXNOW_KEY = "f45f5dd3c7a543e4a3105df95370a999";
const SITE_HOST = "www.mystockharbor.com";
const KEY_LOCATION = `https://${SITE_HOST}/${INDEXNOW_KEY}.txt`;

export async function submitUrlsToIndexNow(urls: string[]) {
  const cleaned = Array.from(
    new Set(
      urls
        .map((url) => url.trim())
        .filter(Boolean)
        .filter((url) => url.startsWith(`https://${SITE_HOST}/`))
    )
  );

  if (cleaned.length === 0) {
    return {
      ok: false,
      status: 400,
      message: "No valid MyStockHarbor URLs supplied.",
    };
  }

  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      host: SITE_HOST,
      key: INDEXNOW_KEY,
      keyLocation: KEY_LOCATION,
      urlList: cleaned,
    }),
  });

  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    body: text,
    submitted: cleaned,
  };
}
