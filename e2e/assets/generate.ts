// Generates the files the clients use, into e2e/assets/ (git ignores the outputs; rerun to recreate):
//   clips/<slot>.wav   10 s speech-like noise with a 250 ms pilot beep every second at the slot's frequency
//   clips/<slot>.y4m   2 s, 640 x 360, flat colour with the slot's letter and frequency
//   scenes/crater.glb  the Crater terrain from Spoke's test assets with what Spoke adds to a published
//                      scene (spawn points, sun, ambient light, sky, shadows); setup/create-fixtures.ts
//                      publishes it through the scene API
//   scenes/crater.jpg  its thumbnail (the terrain's colour texture)
//   scenes/nimpro.glb  the same terrain with the N-impro set (five seat waypoints and the question slide)
//   media/pages.pdf, media/questions.pdf   coloured pages with a title each
//   media/clock.mp4    60 s of the time in large digits with a 440 Hz tone
// Needs ffmpeg (winget's Gyan.FFmpeg is found even when it is not on PATH).
//   npx tsx assets/generate.ts [clips|media|scenes]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ASSETS_DIR, ASSETS_URL, CLIPS_DIR, COMPOSE_ROOT } from "../lib/env";
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

type GltfNode = Record<string, any>;
const hubs = (components: object) => ({ extensions: { MOZ_hubs_components: components } });

/**
 * The Crater terrain with what Spoke adds to a published scene, written to `target`; `group` adds a node
 * tree (its root first, children referring to indices within the group) under the scene.
 */
function buildScene(target: string, thumbnail: string, group?: GltfNode[], source = "Spoke test asset crater.glb, components added by e2e/assets/generate.ts") {
  const craterSource = path.join(COMPOSE_ROOT, "services", "spoke", "test", "fixtures", "test-assets", "crater.glb");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const { json, bin } = readGlb(craterSource);

  const terrain = 0;
  json.nodes[terrain] = { ...json.nodes[terrain], ...hubs({ shadow: { cast: false, receive: true } }) };
  const added: GltfNode[] = [
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
  if (group?.length) {
    const base = json.nodes.length;
    json.nodes.push(...group.map(n => (n.children ? { ...n, children: n.children.map((c: number) => base + c) } : n)));
    json.scenes[0].nodes.push(base);
  }
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), "MOZ_hubs_components"])];
  json.extensions = { ...json.extensions, MOZ_hubs_components: { version: 4 } };
  json.asset.extras = { source };
  writeGlb(target, json, bin);

  const image = json.images.find((i: any) => i.mimeType === "image/jpeg");
  const view = json.bufferViews[image.bufferView];
  fs.writeFileSync(thumbnail, bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
  console.log(`scene: ${path.relative(ASSETS_DIR, target)} (${added.length + (group?.length ?? 0)} nodes added) and its thumbnail`);
}

export const NIMPRO_SCENE_FILE = path.join(ASSETS_DIR, "scenes", "nimpro.glb");
export const NIMPRO_SCENE_THUMBNAIL = path.join(ASSETS_DIR, "scenes", "nimpro.jpg");
export const QUESTION_PDF = path.join(ASSETS_DIR, "media", "questions.pdf");
export const QUESTION_PDF_URL = `${ASSETS_URL}/media/questions.pdf`;
export const PAGES_PDF = path.join(ASSETS_DIR, "media", "pages.pdf");
export const PAGES_PDF_URL = `${ASSETS_URL}/media/pages.pdf`;
export const VIDEO_FILE = path.join(ASSETS_DIR, "media", "clock.mp4");
export const VIDEO_URL = `${ASSETS_URL}/media/clock.mp4`;
/** Where the N-impro question slide stands, and the seats around it */
export const NIMPRO_SEATS = 5;

