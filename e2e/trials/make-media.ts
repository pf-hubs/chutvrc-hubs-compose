// Trial helper: generates the fake microphone (WAV) and camera (Y4M) files the trial clients
// use, into evidence/trials/media/ (git-ignored; rerun this to recreate them).
// Each client gets a speech-like noise bed with a 250 ms pilot beep every second at its own
// frequency, and a flat colour with its name.
//   npx tsx trials/make-media.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { MEDIA, ffmpegPath, CLIENT_MEDIA } from "./common";

fs.mkdirSync(MEDIA, { recursive: true });
const ffmpeg = ffmpegPath();
// drawtext's font path is relative to the working directory, which avoids escaping a drive letter
const fontDir = process.platform === "win32" ? "C:\\Windows\\Fonts" : "/usr/share/fonts/truetype/dejavu";
const fontFile = process.platform === "win32" ? "arial.ttf" : "DejaVuSans.ttf";

for (const [name, { pilotHz, colour }] of Object.entries(CLIENT_MEDIA)) {
  const wav = path.join(MEDIA, `${name}.wav`);
  const y4m = path.join(MEDIA, `${name}.y4m`);
  execFileSync(ffmpeg, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `sine=frequency=${pilotHz}:sample_rate=48000:duration=10`,
    "-f", "lavfi", "-i", "anoisesrc=color=pink:sample_rate=48000:amplitude=0.08:duration=10",
    "-filter_complex",
    "[0]volume='if(lt(mod(t,1),0.25),0.5,0)':eval=frame[b];[1]tremolo=f=3:d=0.9,lowpass=f=3000[n];[b][n]amix=inputs=2:normalize=0[a]",
    "-map", "[a]", "-ac", "1", "-c:a", "pcm_s16le", wav
  ]);
  execFileSync(
    ffmpeg,
    [
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=${colour}:s=640x360:r=15:d=2`,
      "-vf", `drawtext=fontfile=${fontFile}:text=${name}:fontsize=72:fontcolor=white:x=(w-tw)/2:y=(h-th)/2`,
      "-pix_fmt", "yuv420p", y4m
    ],
    { cwd: fontDir }
  );
  console.log(name, pilotHz, "Hz", colour, fs.statSync(wav).size, fs.statSync(y4m).size);
}
