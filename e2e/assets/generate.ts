// Generates the files the clients use, into e2e/assets/ (git ignores the outputs; rerun to recreate):
//   clips/<slot>.wav   10 s speech-like noise with a 250 ms pilot beep every second at the slot's frequency
//   clips/<slot>.y4m   2 s, 640 x 360, flat colour with the slot's letter and frequency
//   scenes/crater.glb  the Crater terrain from Spoke's test assets with what Spoke adds to a published
//                      scene (spawn points, sun, ambient light, sky, shadows); setup/create-fixtures.ts
//                      publishes it through the scene API
//   scenes/crater.jpg  its thumbnail (the terrain's colour texture)
// Needs ffmpeg (winget's Gyan.FFmpeg is found even when it is not on PATH).
//   npx tsx assets/generate.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ASSETS_DIR, CLIPS_DIR, COMPOSE_ROOT } from "../lib/env";
import { ffmpegPath } from "../lib/stack";
import { MEDIA_SLOTS, PILOT, clipPath, type SlotName } from "./media";

export const SCENE_FILE = path.join(ASSETS_DIR, "scenes", "crater.glb");
export const SCENE_THUMBNAIL = path.join(ASSETS_DIR, "scenes", "crater.jpg");

function makeClips(ffmpeg: string) {
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
  // drawtext's font path is relative to the working directory, which avoids escaping a drive letter
  const fontDir = process.platform === "win32" ? "C:\\Windows\\Fonts" : "/usr/share/fonts/truetype/dejavu";
  const font = process.platform === "win32" ? "arialbd.ttf" : "DejaVuSans-Bold.ttf";
  const beepOn = PILOT.beepMs / 1000;
  for (const [slot, { pilotHz, colour }] of Object.entries(MEDIA_SLOTS)) {
    // Speech-like bed: band-limited pink noise chopped into syllables (4 Hz) and phrases (0.4 Hz),
    // because noise suppression and gain control flatten a steady tone. The pilot rides on top.
    execFileSync(ffmpeg, [
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i", `sine=frequency=${pilotHz}:sample_rate=48000:duration=${PILOT.clipSeconds}`,
      "-f", "lavfi", "-i", `anoisesrc=color=pink:sample_rate=48000:amplitude=0.12:duration=${PILOT.clipSeconds}`,
      "-filter_complex",
      `[0]volume='if(lt(mod(t,1),${beepOn}),0.5,0)':eval=frame[beep];` +
        "[1]highpass=f=250,lowpass=f=3400,tremolo=f=4:d=0.85,tremolo=f=0.4:d=0.6[speech];" +
        "[beep][speech]amix=inputs=2:normalize=0[out]",
      "-map", "[out]", "-ac", "1", "-c:a", "pcm_s16le", clipPath(slot as SlotName, "wav")
    ]);
    const label = `${slot.toUpperCase()}  ${pilotHz} Hz`;
    execFileSync(
      ffmpeg,
      [
        "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", `color=c=${colour}:s=640x360:r=15:d=2`,
        "-vf", `drawtext=fontfile=${font}:text='${label}':fontsize=64:fontcolor=white:x=(w-tw)/2:y=(h-th)/2`,
        "-pix_fmt", "yuv420p", clipPath(slot as SlotName, "y4m")
      ],
      { cwd: fontDir }
    );
    console.log(`clip ${slot}: ${pilotHz} Hz, ${colour}`);
  }
}

/** Reads a binary glTF into its JSON and binary chunks */
function readGlb(file: string): { json: any; bin: Buffer } {
  const data = fs.readFileSync(file);
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a binary glTF`);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8"));
  const binStart = 20 + jsonLength;
  const bin = data.subarray(binStart + 8, binStart + 8 + data.readUInt32LE(binStart));
  return { json, bin };
}

function writeGlb(file: string, json: any, bin: Buffer) {
  const pad = (buf: Buffer, fill: number) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binChunk = pad(bin, 0);
  const chunkHeader = (length: number, type: number) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(length, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  fs.writeFileSync(
    file,
    Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(binChunk.length, 0x004e4942), binChunk])
  );
}

/** A turn about the vertical axis followed by a downward pitch, as a glTF quaternion */
function yawPitch(yawDeg: number, pitchDeg: number): number[] {
  const [y, p] = [(yawDeg * Math.PI) / 360, (pitchDeg * Math.PI) / 360];
  // qYaw * qPitch, the pitch about the local X axis
  return [Math.cos(y) * Math.sin(p), Math.sin(y) * Math.cos(p), -Math.sin(y) * Math.sin(p), Math.cos(y) * Math.cos(p)];
}

function buildScene() {
  const source = path.join(COMPOSE_ROOT, "services", "spoke", "test", "fixtures", "test-assets", "crater.glb");
  fs.mkdirSync(path.dirname(SCENE_FILE), { recursive: true });
  const { json, bin } = readGlb(source);
  const hubs = (components: object) => ({ extensions: { MOZ_hubs_components: components } });

  const terrain = 0;
  json.nodes[terrain] = { ...json.nodes[terrain], ...hubs({ shadow: { cast: false, receive: true } }) };
  const added: any[] = [
    {
      name: "Sun",
      rotation: yawPitch(30, 55),
      ...hubs({
        "directional-light": { color: "#fff6e0", intensity: 1.6, castShadow: true, shadowMapResolution: [2048, 2048], shadowBias: -0.0005, shadowRadius: 1 }
      })
    },
    { name: "Ambient", ...hubs({ "hemisphere-light": { skyColor: "#cfe4ff", groundColor: "#8a7a66", intensity: 0.7 } }) },
    {
      name: "Sky",
      ...hubs({
        skybox: { turbidity: 10, rayleigh: 2, luminance: 1, mieCoefficient: 0.005, mieDirectionalG: 0.8, inclination: 0.3, azimuth: 0.25, distance: 8000 }
      })
    }
  ];
  // Spawn points on a 2.5 m ring on the crater's flat floor (y 0.08 within 15 m of the centre), facing the centre
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * 2 * Math.PI;
    added.push({
      name: `Spawn Point ${i + 1}`,
      translation: [2.5 * Math.sin(angle), 0.08, 2.5 * Math.cos(angle)],
      rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
      ...hubs({ "spawn-point": {} })
    });
  }
  const first = json.nodes.length;
  json.nodes.push(...added);
  json.scenes[0].nodes.push(...added.map((_, i) => first + i));
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), "MOZ_hubs_components"])];
  json.extensions = { ...json.extensions, MOZ_hubs_components: { version: 4 } };
  json.asset.extras = { source: "Spoke test asset crater.glb, components added by e2e/assets/generate.ts" };
  writeGlb(SCENE_FILE, json, bin);

  const image = json.images.find((i: any) => i.mimeType === "image/jpeg");
  const view = json.bufferViews[image.bufferView];
  fs.writeFileSync(SCENE_THUMBNAIL, bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
  console.log(`scene: ${path.relative(ASSETS_DIR, SCENE_FILE)} (${added.length} nodes added) and its thumbnail`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("assets/generate.ts")) {
  makeClips(ffmpegPath());
  buildScene();
}
