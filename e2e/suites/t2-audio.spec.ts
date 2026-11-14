// T2 transport and media, audio (plan 4): T2.1 both talk, T2.2 mute and unmute with the toolbar,
// T2.3 changing the input device in audio settings. Each runs on Dialog in the Dialog block and on
// LiveKit in a LiveKit block (suites/blocks.ts).
import { test } from "./harness";
import type { Evidence } from "../report/evidence";
import { room, type MediaServer } from "../lib/fixtures";
import * as input from "../clients/input";
import { startCablePlayer, CABLE_MICROPHONE, type CablePlayer } from "../clients/cable";
import { CONTROL_HZ } from "../assets/media";
import { readSession, remoteTracks } from "../probes/session";
import { PILOT_SILENT, heardPilot, startPilotWatch, stopPilotWatch } from "../probes/audio";
import { describePairs, measureRates, packetRateFrom } from "../probes/connections";
import { blockId, blockTitle, runsOn } from "./blocks";
import {
  closingChecks,
  connectedCheck,
  enterAll,
  frameRateCheck,
  heard,
  idOf,
  mainRoom,
  micWishLost,
  pilotText,
  silent,
  startClients,
  startPair,
  twoWayAudio
} from "./common";

const SERVERS = ["dialog", "livekit"] as const;
const covers = (server: MediaServer, items: string) => (server === "livekit" ? `${items} L2` : items);

// ---------- T2.1 ----------

for (const server of SERVERS) {
  test(
    `T2.1 both talk on ${blockTitle(server)}`,
    { annotation: [{ type: "id", description: `t2.1-${blockId(server)}` }, { type: "covers", description: covers(server, "B1") }] },
    async ({ evidence }) => {
      runsOn(server);
      await evidence.recordWithObs();
      const [a, b] = await startPair(evidence, mainRoom(server));
      await evidence.screenshot(a, "entered");
      await evidence.screenshot(b, "entered");
      await frameRateCheck(evidence, [a, b]);
      await connectedCheck(evidence, [a, b], server, covers(server, "B1"));

      await evidence.check("Each detects the other's pilot", covers(server, "B1"), async () => {
        const r = await twoWayAudio(a, b);
        return { ok: r.ok, summary: `B hears A: ${pilotText(r.bHearsA)}; A hears B: ${pilotText(r.aHearsB)}`, data: r };
      });

      await evidence.check("Audio packets flow both ways (inbound-rtp of the other's track)", covers(server, "B1"), async () => {
        const [ida, idb] = [await idOf(a), await idOf(b)];
        const [ra, rb] = await Promise.all([measureRates(a.page), measureRates(b.page)]);
        evidence.saveJson("connections.json", { A: ra.after, B: rb.after }, "getStats of every connection (selected pair, data channels, RTP)");
        const [inA, inB] = await Promise.all([packetRateFrom(a.page, idb), packetRateFrom(b.page, ida)]);
        return {
          ok: inA >= 20 && inB >= 20,
          summary:
            `A receives ${inA} audio packets/s from B, B ${inB} from A (all inbound audio, the echo-cancellation loopback included: A ${ra.rates.inbound.audio?.kbps ?? 0} kbit/s, B ${rb.rates.inbound.audio?.kbps ?? 0} kbit/s); ` +
            `live connections A ${ra.after.live}, B ${rb.after.live}; pairs A ${describePairs(ra.after).join(", ")}`,
          data: { A: ra.rates, B: rb.rates }
        };
      });
      await closingChecks(evidence, [a, b]);
    }
  );
}

// ---------- T2.2 ----------

/** Diagnosis when the mute click is lost on Dialog, shown when A logged the producer error at entry */
const WISH_LOST =
  "; A logged 'Tried to toggle mic but there's no producer.' at entry: the microphone was asked on before Dialog's producer existed " +
  "(dialog-adapter.ts setMicEnabled returns false), so MediaSession.enableMicrophone returned before recording the wish (media-session.ts), " +
  "micWanted stayed false while the producer came up enabled, and toggleMicrophone() asked to turn it on again";

/** Diagnosis when the Voice button shows muted while the microphone is on and heard (seen on LiveKit) */
const STALE_BUTTON =
  " — the button disagrees with the microphone: it follows mic-state-changed events (useMicrophoneStatus.js), and on LiveKit the adapter " +
  "publishes a microphone of its own at connect and mutes it (livekit-adapter.ts _initializeLocalAudio, 'Start muted by default'), " +
  "after which the microphone ends up enabled by a path that sends no event (not traced further here); the first click then mutes a microphone the button already shows as muted";



