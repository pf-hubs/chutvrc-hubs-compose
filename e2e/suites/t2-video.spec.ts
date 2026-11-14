// T2 transport and media, video (plan 4): T2.4 camera, screen share, switching between them and stopping;
// T2.5 a placed video file playing in step on both clients, and the camera tool's snapshot.
// On Dialog in the Dialog block and on LiveKit in a LiveKit block.
import type { Page } from "@playwright/test";
import { test } from "./harness";
import type { Client } from "../clients/launch";
import * as input from "../clients/input";
import { VIDEO_URL } from "../assets/generate";
import { remoteTracks } from "../probes/session";
import { VIDEO_MATCH, colourDistance, describeVideo, matches, seenVideo, slotColour } from "../probes/video";
import { measureRates } from "../probes/connections";
import { blockId, blockTitle, runsOn } from "./blocks";
import { closingChecks, connectedCheck, frameRateCheck, idOf, mainRoom, startPair, waitUntil } from "./common";
import { reannounceAvatars } from "../clients/workarounds";

const SERVERS = ["dialog", "livekit"] as const;

// ---------- T2.4 ----------

type Expect = "camera" | "screen" | "none";

for (const server of SERVERS) {
  test(
    `T2.4 camera and screen share on ${blockTitle(server)}`,
    { annotation: [{ type: "id", description: `t2.4-${blockId(server)}` }, { type: "covers", description: "F1 A1j A6" }] },
    async ({ evidence }) => {
      runsOn(server);
      await evidence.recordWithObs();
      const [a, b] = await startPair(evidence, mainRoom(server));
      const ida = await idOf(a);
      await frameRateCheck(evidence, [a, b]);
      await connectedCheck(evidence, [a, b], server, "F1");
      // B faces A, so B's screenshots show the shared video where the client puts it in the room
      await input.faceTowards(b.page, { clientId: ida });

      const step = async (name: string, action: (p: Page) => Promise<void>, expect: Expect) =>
        evidence.check(name, "F1 A1j A6", async () => {
          await action(a.page);
          await a.page.waitForTimeout(3500);
          const waitMs = expect === "none" ? 2500 : 10_000;
          const [own, seen, tracks, rates] = await Promise.all([
            seenVideo(a.page, ida, waitMs),
            seenVideo(b.page, ida, waitMs),
            remoteTracks(b.page, ida),
            measureRates(b.page, 1500)
          ]);
          await evidence.screenshot(b, name);
          const camera = slotColour(a.slot);
          let ok: boolean;
          let expected: string;
          if (expect === "none") {
            ok = !seen.hasTrack && !own.hasTrack;
            expected = "no video from A";
          } else if (expect === "camera") {
            // A's own published track is the camera clip; B's picture matches it and is the slot's colour
            ok = matches(seen, own.mean) && !!seen.mean && colourDistance(seen.mean, camera) <= 2 * VIDEO_MATCH;
            expected = `A's camera clip (rgb ${camera.join(", ")})`;
          } else {
            // The screen: whatever A's own screen track shows (Chromium's fake screen), and not the camera clip
            ok = matches(seen, own.mean) && !!seen.mean && colourDistance(seen.mean, camera) > VIDEO_MATCH;
            expected = "A's screen track";
          }
          return {
            ok,
            summary:
              `expected ${expected}; B sees ${describeVideo(seen)}; A's own track ${describeVideo(own)}` +
              (seen.mean && own.mean ? `; distance ${colourDistance(seen.mean, own.mean)}` : "") +
              `; B keeps ${tracks.video.length} video track(s) for A, receives ${rates.rates.inbound.video?.kbps ?? 0} kbit/s of video`,
            data: { seen, own, tracks, inboundVideo: rates.rates.inbound.video ?? null }
          };
        });

      // While something is shared, the toolbar's Share button stops it instead of opening the popover
      // (SharePopover.js), so switching from one source to the other is Share, then Share > the other
      await step("Share > Camera: B sees A's camera", input.toggleShareCamera, "camera");
      await step("Share (stops the camera)", input.stopSharing, "none");
      await step("Share > Screen: B sees A's screen", input.toggleShareScreen, "screen");
      await step("Share (stops the screen)", input.stopSharing, "none");
      await step("Share > Camera again: B sees A's camera", input.toggleShareCamera, "camera");
      await step("Share (stops the camera): no video", input.stopSharing, "none");
      await closingChecks(evidence, [a, b]);
    }
  );
}

// ---------- T2.5 ----------

/** currentTime, paused and readiness of the placed video with this URL, as a client plays it */
function videoState(page: Page, src: string) {
  return page.evaluate(
    ({ finder, src }) => {
      const el = new Function("arg", finder)({ src });
      const video: HTMLVideoElement | undefined = el?.components?.["media-video"]?.video;
      return video ? { t: +video.currentTime.toFixed(2), paused: video.paused, readyState: video.readyState, at: Date.now() } : null;
    },
    { finder: input.FIND_MEDIA_CODE, src }
  );
}

