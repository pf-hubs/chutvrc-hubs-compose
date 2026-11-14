// Video with sound (plan 3.3): OBS records the desktop and system audio, started and stopped per test
// over its WebSocket (OBS_WS_URL, OBS_WS_PASSWORD in e2e/.env.local). Everything here degrades to a
// reason string when OBS is not running or not reachable; a test never fails because of OBS.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import OBSWebSocket from "obs-websocket-js";
import { loadLocalEnv, sleep } from "../lib/env";
import { ffmpegPath } from "../lib/stack";

export type ObsRecording = {
  /** What looked wrong when the recording started (e.g. the scene renders black) */
  warnings: string[];
  /** Stops the recording and moves the file to `target`; returns the reason when that did not work */
  stop(target: string): Promise<{ file: string; notes: string[] } | { problem: string }>;
};

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms`)), ms))]);
}

/** Starts an OBS recording; returns the reason instead when OBS cannot be used */
export async function startObsRecording(): Promise<ObsRecording | { problem: string }> {
  loadLocalEnv();
  const url = process.env.OBS_WS_URL;
  if (!url) return { problem: "OBS_WS_URL is not set in e2e/.env.local" };
  const obs = new OBSWebSocket();
  const warnings: string[] = [];
  try {
    await withTimeout(obs.connect(url, process.env.OBS_WS_PASSWORD || undefined), 5000, "OBS connect");
    const status = await obs.call("GetRecordStatus");
    if (status.outputActive) {
      await obs.disconnect();
      return { problem: "OBS was already recording; left alone" };
    }
    // A black frame compresses to almost nothing: then the scene's capture source captures nothing
    const { currentProgramSceneName } = await obs.call("GetCurrentProgramScene");
    const shot = await obs.call("GetSourceScreenshot", { sourceName: currentProgramSceneName, imageFormat: "png", imageWidth: 320 });
    if (shot.imageData.length < 2000) {
      warnings.push(`OBS's scene "${currentProgramSceneName}" renders black: its screen capture source captures nothing, so the OBS video will be black (check the source in OBS)`);
    }
    await obs.call("StartRecord");
  } catch (e) {
    await obs.disconnect().catch(() => {});
    return { problem: `OBS not reachable: ${(e as Error).message}` };
  }

  return {
    warnings,
    async stop(target) {
      try {
        const { outputPath } = await withTimeout(obs.call("StopRecord"), 15000, "OBS StopRecord");
        await obs.disconnect().catch(() => {});
        await waitUntilWritten(outputPath);
        const file = `${target}${outputPath.slice(outputPath.lastIndexOf("."))}`;
        const notes = [await moveFile(outputPath, file)].filter((n): n is string => !!n);
        return { file, notes: [...notes, audioLevel(file)] };
      } catch (e) {
        await obs.disconnect().catch(() => {});
        return { problem: `OBS recording not saved: ${(e as Error).message}` };
      }
    }
  };
}

/**
 * Moves the recording into the evidence folder. OBS keeps the file open for a moment after it stops,
 * so a move is retried for a few seconds; on another drive, or if OBS still holds it, it is copied and
 * the original left where OBS put it (returned as a note).
 */
async function moveFile(from: string, to: string): Promise<string | null> {
  for (let i = 0; i < 40; i++) {
    try {
      fs.renameSync(from, to);
      return null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EXDEV") break;
      await sleep(250);
    }
  }
  fs.copyFileSync(from, to);
  try {
    fs.unlinkSync(from);
    return null;
  } catch {
    return `OBS recording copied; the original stays at ${from}`;
  }
}

/** OBS finishes writing the file shortly after StopRecord answers */
async function waitUntilWritten(file: string) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const size = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (size > 0 && size === last) return;
    last = size;
    await sleep(250);
  }
}

/** The loudest moment of the recording's sound, from ffmpeg (audio only, so it is quick) */
function audioLevel(file: string): string {
  // ffmpeg prints its statistics on standard error
  const run = spawnSync(ffmpegPath(), ["-hide_banner", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  return describeLevel(`${run.stderr ?? ""}${run.error?.message ?? ""}`);
}

function describeLevel(ffmpegOutput: string): string {
  const max = ffmpegOutput.match(/max_volume: (-?[\d.]+) dB/)?.[1];
  if (max === undefined) return "OBS sound level unknown (ffmpeg found no audio)";
  return Number(max) < -80
    ? `OBS sound is silent (loudest ${max} dB): the desktop audio source heard nothing`
    : `OBS sound: loudest ${max} dB`;
}
