// Where the local stack differs from a deployed one, and how a client is helped past it.
//
// Room links. Placing a room URL sends it to reticulum's media resolver (POST /api/v1/media). On this
// stack the room's host is hubs.local, which resolves to 127.0.0.1 inside the reticulum container, and
// the resolver refuses internal addresses (HttpUtils.internal_ip?) and looks names up through DNS only,
// so it answers 500 for every room of its own. On a deployed server the host has a public address and
// the resolver reads the room page's OpenGraph tags instead. The harness answers that one request the
// way reticulum would on such a host: the URL, its content type and the room page's og:image as the
// thumbnail. Everything after it (the link object, its hover menu, the room change) is the client's own.
import type { Page } from "@playwright/test";
import type { Client } from "./launch";

/** What reticulum itself answers for a room URL here: the status of the client's own request */
export async function resolverStatus(page: Page, url: string): Promise<number> {
  const res = await page.request.post(new URL("/api/v1/media", url).toString(), {
    data: { media: { url, quality: "high" }, version: 1 },
    headers: { "content-type": "application/json" }
  });
  return res.status();
}

/**
 * Makes the client's media resolution of `roomUrls` succeed as on a deployed server (see above).
 * Other media requests go to reticulum unchanged.
 */
export async function answerRoomLinks(client: Client, roomUrls: string[]) {
  const thumbnails = new Map<string, string | null>();
  await client.page.route("**/api/v1/media", async route => {
    const request = route.request();
    const url: string | undefined = request.method() === "POST" ? request.postDataJSON()?.media?.url : undefined;
    if (!url || !roomUrls.includes(url)) return route.continue();
    if (!thumbnails.has(url)) {
      const html = await (await client.page.request.get(url)).text();
      thumbnails.set(url, html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null);
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ origin: url, meta: { expected_content_type: "text/html; charset=utf-8", thumbnail: thumbnails.get(url) } })
    });
  });
}

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mp4: "video/mp4",
  glb: "model/gltf-binary",
  pdf: "application/pdf"
};

/**
 * The same for the test media of the assets service (https://hubs.local:3001/...): the bitECS based client
 * resolves every media URL through reticulum's media resolver, which refuses hubs.local here (an internal
 * address inside its container) and answers 500, so nothing placed from the assets service would load. The
 * harness answers as reticulum does for a public URL: the URL itself and its content type. The old loader
 * does not ask for these URLs. Returns the URLs it answered, for the evidence.
 */
export async function answerAssetUrls(client: Client, assetsUrl: string): Promise<string[]> {
  const answered: string[] = [];
  await client.page.route("**/api/v1/media", async route => {
    const request = route.request();
    const url: string | undefined = request.method() === "POST" ? request.postDataJSON()?.media?.url : undefined;
    if (!url || !url.startsWith(`${assetsUrl}/`)) return route.continue();
    const type = CONTENT_TYPES[url.split("?")[0].split(".").pop()?.toLowerCase() ?? ""];
    if (!type) return route.continue();
    answered.push(url);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ origin: url, meta: { expected_content_type: type } }) });
  });
  return answered;
}
