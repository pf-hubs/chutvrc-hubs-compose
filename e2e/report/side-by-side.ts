// Videos and pictures made from time-stamped frames (T5): two observers' frames side by side on one time
// grid, so both panes show the same moment; videos joined into one; a contact sheet laid out as HTML and
// rendered to PNG by a headless browser. ffmpeg runs in a work folder that holds a copy of the font and the
// text it draws, so no path or text needs escaping inside the filter graph.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { ffmpegPath } from "../lib/stack";
import { frameAt, type CastFrame } from "./screencast";

export type Crop = { x: number; y: number; w: number; h: number };

const FONT = process.platform === "win32" ? "C:\\Windows\\Fonts\\arialbd.ttf" : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

function prepareWorkDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const font = path.join(dir, "font.ttf");
  if (!fs.existsSync(font)) fs.copyFileSync(FONT, font);
}

const forward = (file: string) => file.replace(/\\/g, "/");

/** An ffconcat list showing `files[k]` at grid step k, repeated frames merged into one longer entry */
function concatList(files: string[], fps: number): string {
  const lines = ["ffconcat version 1.0"];
  let i = 0;
  while (i < files.length) {
    let j = i;
    while (j + 1 < files.length && files[j + 1] === files[i]) j++;
    lines.push(`file '${forward(files[i])}'`, `duration ${((j - i + 1) / fps).toFixed(5)}`);
    i = j + 1;
  }
  // The demuxer drops the last entry's duration unless the file is listed once more
  lines.push(`file '${forward(files[files.length - 1])}'`);
  return lines.join("\n") + "\n";
}

export type Pane = { frames: CastFrame[]; label: string };

/**
 * Two panes side by side, each cropped, from PC time `from` to `to` on a grid of `fps`: at every step each
 * pane shows its last frame produced by then. A title bar above, the pane labels and the time inside.
 */
export function sideBySideVideo(opts: { panes: [Pane, Pane]; from: number; to: number; crop: Crop; title: string; out: string; workDir: string; fps?: number }) {
  const fps = opts.fps ?? 30;
  prepareWorkDir(opts.workDir);
  const steps = Math.max(1, Math.floor(((opts.to - opts.from) / 1000) * fps));
  const stem = path.basename(opts.out).replace(/\.[^.]+$/, "");
  const lists = opts.panes.map((pane, i) => {
    const files: string[] = [];
    for (let k = 0; k < steps; k++) {
      const frame = frameAt(pane.frames, opts.from + (k * 1000) / fps);
      if (frame) files.push(frame.file);
    }
    if (!files.length) throw new Error(`pane ${pane.label} has no frames`);
    const list = path.join(opts.workDir, `${stem}-pane${i}.ffconcat`);
    fs.writeFileSync(list, concatList(files, fps));
    fs.writeFileSync(path.join(opts.workDir, `${stem}-label${i}.txt`), pane.label);
    return list;
  });
  fs.writeFileSync(path.join(opts.workDir, `${stem}-title.txt`), opts.title);
  const { x, y, w, h } = opts.crop;
  const label = (i: number) =>
    `[${i}:v]crop=${w}:${h}:${x}:${y},setsar=1,drawtext=fontfile=font.ttf:textfile=${stem}-label${i}.txt:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8:x=12:y=12[p${i}]`;
  const filter = [
    label(0),
    label(1),
    `[p0][p1]hstack=inputs=2,pad=iw:ih+52:0:52:color=0x1d2330,` +
      `drawtext=fontfile=font.ttf:textfile=${stem}-title.txt:fontsize=24:fontcolor=white:x=14:y=14,` +
      `drawtext=fontfile=font.ttf:text='%{pts\\:hms}':fontsize=22:fontcolor=white:x=w-tw-14:y=15[v]`
  ].join(";");
  execFileSync(
    ffmpegPath(),
    [
      "-y", "-loglevel", "error",
      "-f", "concat", "-safe", "0", "-i", lists[0],
      "-f", "concat", "-safe", "0", "-i", lists[1],
      "-filter_complex", filter,
      "-map", "[v]", "-fps_mode", "cfr", "-r", String(fps),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      path.resolve(opts.out)
    ],
    { cwd: opts.workDir, stdio: ["ignore", "ignore", "pipe"] }
  );
  return { steps, seconds: steps / fps };
}

/** Joins videos made with the same settings into one, without encoding again */
export function joinVideos(files: string[], out: string, workDir: string) {
  prepareWorkDir(workDir);
  const list = path.join(workDir, `${path.basename(out).replace(/\.[^.]+$/, "")}.join.ffconcat`);
  fs.writeFileSync(list, ["ffconcat version 1.0", ...files.map(f => `file '${forward(path.resolve(f))}'`)].join("\n") + "\n");
  execFileSync(ffmpegPath(), ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", path.resolve(out)], {
    cwd: workDir,
    stdio: ["ignore", "ignore", "pipe"]
  });
}

/** Renders an HTML file to a PNG of its whole length in headless Chromium */
export async function renderHtmlToPng(htmlFile: string, pngFile: string, width = 1500) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`file:///${forward(path.resolve(htmlFile))}`, { waitUntil: "load" });
    await page.screenshot({ path: pngFile, fullPage: true });
  } finally {
    await browser.close();
  }
}
