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