/** Muted means at most this many audio packets a second arrive from A (an Opus encoder in DTX may still send a few) */
const MUTED_PACKETS_PER_SECOND = 5;

for (const server of SERVERS) {
  test(
    `T2.2 mute and unmute with the toolbar on ${blockTitle(server)}`,
    {
      annotation: [
        { type: "id", description: `t2.2-${blockId(server)}` },
        { type: "covers", description: covers(server, "B2 mute-fix") }
      ]
    },
    async ({ evidence }) => {
      runsOn(server);
      await evidence.recordWithObs();
      const [a, b] = await startPair(evidence, mainRoom(server));
      const ida = await idOf(a);
      await frameRateCheck(evidence, [a, b]);
      await connectedCheck(evidence, [a, b], server, "B2");

      // Whether A asked for its microphone on before Dialog's producer existed (see WISH_LOST)
      const wishLost = () => micWishLost(a);
      const state = async () => ({
        button: await input.micButtonState(a.page),
        micEnabled: (await readSession(a.page)).micEnabled,
        bHears: await heardPilot(b.page, ida, a.pilotHz, CONTROL_HZ, 3000)
      });

      await evidence.check("Before muting: button, isMicEnabled and what B hears agree", "B2", async () => {
        const s = await state();
        const stale = s.button === "muted" && s.micEnabled === true && heard(s.bHears);
        return {
          ok: s.button === "on" && s.micEnabled === true && heard(s.bHears),
          summary: `button ${s.button}, isMicEnabled ${s.micEnabled}, B ${pilotText(s.bHears)}${stale ? STALE_BUTTON : ""}`,
          data: s
        };
      });

      // Mute: one click on Voice, the pilot watched on B from just before the click
      await startPilotWatch(b.page, "mute", ida, a.pilotHz);
      await b.page.waitForTimeout(1500);
      const muteClickAt = Date.now();
      await input.clickMic(a.page);
      await a.page.waitForTimeout(2500);
      const mutedPackets = await packetRateFrom(b.page, ida);
      const muteWatch = await stopPilotWatch(b.page, "mute");
      const muted = await state();
      await evidence.screenshot(a, "muted");
      const clickAtMs = muteClickAt - muteWatch.startedAt;
      const lastHeardAfterClick = Math.max(-1, ...muteWatch.detections.filter(t => t >= clickAtMs).map(t => t - clickAtMs));
      evidence.saveJson("mute-watch.json", { clickAtMs, ...muteWatch }, "B's pilot watch of A around the mute click (ms from the watch start)");

      await evidence.check("Mute: pilot gone within 1 s, packets stop, button and isMicEnabled agree", "B2 mute-fix", async () => {
        const gone = lastHeardAfterClick <= 1000 && silent(muted.bHears);
        const ok = gone && mutedPackets <= MUTED_PACKETS_PER_SECOND && muted.button === "muted" && muted.micEnabled === false;
        return {
          ok,
          summary:
            `last pilot ${lastHeardAfterClick < 0 ? "before the click" : `${lastHeardAfterClick} ms after the click`}; ` +
            `B receives ${mutedPackets} audio packets/s; button ${muted.button}, isMicEnabled ${muted.micEnabled}, B ${pilotText(muted.bHears)}` +
            (muted.button === "on" && muted.micEnabled === true ? ` — the click was lost (known failure)${wishLost() ? WISH_LOST : ""}` : ""),
          data: { lastHeardAfterClickMs: lastHeardAfterClick, inboundAudioPacketsPerSecond: mutedPackets, muted }
        };
      });

      // The unmute check needs A muted; when the mute click was lost, a second click gets it there (noted)
      if (muted.micEnabled !== false) {
        await input.clickMic(a.page);
        await a.page.waitForTimeout(1500);
        evidence.note(`the mute click was lost; Voice clicked once more to mute before the unmute check: button ${await input.micButtonState(a.page)}, isMicEnabled ${(await readSession(a.page)).micEnabled}`);
      }

      await startPilotWatch(b.page, "unmute", ida, a.pilotHz);
      await b.page.waitForTimeout(1000);
      const unmuteClickAt = Date.now();
      await input.clickMic(a.page);
      await a.page.waitForTimeout(3000);
      const unmutedPackets = await packetRateFrom(b.page, ida);
      const unmuteWatch = await stopPilotWatch(b.page, "unmute");
      const unmuted = await state();
      const unClickAtMs = unmuteClickAt - unmuteWatch.startedAt;
      const firstHeard = unmuteWatch.detections.find(t => t >= unClickAtMs);
      evidence.saveJson("unmute-watch.json", { clickAtMs: unClickAtMs, ...unmuteWatch }, "B's pilot watch of A around the unmute click");

      await evidence.check("Unmute: pilot back, packets resume, button and isMicEnabled agree", "B2 mute-fix", async () => {
        const back = firstHeard !== undefined && heard(unmuted.bHears);
        const ok = back && unmutedPackets >= 20 && unmuted.button === "on" && unmuted.micEnabled === true;
        return {
          ok,
          summary:
            `pilot back ${firstHeard === undefined ? "never" : `${firstHeard - unClickAtMs} ms after the click`}; B receives ${unmutedPackets} audio packets/s; ` +
            `button ${unmuted.button}, isMicEnabled ${unmuted.micEnabled}, B ${pilotText(unmuted.bHears)}`,
          data: { pilotBackAfterMs: firstHeard === undefined ? null : firstHeard - unClickAtMs, inboundAudioPacketsPerSecond: unmutedPackets, unmuted }
        };
      });
      await closingChecks(evidence, [a, b]);
    }
  );
}

