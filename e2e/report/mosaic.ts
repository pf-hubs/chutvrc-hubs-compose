// A mosaic video of every client of a test (plan 3.3, "every device of a mixed room"): each client's own
// video (Playwright's recording of its window, or of the page in the container) in one tile, scaled to fit,
// labelled, shifted by when that client started so the tiles show the same moment, on a grid of up to
// three columns. Clients without a video (headless bots) get a labelled empty tile. No sound.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ffmpegPath } from "../lib/stack";

export type Tile = { label: string; file?: string; startedAt: number };

const FONT = process.platform === "win32" ? "C:\\Windows\\Fonts\\arialbd.ttf" : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

function ffprobeDuration(file: string): number {
  const probe = ffmpegPath().replace(/ffmpeg(\.exe)?$/i, m => m.replace("ffmpeg", "ffprobe"));
  try {
    const out = execFileSync(probe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" }).trim();
    const d = Number(out);
    if (Number.isFinite(d) && d > 0) return d;
  } catch {
    // Playwright's webm files carry no duration in their header; counted below instead
  }
  try {
    const out = execFileSync(probe, ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets,r_frame_rate", "-of", "csv=p=0", file], { encoding: "utf8" }).trim();
    const [rate, packets] = out.split(",");
    const [n, d] = rate.split("/").map(Number);
    return Number(packets) / (n / (d || 1));
  } catch {
    return 0;
  }
}

/**
 * Writes the mosaic to `out` (H.264 MP4, `fps` frames a second, tiles of `tileW` x `tileH`); returns its
 * length in seconds and the layout. Runs ffmpeg in `workDir`, which holds a copy of the font and the labels.
 */
export function mosaicVideo(tiles: Tile[], out: string, workDir: string, opts: { tileW?: number; tileH?: number; fps?: number; title?: string } = {}) {
  const { tileW = 480, tileH = 300, fps = 10 } = opts;
  fs.mkdirSync(workDir, { recursive: true });
  if (!fs.existsSync(path.join(workDir, "font.ttf"))) fs.copyFileSync(FONT, path.join(workDir, "font.ttf"));
  const t0 = Math.min(...tiles.map(t => t.startedAt));
  const withVideo = tiles.filter(t => t.file && fs.existsSync(t.file));
  const total = Math.max(1, ...withVideo.map(t => (t.startedAt - t0) / 1000 + ffprobeDuration(t.file!)));
  const cols = Math.min(3, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const inputs: string[] = [];
  const filters: string[] = [];
  let input = 0;
  tiles.forEach((t, i) => {
    fs.writeFileSync(path.join(workDir, `label${i}.txt`), t.label);
    const label = `drawtext=fontfile=font.ttf:textfile=label${i}.txt:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6:x=8:y=8`;
    if (t.file && fs.existsSync(t.file)) {
      inputs.push("-i", path.resolve(t.file));
      const delay = Math.max(0, (t.startedAt - t0) / 1000);
      filters.push(
        `[${input}:v]setpts=PTS-STARTPTS,fps=${fps},scale=${tileW}:${tileH}:force_original_aspect_ratio=decrease,pad=${tileW}:${tileH}:(ow-iw)/2:(oh-ih)/2:color=0x1d2330,` +
          `tpad=start_duration=${delay.toFixed(2)}:start_mode=add:color=0x1d2330:stop_mode=clone:stop=-1,trim=duration=${total.toFixed(2)},${label}[t${i}]`
      );
      input++;
    } else {
      fs.writeFileSync(path.join(workDir, `empty${i}.txt`), "no video (headless)");
      filters.push(
        `color=c=0x1d2330:s=${tileW}x${tileH}:r=${fps}:d=${total.toFixed(2)},${label},drawtext=fontfile=font.ttf:textfile=empty${i}.txt:fontsize=18:fontcolor=0x9aa3b2:x=(w-tw)/2:y=(h-th)/2[t${i}]`
      );
    }
  });
  // Fill the last row so xstack gets a full grid
  for (let i = tiles.length; i < rows * cols; i++) filters.push(`color=c=0x12151b:s=${tileW}x${tileH}:r=${fps}:d=${total.toFixed(2)}[t${i}]`);
  const layout = Array.from({ length: rows * cols }, (_, i) => `${(i % cols) * tileW}_${Math.floor(i / cols) * tileH}`).join("|");
  filters.push(`${Array.from({ length: rows * cols }, (_, i) => `[t${i}]`).join("")}xstack=inputs=${rows * cols}:layout=${layout}:fill=0x12151b,drawtext=fontfile=font.ttf:text='%{pts\\:hms}':fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6:x=w-tw-10:y=h-th-10[v]`);
  const script = path.join(workDir, "mosaic.filter");
  fs.writeFileSync(script, filters.join(";\n"));
  execFileSync(
    ffmpegPath(),
    ["-y", "-loglevel", "error", ...inputs, "-/filter_complex", "mosaic.filter", "-map", "[v]", "-r", String(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.resolve(out)],
    { cwd: workDir, stdio: ["ignore", "ignore", "pipe"], timeout: 30 * 60_000 }
  );
  return { seconds: +total.toFixed(1), cols, rows, tiles: tiles.map(t => ({ label: t.label, video: !!(t.file && fs.existsSync(t.file)), offsetS: +((t.startedAt - t0) / 1000).toFixed(2) })) };
}
