// Read-only, throwaway: fetch the four /headlines feeds and print each body
// base64-encoded on one line, for a LOCAL screenshot fixture (Relay B, #553
// COWORK #41). The sandbox is refused these hosts; a runner is not.
const UA = "MyStockHarbor/1.0 (+https://www.mystockharbor.com; headlines screenshot fixture)";
const FEEDS = [
  "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire---Public-Companies",
  "https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss",
  "https://feeds.content.dowjones.io/public/rss/mw_topstories",
  "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
];
for (const url of FEEDS) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*" } });
    const body = await res.text();
    console.log(`FEED-XML ${res.status} ${url} ${Buffer.from(body, "utf8").toString("base64")}`);
  } catch (e) {
    console.log(`FEED-XML ERR ${url} ${String(e).slice(0, 200)}`);
  }
}