// ---------- T2.3 ----------

/**
 * Why a choice in Audio Settings can leave the microphone as it was: the client asks for the chosen device with
 * deviceId: { ideal: [id] } (src/utils/media-devices-manager.js, startMicShare), and Chromium-based browsers
 * rank the user's preferred (default) microphone above an ideal deviceId; with exact the chosen device opens.
 * Shown on this PC in Edge 157 and Chromium 159 (a getUserMedia call with each form); the same code is on develop.
 */
const NOT_SWITCHED =
  "; the device did not change: the client requests it with deviceId { ideal: [...] } (media-devices-manager.js startMicShare), " +
  "which Edge and Chromium answer with the default microphone (the cable here); { exact } would open the chosen one";

/** Of the microphones offered, the one to switch away from the cable to: a USB microphone if there is one */
function otherMicrophone(options: string[]): string | undefined {
  const real = options.filter(o => !o.includes("CABLE") && !/^(既定|通信|Default|Communications)\b/.test(o));
  return real.find(o => /USB/i.test(o)) ?? real[0];
}

async function deviceSwitchWithCable(evidence: Evidence, server: MediaServer, player: CablePlayer) {
  // A takes Windows' own devices (no fake device flags), so its microphone list is the PC's; B is a usual client
  const [a, b] = await startClients(evidence, [
    { identity: "cable", slot: "a", mic: false, cam: false, name: "A-cable" },
    { identity: "member1", account: "member1", slot: "b" }
  ]);
  const hub = room(mainRoom(server));
  evidence.note(`room ${hub.hubId}; A uses Windows' audio devices; the cable is fed ${player.slot}'s clip (pilot ${player.pilotHz} Hz) by a player window`);
  await enterAll(evidence, [a, b], hub.hubId);
  await connectedCheck(evidence, [a, b], server, "A1e");
  const ida = await idOf(a);

  const choices = await input.microphoneChoices(a.page);
  evidence.saveJson("microphones.json", choices, "the microphones A's Audio Settings offer, and the one selected at entry");
  const other = otherMicrophone(choices.options);
  if (!choices.selected?.includes("CABLE Output")) {
    const shown = await input.chooseMicrophone(a.page, CABLE_MICROPHONE);
    evidence.note(`A entered with "${choices.selected}"; switched to the cable first (shows "${shown}")`);
  }

  const listen = async () => {
    const [tracks, pilot, own] = await Promise.all([
      remoteTracks(b.page, ida),
      heardPilot(b.page, ida, player.pilotHz, CONTROL_HZ, 4000),
      a.page.evaluate(() => {
        const track = (window as any).APP?.sfu?.getLocalMicTrack?.();
        return { id: track?.id?.slice(0, 8) ?? null, state: track?.readyState ?? null, device: (window as any).APP?.mediaDevicesManager?.selectedMicLabel ?? null };
      })
    ]);
    return { tracks, pilot, own };
  };

  await evidence.check("On the cable: B has one audio track for A and hears the cable's pilot", "A1e", async () => {
    const s = await listen();
    return {
      ok: s.tracks.audio.length === 1 && heard(s.pilot),
      summary: `B holds ${s.tracks.audio.length} audio track(s) for A (${s.tracks.audio.join(", ")}); ${pilotText(s.pilot)}; A's device ${s.own.device}, published track ${s.own.id} ${s.own.state}`,
      data: s
    };
  });

  await evidence.check(`Switched to "${other ?? "(none)"}" in Audio Settings: one track, the cable's pilot gone`, "A1e", async () => {
    if (!other) return { ok: false, summary: `no microphone besides the cable is offered: ${choices.options.join(", ")}` };
    const shown = await input.chooseMicrophone(a.page, other);
    await a.page.waitForTimeout(1500);
    const s = await listen();
    await evidence.screenshot(a, "other-microphone");
    return {
      ok: !!shown?.includes(other) && s.tracks.audio.length === 1 && s.pilot.ratio <= PILOT_SILENT,
      summary:
        `Audio Settings shows "${shown}"; B holds ${s.tracks.audio.length} audio track(s) (${s.tracks.audio.join(", ")}); cable ${pilotText(s.pilot)}; A's device ${s.own.device}, published track ${s.own.id} ${s.own.state}` +
        (shown?.includes(other) ? "" : NOT_SWITCHED),
      data: { shown, ...s }
    };
  });

  await evidence.check("Back to the cable: one track, the cable's pilot heard again", "A1e", async () => {
    const shown = await input.chooseMicrophone(a.page, CABLE_MICROPHONE);
    await a.page.waitForTimeout(1500);
    const s = await listen();
    await evidence.screenshot(a, "cable-again");
    return {
      ok: !!shown?.includes("CABLE Output") && s.tracks.audio.length === 1 && heard(s.pilot),
      summary: `Audio Settings shows "${shown}"; B holds ${s.tracks.audio.length} audio track(s) (${s.tracks.audio.join(", ")}); ${pilotText(s.pilot)}; A's device ${s.own.device}, published track ${s.own.id} ${s.own.state}`,
      data: { shown, ...s }
    };
  });
  return [a, b];
}

