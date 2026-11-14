# Step 2 trials

What the trials of plan step 2 found on this PC, with numbers, and what the harness has to do because of it. The scripts are in `trials/` (TypeScript, `npx tsx trials/<name>.ts`); their JSON results and screenshots go to `evidence/trials/`, which git ignores.

Set-up when the trials ran:

| | |
| --- | --- |
| PC | Ryzen 5 3600 (6 cores), 48 GB, Radeon RX 6800, one 1920 x 1080 display at 60 Hz, Windows 11 |
| Stack | compose and hubs `feature/client-tests`, reticulum and spoke `feature/upstream-merge-2026-11`, dialog `develop`; `.env` with `PRIVATE_NETWORK_IP` only |
| Browsers | Edge 157.0.4341.46; Playwright 1.65.1 with Chromium 159.0.8154.6 and WebKit 27.2 |
| Rooms | created anonymously through `POST /api/v1/hubs`, no scene (the empty default environment); ids in `fixtures.json` under `trials` |
| Media | `trials/make-media.ts`: per client a 10 s WAV (pink noise with a 250 ms pilot beep every second at the client's own frequency) and a 2 s 640 x 360 Y4M (flat colour with the client's name) |

## Summary

| Trial | Result | Fallback |
| --- | --- | --- |
| T0.1 gate | fails at lint: 54 errors in hubs, 2 in admin. Run on their own, unit tests (1 test), type check, client build and `lint:html` pass; the admin build failed once (ENOENT on an emitted image) and passed on the second run | — |
| (a) DESK frame rate | 60 fps (the display's rate) in every window with 1, 2, 4 and 6 visible Edge windows, and in Edge headless | — |
| (b) QUEST | works once IWER is given the browser's own `requestAnimationFrame`: VR entry, `isPresenting`, own pose and the observer's copy follow the emulated headset and controllers, `isVR` arrives | plan 2.3 fallback dropped |
| (c) IOS | Playwright's Windows WebKit has no Web Audio, `getUserMedia` or WebRTC: the room page fails before Join Room. Linux WebKit inside the `netclient` container enters, publishes a microphone and connects to Dialog | IOS runs as Linux WebKit in a container (software rendering, about 21 fps) |
| (d) local LiveKit | two DESK clients connect (`sfuId` 2), hear each other's pilot, see each other move | — |
| (e) OLD | the old build loads with `--host-resolver-rules`; it has no `APP.avatarPoses` and sends `#avatar-RIG`; the new client sees it move | one-after-another procedure dropped |
| (f) poor network | enters, audio and pose cross both ways; `tc netem` raises the round trip from 4 to 219 ms and drops packets | — |
| (g) avatar URL | `https://hubs.local:3001/avatars/<file>` (the `assets` service, after a change), a public URL through the CORS proxy, and an upload to reticulum all load a full body ("mapped from vrm") on both clients; `http://assets/...` does not | — |
| D probes | `APP.sfu.getMediaStream` + an analyser detects the pilot; `bus.startRecording()/takeRecording()` returns `#avatar-pose` entries, sent and received | — |

## T0.1 gate

`docker compose exec hubs-client sh -c "npm run lint && npm run test:unit && npm run build"` stops at lint:

```
✖ 54 problems (54 errors, 0 warnings)
```

50 `no-unused-vars` (`avatar-audio-source.js`, `cross-room-streamer-audio-source.js`, `hand-poses.js`, `network-schemas.js`, `Banner.js`, `HomePage.js`, `Footer.js`, `Header.js`, `MobileNav.js`, `NimproMenu.js`, `PublicSpeakingMenu.js`, `ui-root.js`, `nimpro-system.js`, `webpack.config.js`), 2 `@calm/react-intl/missing-formatted-message` (`HomePage.js:82` "Sponsored by:", `ChutvrcPopovers.js:39` "Chutvrc"), 1 `no-dupe-keys` (`webpack.config.js:605` duplicate `optimization`), 1 `prettier/prettier` (`hub-channel.js:538`). `lint:html` did not run in that chain (it passes on its own, below).

`docker compose exec hubs-admin sh -c "npm run lint && npm run build"` stops at lint: 2 `no-unused-vars` in `admin/webpack.config.js` (`host`, `internalHostname`).

The other parts were run on their own to see past lint:

| Command | Result |
| --- | --- |
| hubs-client `npm run test:unit` | passes: 1 test (`getSanitizedComponentMapping`) |
| hubs-client `npm run build` (`tsc`, then webpack production) | passes: `tsc` clean; "compiled with 3 warnings" (top-level await in `pdfjs-dist/build/pdf.mjs`, asset size, entrypoint size); no "export ... was not found" |
| hubs-client `npm run lint:html` | passes: 11 files, no errors |
| hubs-admin `npm run build` | first run failed: `ENOENT: no such file or directory, open '/code/admin/dist/assets/images/hubs_logo-c7034b4c8e8a4500b947..png'`; the second run "compiled with 2 warnings" (asset and entrypoint size). Probably a race with `rimraf ./dist` or the running dev server's cache; note the doubled dot in the file name, which the dev build's `DefaultAvatar-...dd1..glb` has too |

The development server compiles with one warning (`pdfjs-dist/build/pdf.mjs` uses top-level await); no "export was not found". Whether these lint errors are new is for the baseline run against `develop` (step 5).

## Entering a room (selectors)

All English text; see "Launch" below for the locale.

| Step | Selector | Notes |
| --- | --- | --- |
| open | `https://hubs.local:4000/<hub id>`, `waitUntil: "domcontentloaded"` | 5 to 6 s with one client |
| lobby | `getByRole("button", { name: "Join Room" })` visible | about 4 s after load; also "Enter On Device", "Spectate" |
| profile | `getByLabel("Display Name")`, then `getByRole("button", { name: "Accept" })` | only until the profile has been accepted once (`store.state.activity`); a reused profile goes straight to the microphone step |
| microphone | `getByRole("button", { name: "Enter Room" })`, enabled once the microphone is granted | heading "Microphone Setup" |
| entered | `AFRAME.scenes[0].is("entered")` | 8.5 to 11 s from `goto` for one client; 6 clients together 24 s |
| after entry | `getByRole("button", { name: "Skip tour" })` closes the "Welcome to hubs.local" tour | it covers the lower middle of the window but does not take keys |
| QUEST | same steps; after Enter Room the client requests the immersive session itself ("Forced entry type: vr") and shows "Entered fullscreen mode" | 3 s from Enter Room to `isPresenting` |

`trials/common.ts` `enterRoom()` implements this.

## (a) DESK frame rate

`trials/a-desk-fps.ts`: N Edge windows, each its own process and profile at 1280 x 720 with the plan 2.2 flags and its own fake media, enter one Dialog room together; after 5 s every window measures `requestAnimationFrame` and renderer frames over 3 s, twice.

| Windows | rAF per window (fps) | Renderer frames | Slowest entry |
| --- | --- | --- | --- |
| 1 | 60.1 | 60.1 | 8.5 s |
| 2 | 60.1, 60.1 | same | 9.8 s |
| 4 | 60.2 to 60.3 | same | 17.6 s |
| 6 | 59.1 to 60.6 (second pass 60.3 to 60.6) | same | 23.8 s |
| 6, Edge headless | 60.3 | same | 19.4 s |
| 1 and 2, Playwright Chromium (headed) | 60.1 to 60.3 | same | 9.3 s |

- Every Edge mode runs on the GPU: headed, `headless: true` (Edge's new headless) and headless with `--enable-gpu --use-angle=d3d11` all report `ANGLE (AMD, AMD Radeon RX 6800 ... Direct3D11)` (`trials/gpu-check.ts`). Playwright's own Chromium renders on the GPU headed but on SwiftShader headless.
- The rate is capped by the 60 Hz display, so the plan's 55 fps validity floor holds with margin here; 60 Hz is the ceiling, not a measure of headroom.
- Caveat: the rooms had no scene. The rate with a real scene (the N-impro scene or a Behavior Graph example) is still to be measured once those rooms exist (step 3).
- All windows connect to Dialog (`sfuId` 0, `isConnected`).

## (b) QUEST

`trials/b-quest.ts`: Edge with the Quest 3 user agent (also set as the context's `userAgent`), IWER injected by `addInitScript` before the page's scripts, and a DESK observer in the same room.

Two things the harness has to do:

1. `installRuntime({ forceInstall: true })`. Edge has its own `navigator.xr`, and IWER 2.8 then only warns ("a native WebXR runtime is already available") and installs nothing.
2. Give IWER the browser's own `requestAnimationFrame`. On "enter-vr" in a mobile headset the client's PDF fix (`src/systems/media-pdf-oculus-fix.js`, from the upstream intake) replaces `window.requestAnimationFrame` with the XR session's. IWER schedules its device frames on `window.requestAnimationFrame`, so its next frame waits on the session it drives: "RangeError: Maximum call stack size exceeded" three times, both `requestAnimationFrame` loops stop, and the pose freezes. The trial loads IWER's source with `globalThis.requestAnimationFrame(` and `globalThis.cancelAnimationFrame(` replaced by functions captured before the page runs (`--unpatched` shows the failure). The page keeps its patch. A real Quest Browser does not hit this; it is an emulation issue only.

With both:

| Check | Result |
| --- | --- |
| `AFRAME.utils.device.isMobileVR()` | true |
| `navigator.xr.isSessionSupported("immersive-vr")` | true |
| after Enter Room | `vr-mode`, `renderer.xr.isPresenting` true, Dialog connected |
| own pose before moving | head (−0.032, 1.6, 0), hands (∓0.275, 1.47, −0.28), `isVR` true, `tracked` 7 |
| headset to (0.1, 1.3, −0.2) turned 45°, controllers to (−0.4, 1.2, −0.5) and (0.4, 1.5, −0.5) | own pose head (0.078, 1.3, −0.178), yaw 0.785 rad, hands (−0.425, 1.17, −0.38) and (0.425, 1.47, −0.38) within 1.5 s |
| observer's copy | the same values (yaw 0.787), `isVR` true |
| left controller `connected = false` | own `tracked` 5 |
| frame rates while presenting | window rAF 60.2, XR session rAF 60.1 (renderer frames count twice) |

Open point for T4.8: every `#avatar-pose` packet the headset sent had `tracked` 1 (head only), while its own pose read between frames had 7 (5 after the disconnect), so the observer's copy always had `tracked` 1. Either the sender samples the controllers before they are shown in the frame, or IWER's controllers become visible later in the frame than a real headset's; T4.8 has to tell which. Settled in step 6, below: an emulation artifact.

### Step 6: the window's frame callbacks while in VR

T4.8 (step 6) wrapped the own pose sampler and the pose sender and found the scene ticking twice per frame while presenting: once inside the XR frame (three.js's XR loop) and once about 1 ms later outside it (the renderer's window loop), 122 renderer frames a second at 60 Hz (`trials/step6-quest-ticks.ts`). The controllers were hidden at the first tick and shown at the second, so the own pose alternated `tracked` 1 and 7, and the sender, whose 22 ms gate opens on the first tick, sent 1 every time. After leaving VR (by `scene.exitVR()` or by ending the session from the device) the scene drew nothing more: 0 frames a second, no samples, no packets.

Cause: on `enter-vr` the client's PDF fix replaces `window.requestAnimationFrame` and `window.cancelAnimationFrame` with the XR session's. A-Frame emits `enter-vr` right after calling three.js's `setSession`, which finishes asynchronously, so when three.js then stops the renderer's window loop (`sessionstart`), its cancel goes to the session and the pending window callback survives. In Edge that callback fires and re-requests through the patched function, so the window loop rides on the XR session beside the XR loop; when the session ends, three.js restarts its window loop through the still-patched function on the ended session and both loops are gone. The Quest Browser does not run window frame callbacks while an immersive session presents (the PDF fix's own premise), so there the leftover callback waits and resumes the window loop after the session ends.

The QUEST profile therefore holds window frame callbacks while IWER's session is active (`clients/motion.ts`, `QUEST_WINDOW_FRAMES`; `E2E_QUEST_WINDOW_RAF=run` turns it off). With it: one tick per frame (60 renderer frames a second), the sent `tracked` equals the own pose's (7, 5 with the left controller off, 1 out of VR), and the scene keeps drawing after leaving VR (60 a second). The plain-IWER run is kept as T4.8's evidence `2026-11-14T15-31-02-934Z`.

Still to look at on a real headset: with the leftover callback held, leaving VR through the client's own exit (`scene.exitVR()`, where `exit-vr` restores the functions before the session's `end`) can leave two window loops running (the held callback and the one three.js restarts), so the scene would tick twice per frame after the first exit.

## (c) IOS (WebKit)

`trials/c-webkit.ts`, iPhone 15 descriptor.

| Engine | Result |
| --- | --- |
| Playwright WebKit 27.2 for Windows (`webkit.launch()`) | no `navigator.mediaDevices`, no `RTCPeerConnection`, no `AudioContext`/`webkitAudioContext`, even on https://example.com. The room page throws `undefined is not a constructor (evaluating 'new ( window.AudioContext ...` and Join Room never appears (240 s). WebGL 2 is there |
| Playwright WebKit 27.2 for Linux inside `netclient` (`webkit.connect("ws://127.0.0.1:3100")`) | `getUserMedia` gives "Mock audio device 1" and "Mock video device 1", `RTCPeerConnection` makes an offer. Entry works (20 s), microphone track `live`, Dialog connected; the DESK observer has its pose and an audio track. Software rendering: 21 fps |

So the IOS profile runs as Linux WebKit in a container, with the descriptor. The mock devices replace the clip files, so the pilot test needs another source (or only checks that audio arrives). What this engine cannot show stays on the real-device list: Safari's own media and autoplay rules, iOS WebRTC, GPU.

The development build's error overlay (webpack-dev-server) covered the WebKit page after a "ResizeObserver loop completed with undelivered notifications" error and took every click; the trial clients hide `#webpack-dev-server-client-overlay` with an init script (errors are still collected).

## (d) Local LiveKit

The three settings are server settings in `ret0.server_configs` (`webrtc-settings|livekit_server_url`, `livekit_api_key`, `livekit_api_secret`, each `{"value": ...}`), shown in admin > Server Settings > WEBRTC as "LiveKit Server URL", "LiveKit API Key", "LiveKit API Secret".

- Before the trial none of the three was set on this PC: there are no Cloud values to save or restore here. Only `webrtc-settings|allow_switch_sfu` is set (true).
- `livekit` and `livekit-tls` start as written; `wss://hubs.local:7443` answers through Caddy with the mkcert certificate (Edge trusts it; Git Bash's curl does not).
- With the local block set and reticulum restarted, the page's content security policy lists `hubs.local:7443`.
- Room `livekit` (sfu 2, set in `ret0.hubs`): both DESK clients `sfuId` 2, `isConnected`, microphone `live`; each detects the other's pilot (ratio 0.28 and 0.31, control frequency 0); B sees A walk 4.8 m; the packet log has 90 `#avatar-pose` sent and 90 received in 3 s.
- Afterwards the three keys were deleted again (the state found) and reticulum restarted.

Switching between the blocks (`trials/d-livekit.ts`, values never printed; since step 4 the switching lives in `lib/livekit.ts` and a test run selects its block with `MEDIA_BLOCK`, see README.md):

```bash
cd e2e
npx tsx trials/d-livekit.ts read    # once, before the first switch: saves the WEBRTC values to .env.local as LIVEKIT_CLOUD_*
npx tsx trials/d-livekit.ts local   # wss://hubs.local:7443, devkey, secret; restarts reticulum
npx tsx trials/d-livekit.ts cloud   # writes LIVEKIT_CLOUD_* back; restarts reticulum
npx tsx trials/d-livekit.ts unset   # removes the three keys (the state on this PC before the trial)
npx tsx trials/d-livekit.ts show    # URL of the active block
npx tsx trials/d-livekit.ts room <key> 2   # a trial room on LiveKit (0 for Dialog), in the database
```

By hand the same is admin > Server Settings > WEBRTC, the three fields, Save, then `docker compose restart reticulum`. The Cloud block needs the June project's URL, key and secret entered once (by hand or into `.env.local`) before LiveKit Cloud tests can run on this PC.

## (e) OLD build

`trials/e-old.ts`. `hubs-client-old` serves `feature/sfu-refactor` from the worktree `services/hubs-old`.

- Port 8081 was shadowed on this PC: another local program listens on 127.0.0.1:8081, so the browser reached it instead of the container. The service now publishes 8082 (`docker-compose.e2e.yml`).
- The worktree needs `services/hubs/certs` copied in; otherwise webpack makes a self-signed certificate.
- Form that works: Edge with `--host-resolver-rules="MAP hubs.local:8080 127.0.0.1:8082"` opening `https://hubs.local:8080/hub.html?hub_id=<id>`. The page loads the old scripts (`hub-0e93eed9...js` against the new build's `hub-6208123f...js`) and keeps an origin reticulum already allows. Opening `https://hubs.local:8082/hub.html?hub_id=<id>` with the same rule also entered. `https://hubs.local:4000/<id>` cannot work: reticulum serves the new build's page, whose hashed script names the old server does not have.
- Confirmed old: `APP.avatarPoses` undefined, `APP.sfu.bus` present; in 3 s it sent 200 `#avatar-RIG`, 6 `#avatarAnimState`, 3 `#isVR` and no `#avatar-pose`.
- With a new DESK client in the room: audio both ways (pilot 0.29 and 0.28); the new client shows the old one walking (rig z 0.15 to 5.0 m, `tracked` 7, `seq` −1 as for old packets). The old client receives `#avatar-pose` but cannot read it, as expected.

## (f) Poor-network client

`trials/f-netclient.ts`. Headless Chromium 159 in `netclient`, reached with `chromium.connect("ws://127.0.0.1:3100")`; `hubs.local` resolves to the host gateway inside the container.

- The browser server dropped the launch arguments (fake devices, clip files): Playwright's `run-server` takes `args` from a client only with `--unsafe`. The Dockerfile now starts it with `--unsafe` (the port is published on 127.0.0.1 only). The clip files are copied into the container with `docker cp`.
- Clean link: entry 18 s, Dialog connected, microphone `live`; the DESK client detects its pilot (0.26) and it detects the DESK pilot (0.34); its walk arrives (z 0.15 to 4.99). Candidate pair round trip 1 to 4 ms.
- `tc qdisc replace dev eth0 root netem delay 200ms 30ms loss 5%`: round trip 210 to 219 ms, `tc -s` shows 18 packets dropped of 547, an HTTPS request 243 to 652 ms; the pilot still arrives (0.30) and so does the movement. After `tc qdisc del`: 3 ms.
- Renders on SwiftShader, so no rate assertions, as the plan says. The service worker fails to register there (certificate not trusted in the container), which does not stop entry.

## (g) Avatar URL

`trials/g-avatar.ts`: A sets `APP.store.update({ profile: { avatarId: <url> } })`; checked on A and on observer B: `avatarSync.models.avatarIdByClientId`, the avatar entity and its entry in `APP.world.eid2Ik`, and the console line "Avatar of <id> mapped from <source>".

Sample: `VRM1_Constraint_Twist_Sample.vrm` (VRM 1.0, 10.8 MB, 54 humanoid bones) from `vrm-c/vrm-specification/samples`, © 2022 pixiv Inc., VRM Public License 1.0; its metadata allows avatar use by everyone, redistribution and modification. Copied to `e2e/assets/avatars/` (not committed).

| Form | Result |
| --- | --- |
| `http://assets/avatars/<file>` (through the CORS proxy) | fails: the proxy answers 401, because it refuses internal addresses (`HttpUtils.internal_ip?`) |
| `https://hubs.local:8443/avatars/<file>` (first try at publishing `assets` on the host) | fails: the content security policy's `connect-src` does not allow that port |
| `https://hubs.local:3001/avatars/<file>` (`assets` published on 3001 with the mkcert certificate) | loads in 1 s on both, "mapped from vrm"; `hubs.local` is fetched directly (no proxy) and 3001 is in the policy |
| public URL (`https://raw.githubusercontent.com/...`) through the CORS proxy | loads in 1 to 3 s on both, "mapped from vrm" |
| upload to `POST /api/v1/media`, then `<origin>?token=<access_token>` | loads in 1 s on both, "mapped from vrm"; the file expires with the upload TTL (2 days) unless promoted |

Use `https://hubs.local:3001/avatars/<file>` for the harness: local, permanent, no internet, reachable from containers too (through the host). All solved "with the old body solver" (the new solver is a viewer setting, off by default).

Two observations for T4.5 and T4.7:
- When A's avatar failed to load, B's fallback load also failed (`Failed to load fallback avatar ... Unexpected token '<'`, a 404 page parsed as glTF), so B showed no model for A; A's own fallback (the default robot) loaded.
- When both clients entered together and A already had a custom avatar in its profile, B had no model for A after 13 s (no load was even started) until A changed avatar. With the default avatar (pair trial) B did show A's robot. T4.5 should check late join with a custom avatar.

## D. Probe sanity

`trials/probes.ts`, used by `trials/pair.ts` (room `pair`, Dialog):

- Audio heard: `APP.sfu.getMediaStream(remoteId, "audio")` resolves to a stream with one `live` track. Chromium only feeds a remote WebRTC stream into Web Audio once a (muted) media element plays it. An `AnalyserNode` (FFT 4096, no smoothing) sampled every 40 ms for 4 s: the sender's pilot stands 20 dB or more above the surrounding spectrum in 0.29 to 0.31 of the samples (the beep is on a quarter of the time), the control frequency in 0 to 0.01. Same on LiveKit, the old build and the poor-network client.
- Packet log: `bus.takeRecording()` (to clear), `startRecording()`, 3 s, `stopRecording()`, `takeRecording()` gives 90 `#avatar-pose` with `s: 1` and 90 with `s: 0` from the other client: 30 a second each way. The entries' `m` is the decoded pose object (`c`, `seq`, `t`, `tracked`, `isVR`, `animState`, `rig`, `head`, `left`, `right`).
- Poses: B's `APP.avatarPoses.get(A)` follows A's walk (W for 1.5 s: rig z 0.15 to 4.94) with `seq` advancing.

## Launch and harness notes

- Locale: Edge on this PC runs in Japanese and the client follows `navigator.language`, so "Join Room" is not found. Every context is created with `locale: "en-US"`.
- tsx compiles with esbuild's `keepNames`, which wraps named functions in `__name(...)`; functions passed to `page.evaluate` then fail with "`__name` is not defined". Every page gets `globalThis.__name = f => f` first (`NAME_SHIM` in `trials/common.ts`).
- Signing in: the local reticulum has SMTP settings (admin > Server Settings > Email), so the UI sign-in would send a real e-mail through that account to the address typed in. `trials/accounts.ts` instead finds or creates `admin@example.com`, `member1@example.com`, `member2@example.com`, promotes the admin, makes a token with `Ret.Guardian.encode_and_sign` (`docker compose exec reticulum mix run -e ...`) and stores it in the profile's `___hubs_store` (`credentials.token/email`), where a finished sign-in leaves it. Profiles `profiles/trial-admin`, `trial-member1`, `trial-member2`. The plan's UI sign-in should only be used once SMTP is off or points at a local catcher.
- Reinstalling dependencies: `conditional-npm-ci` for hubs-client failed with `ENOTEMPTY ... node_modules/.cache/storybook/babel` because `hubs-storybook` shares the volume and was running, and it still wrote `package-lock.sha512`, so a plain rerun would have skipped the install. Stop `hubs-storybook` too and run `rm -f package-lock.sha512 && npm ci`.
- Console errors seen on every client, for the allow-list: an inline script blocked by the content security policy, one 404, `MISSING_TRANSLATION` (locale `ja` only), React `defaultProps` warnings, and on Dialog "InvalidStateError: Failed to execute 'send' on 'RTCDataChannel': RTCDataChannel.readyState is not 'open'" while channels open.
- Stale mutagen sessions of an earlier `bin/up` (pointing to a removed container) stay listed as "Connecting to beta"; harmless.