/** The placed media whose URL is a reticulum upload (the camera tool's snapshots) */
function snapshots(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("[media-loader]")]
      .map(el => (el as any).components["media-loader"]?.data?.src as string)
      .filter(src => !!src && /\/files\/[^/]+\.(png|jpg|jpeg)/.test(src))
  );
}

/** Page code finding the camera tool's "Photo" button: the parent of the label whose text is "Photo" */
const FIND_PHOTO_BUTTON = `
  let found = null;
  window.APP.world.scene.traverse(o => { if (!found && o.text === "Photo" && o.parent) found = o.parent; });
  return found && { object3D: found };`;

for (const server of SERVERS) {
  test(
    `T2.5 video file and camera tool on ${blockTitle(server)}`,
    { annotation: [{ type: "id", description: `t2.5-${blockId(server)}` }, { type: "covers", description: "F1" }] },
    async ({ evidence }) => {
      runsOn(server);
      await evidence.recordWithObs();
      const [a, b] = await startPair(evidence, mainRoom(server));
      await frameRateCheck(evidence, [a, b]);
      // B has to see the objects A places; the avatar models do not matter here
      await reannounceAvatars([a, b], evidence, "so B can face A's avatar where A places the objects");

      await evidence.check("A places a video file: it plays in step on both", "F1", async () => {
        await input.placeFromUrl(a.page, VIDEO_URL);
        const loaded = await waitUntil(
          async () => {
            const [sa, sb] = await Promise.all([videoState(a.page, VIDEO_URL), videoState(b.page, VIDEO_URL)]);
            return sa && sb && sa.readyState >= 2 && sb.readyState >= 2 && !sa.paused && !sb.paused ? { sa, sb } : null;
          },
          30_000
        );
        await input.faceTowards(b.page, { mediaSrc: VIDEO_URL });
        await evidence.screenshot(a, "video-placed");
        await evidence.screenshot(b, "video-placed");
        if (!loaded.value) {
          const [sa, sb] = await Promise.all([videoState(a.page, VIDEO_URL), videoState(b.page, VIDEO_URL)]);
          return { ok: false, summary: `the video did not play on both within 30 s: A ${JSON.stringify(sa)}, B ${JSON.stringify(sb)}`, data: { sa, sb } };
        }
        const samples: { a: number; b: number; diff: number }[] = [];
        for (let i = 0; i < 4; i++) {
          await a.page.waitForTimeout(2000);
          const [sa, sb] = await Promise.all([videoState(a.page, VIDEO_URL), videoState(b.page, VIDEO_URL)]);
          if (sa && sb) samples.push({ a: sa.t, b: sb.t, diff: +Math.abs(sa.t - sb.t - (sa.at - sb.at) / 1000).toFixed(2) });
        }
        const worst = Math.max(...samples.map(s => s.diff));
        const advancing = samples.length > 1 && samples[samples.length - 1].a > samples[0].a && samples[samples.length - 1].b > samples[0].b;
        return {
          ok: samples.length === 4 && worst <= 1 && advancing,
          summary: `playing on both after ${(loaded.ms / 1000).toFixed(1)} s; A and B ${samples.map(s => `${s.a}/${s.b}`).join(", ")} s; largest difference ${worst} s (limit 1 s)`,
          data: { samples, loadMs: loaded.ms }
        };
      });

      await evidence.check("A takes a photo with the camera tool: the snapshot appears for both", "F1", async () => {
        const before = { a: await snapshots(a.page), b: await snapshots(b.page) };
        await input.toggleCameraTool(a.page);
        await a.page.waitForFunction(f => !!new Function(f)(), FIND_PHOTO_BUTTON, { timeout: 15_000 });
        await a.page.waitForTimeout(1500);
        await evidence.screenshot(a, "camera-tool");
        await input.clickInWorld(a.page, FIND_PHOTO_BUTTON, undefined, "the camera tool's Photo button");
        // A three second countdown, then the picture is uploaded and placed
        const after = await waitUntil(
          async () => {
            const [sa, sb] = await Promise.all([snapshots(a.page), snapshots(b.page)]);
            return sa.length > before.a.length && sb.length > before.b.length ? { sa, sb } : null;
          },
          30_000
        );
        await evidence.screenshot(a, "snapshot");
        await evidence.screenshot(b, "snapshot");
        const now = { a: await snapshots(a.page), b: await snapshots(b.page) };
        // The tool is removed again
        await input.toggleCameraTool(a.page).catch(() => {});
        return {
          ok: !!after.value,
          summary: after.value
            ? `the snapshot appeared on both within ${(after.ms / 1000).toFixed(1)} s (${now.a.length} on A, ${now.b.length} on B)`
            : `no snapshot on both within 30 s (A has ${now.a.length}, B ${now.b.length}, before ${before.a.length}/${before.b.length})`,
          data: { before, now }
        };
      });
      await closingChecks(evidence, [a, b] as Client[]);
    }
  );
}