/** A stable uuid-shaped id from a name, so the scene's networked ids stay the same when it is rebuilt */
function stableId(name: string): string {
  let h = 2166136261;
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    for (const ch of `${name}#${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    bytes.push(h & 0xff);
  }
  const hex = bytes.map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The N-impro set (what services/hubs/src/systems/nimpro-system.js looks for under #environment-root):
 * a node "N-impro" holding five occupiable, clickable waypoints "N-impro-seat-01" to "-05" on an arc
 * facing a "QuestionSlide" frame, and the question PDF as scene media at the frame (within 0.1 m, which is
 * how the system finds the slide's pager).
 */
function nimproGroup(): GltfNode[] {
  const nodes: GltfNode[] = [{ name: "N-impro", children: [] as number[] }];
  const slide = { x: 0, y: 1.7, z: -4 };
  for (let i = 1; i <= NIMPRO_SEATS; i++) {
    const angle = ((i - 3) / 4) * (Math.PI / 2); // -45 to 45 degrees
    const x = 3 * Math.sin(angle);
    const z = 3 * Math.cos(angle) - 1;
    // Facing the slide: turned about the vertical axis towards it
    const yaw = Math.atan2(-(slide.x - x), -(slide.z - z));
    nodes[0].children.push(nodes.length);
    nodes.push({
      name: `N-impro-seat-${String(i).padStart(2, "0")}`,
      translation: [x, 0.08, z],
      rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
      ...hubs({
        waypoint: {
          canBeSpawnPoint: false,
          canBeOccupied: true,
          canBeClicked: true,
          willDisableMotion: false,
          willDisableTeleporting: false,
          willMaintainInitialOrientation: false,
          snapToNavMesh: false
        },
        networked: { id: stableId(`N-impro-seat-${i}`) }
      })
    });
  }
  nodes[0].children.push(nodes.length);
  nodes.push({ name: "QuestionSlide", translation: [slide.x, slide.y, slide.z], children: [nodes.length + 1] });
  nodes.push({
    name: "QuestionSlidePdf",
    ...hubs({
      media: { src: QUESTION_PDF_URL, id: stableId("QuestionSlidePdf"), contentSubtype: null },
      networked: { id: stableId("QuestionSlidePdf-networked") }
    })
  });
  return nodes;
}

/** A small PDF with one page per entry: a coloured page with its title in large letters */
function writePdf(file: string, pages: { title: string; rgb: [number, number, number] }[]) {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1;
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("PLACEHOLDER");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const kids: number[] = [];
  for (const p of pages) {
    const stream = `${p.rgb.map(c => (c / 255).toFixed(3)).join(" ")} rg 0 0 720 405 re f 1 1 1 rg BT /F1 72 Tf 60 170 Td (${p.title.replace(/[()\\]/g, "")}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 720 405] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
}

function makeMedia(ffmpeg: string) {
  const colours: [number, number, number][] = [
    [200, 40, 40],
    [40, 160, 60],
    [40, 80, 200],
    [220, 150, 30],
    [130, 50, 160]
  ];
  writePdf(PAGES_PDF, colours.map((rgb, i) => ({ title: `Page ${i + 1}`, rgb })));
  writePdf(QUESTION_PDF, [{ title: "N-impro e2e", rgb: [60, 60, 60] }, ...colours.map((rgb, i) => ({ title: `Question ${i + 1}`, rgb }))]);
  console.log(`media: ${path.relative(ASSETS_DIR, PAGES_PDF)}, ${path.relative(ASSETS_DIR, QUESTION_PDF)}`);
  // A clock: 60 s, the time in large digits on yellow, with a 440 Hz tone, so two clients' copies can be compared
  const fontDir = process.platform === "win32" ? "C:\\Windows\\Fonts" : "/usr/share/fonts/truetype/dejavu";
  const font = process.platform === "win32" ? "arialbd.ttf" : "DejaVuSans-Bold.ttf";
  execFileSync(
    ffmpeg,
    [
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=yellow:s=640x360:r=30:d=60",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=60",
      "-vf", `drawtext=fontfile=${font}:text='%{pts\\:hms}':fontsize=96:fontcolor=black:x=(w-tw)/2:y=(h-th)/2`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart",
      VIDEO_FILE
    ],
    { cwd: fontDir }
  );
  console.log(`media: ${path.relative(ASSETS_DIR, VIDEO_FILE)}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("assets/generate.ts")) {
  const only = process.argv[2];
  if (!only || only === "clips") makeClips(ffmpegPath());
  if (!only || only === "media") makeMedia(ffmpegPath());
  if (!only || only === "scenes") {
    buildScene(SCENE_FILE, SCENE_THUMBNAIL);
    buildScene(NIMPRO_SCENE_FILE, NIMPRO_SCENE_THUMBNAIL, nimproGroup(), "Spoke test asset crater.glb with the N-impro set, made by e2e/assets/generate.ts");
  }
}
