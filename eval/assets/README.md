# eval/assets

## `chirp-loop.wav`

A 1-second silent mono 48 kHz PCM WAV. The eval speaker bot loops this file to
satisfy the hub's bot-mode requirement that an audio file be provided via
`-a/--audio`. The actual 1 kHz tone-burst chirps are mixed on top by the in-page
probe via Web Audio (`MediaStreamAudioDestinationNode`), not encoded in this file.

The WAV is regenerable and gitignored. Generate it once before your first
speaker-bot run:

```bash
node eval/assets/generate-chirp.js
```

This produces `eval/assets/chirp-loop.wav` (~94 KB). The probe's chirp injector
expects to wrap whatever MediaStream the bot produces, so the file content is
irrelevant past "must be valid audio that `<audio>.captureStream()` will play."

If you'd rather supply your own audio (e.g., a recorded lecture clip for
realism), pass that file with `-a` instead. The chirp injector will mix on top.
