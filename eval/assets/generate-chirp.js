#!/usr/bin/env node
// Generate a 1-second silent mono 48 kHz PCM WAV for the eval speaker bot.
// The chirp injector (in the probe) mixes the actual 1 kHz tone bursts on top
// of this carrier stream — the WAV itself is silent.
//
// The hub bot path requires SOME audio file to enable mic via
// `audioEl.captureStream()`. Looping a 1-second WAV is sufficient.
//
// Usage:
//   node eval/assets/generate-chirp.js
//   # produces eval/assets/chirp-loop.wav
const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 48000;
const DURATION_SEC = 1;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const numSamples = SAMPLE_RATE * DURATION_SEC;
const byteRate = (SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
const dataSize = numSamples * blockAlign;
const fileSize = 44 + dataSize;

const buf = Buffer.alloc(fileSize);
let o = 0;
buf.write("RIFF", o);
o += 4;
buf.writeUInt32LE(fileSize - 8, o);
o += 4;
buf.write("WAVE", o);
o += 4;
buf.write("fmt ", o);
o += 4;
buf.writeUInt32LE(16, o);
o += 4; // fmt chunk size
buf.writeUInt16LE(1, o);
o += 2; // PCM
buf.writeUInt16LE(NUM_CHANNELS, o);
o += 2;
buf.writeUInt32LE(SAMPLE_RATE, o);
o += 4;
buf.writeUInt32LE(byteRate, o);
o += 4;
buf.writeUInt16LE(blockAlign, o);
o += 2;
buf.writeUInt16LE(BITS_PER_SAMPLE, o);
o += 2;
buf.write("data", o);
o += 4;
buf.writeUInt32LE(dataSize, o);
o += 4;
// Remaining bytes are zero (silence) — Buffer.alloc already zeros them.

const out = path.join(__dirname, "chirp-loop.wav");
fs.writeFileSync(out, buf);
console.log("wrote " + out + " (" + fileSize + " bytes)");
