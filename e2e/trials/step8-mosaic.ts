// Step 8 trial: the mosaic video of report/mosaic.ts on a finished test's client videos.
//   npx tsx trials/step8-mosaic.ts <test folder>
import fs from "node:fs";
import path from "node:path";
import { mosaicVideo } from "../report/mosaic";

const dir = process.argv[2];
const videos = fs.readdirSync(dir).filter(f => f.endsWith(".webm"));
const tiles = [...videos.map((f, i) => ({ label: f.replace(".webm", ""), file: path.join(dir, f), startedAt: 1000 * i })), { label: "BOT-H (no video)", startedAt: 0 }];
console.log(mosaicVideo(tiles, path.join(dir, "..", "mosaic-trial.mp4"), path.join(dir, "..", ".mosaic-trial")));