/** Fallback when the cable cannot be fed from a script: switching between Chromium's fake input devices */
async function deviceSwitchWithFakeDevices(evidence: Evidence, server: MediaServer) {
  const [a, b] = await startPair(evidence, mainRoom(server));
  const ida = await idOf(a);
  await connectedCheck(evidence, [a, b], server, "A1e");
  const choices = await input.microphoneChoices(a.page);
  evidence.saveJson("microphones.json", choices, "the microphones A's Audio Settings offer (Chromium's fake devices)");
  for (const target of choices.options.filter(o => o !== choices.selected).slice(0, 2)) {
    await evidence.check(`Switched to "${target}": B has one audio track for A and hears it`, "A1e", async () => {
      const shown = await input.chooseMicrophone(a.page, target);
      await a.page.waitForTimeout(1500);
      const [tracks, pilot] = await Promise.all([remoteTracks(b.page, ida), heardPilot(b.page, ida, a.pilotHz, CONTROL_HZ, 4000)]);
      return {
        ok: !!shown?.includes(target) && tracks.audio.length === 1 && heard(pilot),
        summary: `Audio Settings shows "${shown}"; B holds ${tracks.audio.length} audio track(s); ${pilotText(pilot)} (every fake input plays A's clip, so this shows continuity, not which device)`,
        data: { shown, tracks, pilot }
      };
    });
  }
  return [a, b];
}

for (const server of SERVERS) {
  test(
    `T2.3 change the input device in audio settings on ${blockTitle(server)}`,
    { annotation: [{ type: "id", description: `t2.3-${blockId(server)}` }, { type: "covers", description: "A1e" }] },
    async ({ evidence }) => {
      runsOn(server);
      await evidence.recordWithObs();
      const player = await startCablePlayer("a").catch(e => {
        evidence.note(`cable player failed to start: ${(e as Error).message.split("\n")[0]}`);
        return null;
      });
      let clients;
      try {
        if (player?.selfTest.heard) {
          evidence.note(`cable self-test: the player's pilot comes out of "${CABLE_MICROPHONE}" (ratio ${player.selfTest.ratio})`);
          clients = await deviceSwitchWithCable(evidence, server, player);
        } else {
          evidence.note(
            `fallback: the cable could not be fed from a script (${player?.selfTest.error ?? `self-test ratio ${player?.selfTest.ratio ?? "-"}`}); switching between Chromium's fake input devices instead`
          );
          clients = await deviceSwitchWithFakeDevices(evidence, server);
        }
      } finally {
        await player?.stop();
      }
      await closingChecks(evidence, clients);
    }
  );
}
