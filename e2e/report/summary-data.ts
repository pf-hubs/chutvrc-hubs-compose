// What report/build-summary.ts cannot read from the runs: which tests stand for each item of the manual
// checklist (chutvrc_verification_2026-11), the findings of BASELINE.md with their verdicts and where the
// final run showed them, the pictures and videos of the gallery, and what only a real device can settle.
// Test keys are test ids without the media server block ("t2.1" for t2.1-dialog, t2.1-livekit-local, ...).
export type BlockName = "dialog" | "livekit-local" | "livekit-cloud";

export const BLOCKS: { block: BlockName; label: string; short: string }[] = [
  { block: "dialog", label: "Dialog", short: "Dialog" },
  { block: "livekit-local", label: "LiveKit, local server", short: "LiveKit local" },
  { block: "livekit-cloud", label: "LiveKit Cloud", short: "LiveKit Cloud" }
];

/**
 * One checklist item: the tests that stand for it. With `byCover`, only the checks of the test that name the
 * item count (the test's other checks are about other items); a test whose covers use the same letters for a
 * plan stage (B4, B6 and B8 are also stages of the implementation plan) is listed without it.
 */
export type ChecklistItem = {
  id: string;
  name: string;
  ja: string;
  tests: { key: string; blocks?: BlockName[]; byCover?: boolean }[];
  note?: string;
};

const ALL: BlockName[] = ["dialog", "livekit-local", "livekit-cloud"];
const LK: BlockName[] = ["livekit-local", "livekit-cloud"];
const D: BlockName[] = ["dialog"];

export const CHECKLIST: ChecklistItem[] = [
  { id: "B1", name: "Entry and audio", ja: "入室と音声", tests: [{ key: "t1-smoke", blocks: D, byCover: true }, { key: "t2.1", blocks: D }] },
  { id: "B2", name: "Mute", ja: "ミュート", tests: [{ key: "t1-smoke", blocks: D, byCover: true }, { key: "t2.2", blocks: D }, { key: "t7.2", blocks: D, byCover: true }] },
  {
    id: "B3",
    name: "Avatar sync",
    ja: "アバターの同期",
    tests: [{ key: "t1-smoke", blocks: D, byCover: true }, { key: "t4.2", blocks: D }, { key: "t4.3", blocks: D }, { key: "t7.6", blocks: D, byCover: true }]
  },
  { id: "B4", name: "Grabbing media", ja: "メディアを掴む", tests: [{ key: "t6.3", blocks: D }, { key: "t7.2", blocks: D, byCover: true }] },
  { id: "B5", name: "Recording", ja: "録画", tests: [{ key: "t1-smoke", blocks: D, byCover: true }, { key: "t6.9", blocks: D }] },
  {
    id: "B6",
    name: "Room move",
    ja: "ルーム移動",
    tests: [{ key: "t1-smoke", blocks: D, byCover: true }, { key: "t2.6-dialog-to-dialog", blocks: D }, { key: "t7.4", blocks: D, byCover: true }]
  },
  { id: "L1", name: "Switching the media server, state kept", ja: "切替と引き継ぎ", tests: [{ key: "t2.7", blocks: LK, byCover: true }, { key: "t2.8", blocks: LK }, { key: "t7.4", blocks: ALL, byCover: true }] },
  {
    id: "L2",
    name: "LiveKit basics (B1 to B3 on LiveKit)",
    ja: "LiveKit の基本",
    tests: [{ key: "t1-smoke", blocks: LK, byCover: true }, { key: "t2.1", blocks: LK }, { key: "t2.2", blocks: LK }, { key: "t4.2", blocks: LK }, { key: "t4.3", blocks: LK }]
  },
  { id: "L3", name: "LiveKit room move", ja: "LiveKit のルーム移動", tests: [{ key: "t2.6-livekit-to-livekit", blocks: LK }, { key: "t2.6-dialog-to-livekit", blocks: LK }] },
  { id: "L4", name: "Back to Dialog", ja: "Dialog に戻す", tests: [{ key: "t2.7", blocks: LK, byCover: true }] },
  { id: "F1", name: "Video: camera, screen share, video file, camera tool", ja: "映像", tests: [{ key: "t2.4", blocks: ALL }, { key: "t2.5", blocks: ALL }] },
  {
    id: "F2",
    name: "Public speaking",
    ja: "公開講演",
    tests: [{ key: "t3.1", blocks: D }, { key: "t3.2", blocks: D }, { key: "t3.5", blocks: D }, { key: "t3.3", blocks: LK }, { key: "t3.6", blocks: LK }]
  },
  {
    id: "F3",
    name: "PDF and laser pointer",
    ja: "PDF とレーザーポインター",
    tests: [{ key: "t2.11", blocks: ALL, byCover: true }, { key: "t3.4", blocks: D }, { key: "t7.1", blocks: ALL, byCover: true }]
  },
  { id: "F4", name: "Block and kick", ja: "ブロックとキック", tests: [{ key: "t2.10", blocks: ALL }] },
  { id: "F5", name: "RTC panel", ja: "RTC パネル", tests: [{ key: "t2.12", blocks: ALL }] },
  { id: "F6", name: "Admin pages", ja: "管理画面", tests: [{ key: "t6.1", blocks: D }] },
  { id: "F7", name: "Spoke", ja: "Spoke", tests: [{ key: "t6.6", blocks: D }] },
  { id: "F8", name: "External URLs", ja: "外部 URL", tests: [{ key: "t6.4", blocks: ALL }] },
  { id: "F9", name: "N-impro and libpeer", ja: "N-impro と libpeer", tests: [{ key: "t2.11", blocks: ALL, byCover: true }] },
  { id: "F10", name: "Long stay, memory", ja: "長時間", tests: [{ key: "t2.15", blocks: ALL }, { key: "t7.6", blocks: ALL, byCover: true }] },
  {
    id: "V1",
    name: "Full-body avatars",
    ja: "全身アバター",
    tests: [{ key: "t4.7", blocks: ALL }, { key: "t7.1", blocks: ALL, byCover: true }]
  },
  { id: "V2", name: "Re-entering", ja: "再入室", tests: [{ key: "t4.4", blocks: ALL }] },
  { id: "V3", name: "Own latency in VR", ja: "自分の遅れ", tests: [{ key: "t7.1", blocks: ALL, byCover: true }] },
  { id: "V4", name: "Avatar change", ja: "アバター変更", tests: [{ key: "t4.6", blocks: ALL }] },
  { id: "V5", name: "NPC", ja: "NPC", tests: [], note: "not covered: the checklist runs it only where the ai-chatbot NPC is used; no NPC scene on this stack" },
  {
    id: "V6",
    name: "New body solver",
    ja: "新しいソルバー",
    tests: [
      { key: "t5-rpm-vr", blocks: ALL },
      { key: "t5-vrm0-vr", blocks: ALL },
      { key: "t5-vrm1-vr", blocks: ALL },
      { key: "t5-rpm-desktop", blocks: ALL },
      { key: "t5-vrm0-desktop", blocks: ALL },
      { key: "t5-vrm1-desktop", blocks: ALL },
      { key: "t0.4", blocks: D }
    ]
  },
  { id: "V7", name: "Interpolation", ja: "補間", tests: [{ key: "t4.9", blocks: ALL }, { key: "t0.3", blocks: D }] },
  { id: "V8", name: "Bandwidth", ja: "帯域", tests: [{ key: "t4.1", blocks: ALL }, { key: "t0.2", blocks: D }] },
  { id: "V9", name: "Old build compatibility", ja: "旧ビルドとの互換", tests: [{ key: "t4.11", blocks: ALL }] },
  { id: "N1", name: "bitECS loader and add-on on", ja: "有効化", tests: [{ key: "t6.7", blocks: D, byCover: true }] },
  { id: "N2", name: "Behavior Graph", ja: "Behavior Graph", tests: [{ key: "t6.7", blocks: D, byCover: true }] },
  { id: "N3", name: "Video fetched once", ja: "動画の再読み込み", tests: [{ key: "t6.7", blocks: D, byCover: true }] },
  { id: "N4", name: "Pinned items saved and restored", ja: "保存と復元", tests: [{ key: "t6.7", blocks: D, byCover: true }] },
  { id: "N5", name: "Grabbing in the new loader", ja: "掴む（新ローダー）", tests: [{ key: "t6.7", blocks: D, byCover: true }] }
];

export type Verdict = "develop" | "new" | "cannot tell" | "not a defect";

/**
 * A finding of BASELINE.md. `seen`: where the final run showed it (block and test key); `earlier`: evidence of
 * an earlier run (run folder and test id) when the final run did not show it.
 */
export type Finding = {
  n: number;
  short: string;
  verdict: Verdict;
  verdictText: string;
  where: string;
  seen: { block: BlockName; key: string; note?: string }[];
  earlier?: { run: string; test: string };
};

export const FINDINGS: Finding[] = [
  {
    n: 1,
    short: "Remote avatar models are not drawn on Dialog",
    verdict: "develop",
    verdictText: "already on develop",
    where: "dialog-adapter.ts announces #avatarId once per entry, sent before its channel is open",
    seen: [{ block: "dialog", key: "t1-smoke" }, { block: "dialog", key: "t2.10" }, { block: "dialog", key: "t4.5" }]
  },
  {
    n: 2,
    short: "Microphone wish lost at entry on Dialog; the first mute click can then be lost",
    verdict: "new",
    verdictText: "lost wish at entry: already on develop; lost click: new since develop (transport refactor)",
    where: "src/sfu-adapters/media-session.ts enableMicrophone() does not record micWanted when the producer is missing; toggleMicrophone() flips micWanted",
    seen: [{ block: "dialog", key: "t2.3", note: "the error at entry; no click lost in this run" }]
  },
  { n: 3, short: "One-way audio (and poses) at a simultaneous join on Dialog", verdict: "develop", verdictText: "already on develop", where: "Dialog send transport (#21)", seen: [{ block: "dialog", key: "t1-smoke" }, { block: "dialog", key: "t2.2" }, { block: "dialog", key: "t2.9" }] },
  {
    n: 4,
    short: "LiveKit Voice button shows muted while the microphone is on",
    verdict: "develop",
    verdictText: "already on develop",
    where: "src/sfu-adapters/livekit-adapter.ts _initializeLocalAudio: \"Start muted by default\"",
    seen: [{ block: "livekit-local", key: "t2.2" }, { block: "livekit-local", key: "t1-smoke" }, { block: "livekit-local", key: "t7.2" }, { block: "livekit-cloud", key: "t2.2" }, { block: "livekit-cloud", key: "t1-smoke" }]
  },
  {
    n: 5,
    short: "LiveKit to LiveKit room move leaves the microphones disabled",
    verdict: "new",
    verdictText: "new since develop (transport refactor)",
    where:
      "src/sfu-adapters/sfu-session.ts connect() carries the microphone wish only when the adapter is replaced; the kept LiveKit adapter's _initializeLocalAudio mutes on every connect",
    seen: [{ block: "livekit-local", key: "t2.6-livekit-to-livekit" }, { block: "livekit-local", key: "t1-smoke" }, { block: "livekit-cloud", key: "t2.6-livekit-to-livekit" }, { block: "livekit-cloud", key: "t1-smoke" }]
  },
  {
    n: 6,
    short: "The microphone chosen in Audio Settings is ignored",
    verdict: "develop",
    verdictText: "already on develop",
    where: "src/utils/media-devices-manager.js: deviceId { ideal: [id] }",
    seen: [{ block: "dialog", key: "t2.3" }, { block: "livekit-local", key: "t2.3" }, { block: "livekit-cloud", key: "t2.3" }]
  },
  { n: 7, short: "A Dialog restart takes everyone out of the room", verdict: "develop", verdictText: "already on develop", where: "Dialog adapter reconnect", seen: [{ block: "dialog", key: "t2.9" }] },
  {
    n: 8,
    short: "Local LiveKit restart: poses and avatars never return (\"PC manager is closed\" loop)",
    verdict: "develop",
    verdictText: "already on develop",
    where: "src/sfu-adapters/livekit-adapter.ts reconnect()",
    seen: [{ block: "livekit-local", key: "t2.9" }]
  },
  {
    n: 9,
    short: "Block and kick on LiveKit: the hidden user is still heard and drawn; the kicked client stays connected",
    verdict: "develop",
    verdictText: "already on develop",
    where: "LiveKit adapter: block and kick handling",
    seen: [{ block: "livekit-local", key: "t2.10" }, { block: "livekit-cloud", key: "t2.10" }]
  },
  {
    n: 10,
    short: "The laser pointer is never sent",
    verdict: "develop",
    verdictText: "already on develop",
    where: "src/components/cursor-controller.js sends only when this.isHoverTargetMainScreen, which nothing sets",
    seen: [{ block: "dialog", key: "t2.11" }, { block: "dialog", key: "t3.4" }, { block: "livekit-local", key: "t2.11" }, { block: "livekit-cloud", key: "t2.11" }]
  },
  {
    n: 11,
    short: "BOT clients throw every frame",
    verdict: "new",
    verdictText: "reading renderer.xr: already on develop; throwing every frame: new since develop (avatar refactor)",
    where: "src/avatar/pose/local-pose-source.ts reads renderer.xr; src/avatar/net/pose-sender.ts sends every frame on a channel that is not open",
    seen: [],
    earlier: { run: "2026-11-14T13-04-21-583Z", test: "t2.15-dialog" }
  },
  {
    n: 12,
    short: "Public speaking on Dialog delivers nothing to the listening room",
    verdict: "develop",
    verdictText: "code identical on develop (read, not run)",
    where: "src/systems/public-speaking-system.js initPublicSpeakerAgent awaits getSfuTokenOrFetch(); reticulum refuses it for Dialog rooms (sfu_type_not_supported)",
    seen: [{ block: "dialog", key: "t3.1" }, { block: "dialog", key: "t3.2" }, { block: "dialog", key: "t3.5" }]
  },
  {
    n: 13,
    short: "Public speaking on LiveKit throws the speaker out of the room",
    verdict: "develop",
    verdictText: "most likely already on develop (not run there)",
    where: "src/sfu-adapters/sfu-config.ts derivePublicSpeakingConfig passes no token; the token reticulum issues is the speaker's own identity in the speaker's own room",
    seen: [{ block: "livekit-local", key: "t3.3", note: "10 participant ids for the speaker" }, { block: "livekit-cloud", key: "t3.3", note: "14 participant ids for the speaker" }]
  },
  {
    n: 14,
    short: "Broadcast menu offers Start Speaking again while speaking; stopping takes two clicks",
    verdict: "develop",
    verdictText: "code identical on develop",
    where: "PublicSpeakingMenu.js keeps publicSpeakerActive in the menu's own state",
    seen: [{ block: "dialog", key: "t3.1" }]
  },
  {
    n: 15,
    short: "The speaker's PDF page does not reach the listening room",
    verdict: "develop",
    verdictText: "code identical on develop",
    where: "src/components/media-loader.js sends and applies #pdfPage only when isPinned, which nothing sets",
    seen: [{ block: "dialog", key: "t3.4" }]
  },
  {
    n: 16,
    short: "Name tag stays where the first model's neck was after an avatar change",
    verdict: "develop",
    verdictText: "code identical on develop",
    where: "src/components/name-tag.js looks the neck up once (line 182)",
    seen: [{ block: "dialog", key: "t4.7" }, { block: "livekit-local", key: "t4.7" }, { block: "livekit-cloud", key: "t4.7" }]
  },
  {
    n: 17,
    short: "A model with unfamiliar bone names is shown unsolved instead of the default avatar",
    verdict: "develop",
    verdictText: "same structure on develop",
    where: "src/avatar/avatar-model-manager.ts falls back only when loading throws",
    seen: [{ block: "dialog", key: "t4.7" }, { block: "livekit-local", key: "t4.7" }, { block: "livekit-cloud", key: "t4.7" }]
  },
  {
    n: 18,
    short: "An untracked hand does not rest",
    verdict: "new",
    verdictText: "new with the avatar refactor in the sense that the tracked bits are new; neither solver reads them",
    where: "solvers do not read TrackedPose.tracked",
    seen: [{ block: "dialog", key: "t4.8" }, { block: "livekit-local", key: "t4.8" }, { block: "livekit-cloud", key: "t4.8" }]
  },
  {
    n: 19,
    short: "Pose bytes are 0.4 to 0.6 of the old build's, not a quarter",
    verdict: "not a defect",
    verdictText: "expectation, not a defect",
    where: "the plan's quarter assumes all four parts moving",
    seen: [{ block: "dialog", key: "t4.1", note: "0.47 moving, 0.63 idle" }, { block: "livekit-local", key: "t4.1", note: "0.53, 0.63" }, { block: "livekit-cloud", key: "t4.1", note: "0.53, 0.63" }]
  },
  { n: 20, short: "A late joiner on Dialog never gets the model (#1)", verdict: "develop", verdictText: "already on develop (#1)", where: "as #1", seen: [{ block: "dialog", key: "t4.5" }] },
  {
    n: 21,
    short: "Data channels that never open on Dialog (a send transport stuck connecting)",
    verdict: "develop",
    verdictText: "the one-way pattern of #3, already on develop at a lower rate",
    where: "Dialog send transport; not located",
    seen: [{ block: "livekit-local", key: "t2.7", note: "after the switch back to Dialog" }, { block: "dialog", key: "t7.7-no-bots", note: "a phone's sending" }]
  },
  {
    n: 22,
    short: "Two-bone solver: a bone that must turn half a turn can get an arbitrary turn",
    verdict: "new",
    verdictText: "new code (avatar refactor)",
    where: "src/avatar/ik/two-bone-ik.ts setFromUnitVectors",
    seen: [{ block: "dialog", key: "t0.4" }]
  },
  {
    n: 23,
    short: "A headset entering VR sends its first three poses 0.79 m too high",
    verdict: "cannot tell",
    verdictText: "seen under IWER; the real headset has to show it",
    where: "src/avatar/pose/local-pose-source.ts copies #avatar-pov-node; src/systems/camera-system.js",
    seen: []
  },
  {
    n: 24,
    short: "New solver: height scale taken from one frame and kept",
    verdict: "new",
    verdictText: "new with the avatar refactor (new solver, off by default)",
    where: "src/avatar/ik/calibration.ts calibrateHeight; AvatarIkManager.recalibrate() never called",
    seen: [{ block: "dialog", key: "t5-vrm0-vr", note: "scale 1.116 against 1.130" }, { block: "livekit-local", key: "t5-rpm-vr", note: "scale 0.927 against 0.939" }]
  },
  {
    n: 25,
    short: "New solver: hands off the controllers and eyes off the headset by the height scale, in VR",
    verdict: "not a defect",
    verdictText: "by design of the new solver; a product decision",
    where: "src/avatar/ik/solve-body.ts trackedHandTarget, placeHips",
    seen: [{ block: "dialog", key: "t5-summary" }, { block: "livekit-local", key: "t5-summary" }]
  },
  {
    n: 26,
    short: "New solver: planted feet jump up to 25 cm in one frame",
    verdict: "new",
    verdictText: "new with the avatar refactor",
    where: "src/avatar/ik/feet.ts placeFoot (STEP_DISTANCE 0.25 m)",
    seen: [{ block: "dialog", key: "t5-summary" }, { block: "livekit-local", key: "t5-summary" }]
  },
  {
    n: 27,
    short: "New solver: body stays turned up to 20 degrees from the head",
    verdict: "new",
    verdictText: "new with the avatar refactor",
    where: "src/avatar/ik/body-yaw.ts (20 degree dead band)",
    seen: [{ block: "dialog", key: "t5-summary", note: "contact sheets" }]
  },
  {
    n: 28,
    short: "Both solvers let the feet slide with locomotion",
    verdict: "develop",
    verdictText: "old solver: code identical on develop; new solver: same behaviour",
    where: "src/avatar/ik/feet.ts (root space); legacy/leg-ik.ts",
    seen: [{ block: "dialog", key: "t5-summary", note: "sliding in each T5 test's ik-summary.csv" }]
  },
  {
    n: 29,
    short: "Old solver: soles off the floor, VRM 1.0 head turned 90 degrees, knees backward, arm flips",
    verdict: "develop",
    verdictText: "code identical on develop (the legacy solver)",
    where: "src/avatar/ik/avatar-ik-manager.ts, legacy/*",
    seen: [{ block: "dialog", key: "t5-summary" }, { block: "livekit-local", key: "t5-summary" }]
  },
  {
    n: 30,
    short: "Both solvers bend the VRM models' wrists far",
    verdict: "develop",
    verdictText: "old solver: code identical on develop; the new solver kept the correction",
    where: "solve-body.ts HAND_CORRECTION_UNFLIPPED; legacy/arm-ik.ts rotateX(-PI/3)",
    seen: [{ block: "dialog", key: "t5-summary", note: "wrist bend in each T5 test's ik-summary.csv" }]
  },
  {
    n: 31,
    short: "Spoke: the new empty project cannot be published (template model on a retired host; null model)",
    verdict: "develop",
    verdictText: "on develop too (the retired host cannot load there either; same export code)",
    where: "spoke src/assets/templates/crater.spoke; src/editor/objects/Model.js clips getter",
    seen: [{ block: "dialog", key: "t6.6" }]
  },
  {
    n: 32,
    short: "Spoke cannot publish a scene without a material",
    verdict: "develop",
    verdictText: "code identical on develop",
    where: "spoke src/editor/Editor.js exportScene: remapNodeRefsInComponents(json.materials)",
    seen: [{ block: "dialog", key: "t6.6" }]
  },
  {
    n: 33,
    short: "Spoke's name fields carry a pattern current Chromium rejects",
    verdict: "develop",
    verdictText: "code identical on develop",
    where: "spoke PublishDialog.js, SaveNewProjectDialog.js, CreateScenePage.js",
    seen: [{ block: "dialog", key: "t6.6" }]
  },
  {
    n: 34,
    short: "A client moving by link on Dialog can arrive with a send transport that never connects",
    verdict: "develop",
    verdictText: "the pattern of #3 and #21 (already on develop at a lower rate)",
    where: "as #21",
    seen: [{ block: "dialog", key: "t1-smoke", note: "no voice or poses after the move" }]
  },
  {
    n: 35,
    short: "The WebKit clients' sending fails often",
    verdict: "cannot tell",
    verdictText: "cannot tell: Linux WebKit in a container under load is not Safari",
    where: "Dialog: the #21 pattern; LiveKit: not located",
    seen: [{ block: "dialog", key: "t7.3-ipad" }, { block: "livekit-local", key: "t7.3-ipad" }, { block: "dialog", key: "t7.7-no-bots" }]
  },
  {
    n: 36,
    short: "The headset's voice silent at the observer once",
    verdict: "cannot tell",
    verdictText: "not reproduced in step 8's three repetitions",
    where: "not located",
    seen: [],
    earlier: { run: "step8-dialog", test: "t7.1-dialog" }
  },
  {
    n: 37,
    short: "Poor-network client's poses arrive 0.8 to 1.9 s late under a shaped link",
    verdict: "cannot tell",
    verdictText: "a measurement, not judged against a limit",
    where: "data channel congestion control (likely)",
    seen: [{ block: "dialog", key: "t7.5" }, { block: "livekit-local", key: "t7.5" }]
  }
];

/** Plan 3.3, last paragraph, with what this run left open for a real device */
export const REAL_DEVICE: string[] = [
  "How the new body solver looks from inside a headset (V6): the own hands off the controllers by the height scale (#25), the planted feet stepping (#26), the body turned from the head (#27)",
  "The Quest Browser's own WebXR and GPU: frame rate, entering and leaving VR (whether the first poses are 0.79 m too high, #23), controller paging of a PDF, hand tracking",
  "Safari on a real iPhone and iPad: media, WebRTC, autoplay and audio session rules; whether the sending failures of the Linux WebKit client (#35) happen there",
  "Real microphones (echo cancellation, noise suppression and gain control on real speech), the Audio Settings device choice with real devices (#6)",
  "Real networks: Wi-Fi and mobile links, NAT and TURN (T2.13's force_tcp and force_turn cannot connect here: reticulum hands out TURN settings, but no TURN server runs on this stack)",
  "A phone's GPU, heat and battery limits; Chrome on Android itself",
  "The mixed room with real devices: this PC could not carry nine clients with valid frame rates"
];

/** What this run left open on the simulated clients themselves */
export const OPEN_FROM_THIS_RUN: string[] = [
  "Not run after the second drop on C: (for a later run with more free space on C:, or with WSL's crash dumps off C:): on LiveKit Cloud T4.12, T5, T6.2 to T6.5, T6.9 and T7.1 to T7.7; on local LiveKit the soak with the DESK clients only, and the one rerun each of T4.12 (a socket timeout) and T7.7 (the WebKit process crashed)",
  "Not runnable on this stack: V5 (no NPC scene), N2 (no Behavior Graph scene; the examples are .blend files only), the media-frame part of N4 (the harness could not drag an item into the frame), T2.13's relay (no TURN server)"
];

/**
 * The gallery: files copied from a test's evidence folder into final/media/ under `name` (so the folder stands
 * on its own). `file` is a file name in the folder, or a pattern that picks the first match.
 */
export type GalleryItem = {
  block: BlockName;
  test: string;
  file: string | RegExp;
  name: string;
  caption: string;
  kind: "image" | "video";
  /** A folder relative to the evidence folder, for a test that has no result in its run (MANUAL_CELLS) */
  folder?: string;
};

export const GALLERY: GalleryItem[] = [
  // Screenshots and pictures
  { kind: "image", block: "dialog", test: "t1-smoke", file: "shot-05-B-member1-facing-A-after-walk.png", name: "dialog-t1-B-faces-A-no-avatar.png", caption: "Dialog, T1: B faces A after A's walk and draws no avatar for A, though it holds A's pose (#1)" },
  { kind: "image", block: "livekit-local", test: "t1-smoke", file: "shot-05-B-member1-facing-A-after-walk.png", name: "livekit-local-t1-B-faces-A.png", caption: "LiveKit local, T1: the same moment on LiveKit, A's avatar drawn" },
  { kind: "image", block: "dialog", test: "t2.4", file: /^shot-01-B-member1-Share-Camera/, name: "dialog-t2.4-B-sees-A-camera.png", caption: "Dialog, T2.4: B sees A's camera clip" },
  { kind: "image", block: "dialog", test: "t2.11", file: /^shot-05-A-admin-nimpro-result/, name: "dialog-t2.11-nimpro-result.png", caption: "Dialog, T2.11: the N-impro round's result on the admin's page" },
  { kind: "image", block: "dialog", test: "t2.12", file: /^shot-01-A-admin-rtc-panel/, name: "dialog-t2.12-rtc-panel.png", caption: "Dialog, T2.12: the RTC panel with statistics" },
  { kind: "image", block: "dialog", test: "t3.1", file: /^shot-01-C-member2-C-sees-stand-in/, name: "dialog-t3.1-listening-room-no-stand-in.png", caption: "Dialog, T3.1: C in the listening room while A speaks: no stand-in, no voice (#12)" },
  { kind: "image", block: "livekit-local", test: "t3.3", file: /^shot-\d+-A-admin-at-end/, name: "livekit-local-t3.3-speaker-thrown-out.png", caption: "LiveKit local, T3.3: the speaker's own page after Start Speaking (#13)" },
  { kind: "image", block: "dialog", test: "t4.7", file: /^shot-03-B-member1-B-sees-vrm1/, name: "dialog-t4.7-name-tag-beside-vrm1.png", caption: "Dialog, T4.7: after the third avatar change the name tag stays where the first model's neck was (#16)" },
  { kind: "image", block: "dialog", test: "t4.7", file: /^shot-04-B-member1-B-sees-unfamiliar/, name: "dialog-t4.7-unfamiliar-bones-unsolved.png", caption: "Dialog, T4.7: the model with unfamiliar bone names shown unsolved instead of the default avatar (#17)" },
  { kind: "image", block: "dialog", test: "t5-summary", file: "sheet-rpm.png", name: "dialog-t5-contact-sheet-ready-player-me.png", caption: "Dialog, T5: contact sheet, Ready Player Me sample, motions by solver (old against new)" },
  { kind: "image", block: "dialog", test: "t5-summary", file: "sheet-vrm0.png", name: "dialog-t5-contact-sheet-vrm0.png", caption: "Dialog, T5: contact sheet, VRM 0.x sample" },
  { kind: "image", block: "dialog", test: "t5-summary", file: "sheet-vrm1.png", name: "dialog-t5-contact-sheet-vrm1.png", caption: "Dialog, T5: contact sheet, VRM 1.0 sample" },
  { kind: "image", block: "dialog", test: "t6.6", file: /^shot-02-A-admin-spoke-publish-error/, name: "dialog-t6.6-spoke-publish-error.png", caption: "T6.6: Spoke cannot publish the new project (#31)" },
  { kind: "image", block: "dialog", test: "t6.7", file: /^shot-03-A-admin-pinned/, name: "dialog-t6.7-bitecs-pinned-items.png", caption: "T6.7: the bitECS room with the pinned video and image" },
  { kind: "image", block: "dialog", test: "t7.1", file: /^shot-01-B-quest-in-vr/, name: "dialog-t7.1-quest-in-vr.png", caption: "Dialog, T7.1: the emulated Quest's own view in VR" },
  { kind: "image", block: "dialog", test: "t7.1", file: /^shot-02-A-desk-observer-sees-H1/, name: "dialog-t7.1-observer-sees-quest.png", caption: "Dialog, T7.1: the desktop observer sees the headset play H1" },
  { kind: "image", block: "dialog", test: "t7.2", file: /^shot-01-B-android-entered/, name: "dialog-t7.2-phone-entered.png", caption: "Dialog, T7.2: the phone profile (Pixel 7) in the room" },
  { kind: "image", block: "dialog", test: "t7.2", file: /^shot-08-B-android-landscape/, name: "dialog-t7.2-phone-landscape.png", caption: "Dialog, T7.2: the phone turned to landscape" },
  { kind: "image", block: "dialog", test: "t7.3", file: /^shot-01-C-iphone-entered/, name: "dialog-t7.3-iphone-webkit.png", caption: "Dialog, T7.3: the iPhone profile in Linux WebKit" },
  { kind: "image", block: "dialog", test: "t7.3-ipad", file: /^shot-01-C-ipad-entered/, name: "dialog-t7.3-ipad-webkit.png", caption: "Dialog, T7.3: the iPad profile in Linux WebKit" },
  { kind: "image", block: "dialog", test: "t7.5", file: "grid-see-after-blackout.png", name: "dialog-t7.5-grid-see-after-blackout.png", caption: "Dialog, T7.5: who sees whom after the poor-network client's 10 s blackout" },
  { kind: "image", block: "dialog", test: "t7.7-no-bots", folder: "final-dialog-attempts/t7.7-no-bots-dialog-stopped", file: "grid-hear-end.png", name: "dialog-t7.7-grid-hear-end.png", caption: "Dialog, T7.7 mixed room: who hears whom after 10 minutes (30 of 42)" },
  { kind: "image", block: "dialog", test: "t7.7-no-bots", folder: "final-dialog-attempts/t7.7-no-bots-dialog-stopped", file: "grid-see-end.png", name: "dialog-t7.7-grid-see-end.png", caption: "Dialog, T7.7 mixed room: who sees whom after 10 minutes (31 of 42)" },
  // Videos
  { kind: "video", block: "dialog", test: "t5-summary", file: "summary-rpm.mp4", name: "dialog-t5-summary-ready-player-me.mp4", caption: "Dialog, T5: old and new solver side by side, Ready Player Me sample, every motion" },
  { kind: "video", block: "dialog", test: "t5-summary", file: "summary-vrm1.mp4", name: "dialog-t5-summary-vrm1.mp4", caption: "Dialog, T5: old and new solver side by side, VRM 1.0 sample" },
  { kind: "video", block: "dialog", test: "t7.1", file: "B-quest.webm", name: "dialog-t7.1-quest-client.webm", caption: "Dialog, T7.1: the emulated Quest's own page (VR, H1, the PDF, out of VR and in again)" },
  { kind: "video", block: "dialog", test: "t7.2", file: "B-android.webm", name: "dialog-t7.2-phone-client.webm", caption: "Dialog, T7.2: the phone's page (joysticks, mute, Place, rotation)" },
  { kind: "video", block: "dialog", test: "t7.3", file: "C-iphone.webm", name: "dialog-t7.3-iphone-client.webm", caption: "Dialog, T7.3: the iPhone profile's page in Linux WebKit" },
  { kind: "video", block: "dialog", test: "t1-smoke", file: "B-member1.webm", name: "dialog-t1-B-no-avatar-of-A.webm", caption: "Dialog, T1: B's page; A walks in front of B but no avatar is drawn (#1)" },
  { kind: "video", block: "livekit-local", test: "t3.3", file: "A-admin.webm", name: "livekit-local-t3.3-speaker-page.webm", caption: "LiveKit local, T3.3: the speaker's page from Start Speaking to being thrown out of the room (#13)" },
  { kind: "video", block: "dialog", test: "t5-summary", file: "summary-vrm0.mp4", name: "dialog-t5-summary-vrm0.mp4", caption: "Dialog, T5: old and new solver side by side, VRM 0.x sample" }
];

/** Tests that have no result in a block's run on purpose: "<test key>@<block>" -> why; "*@<block>" for every other missing test of the block */
export const NOT_RUN: Record<string, string> = {
  "t2.15@livekit-cloud": "the step 9 brief leaves the soak out on LiveKit Cloud",
  "*@livekit-cloud":
    "the Cloud run was stopped during T4.12 when free space on C: fell under 2.5 GB (to 0.25 GB for a moment); no test ran after that (the brief: stop when C: falls under 2 GB)"
};

/** What else ran on the PC during the runs (the C: watchdog's minute samples add CPU and memory per run) */
export const LOAD_NOTES: string[] = [
  "Left running during all runs (user programs, not touched): the Unity editor 2022.3.22f1 with a project open (about 2 GB, mostly idle) and the VRChat Creator Companion (about 1.2 GB); Meta Quest Link (OVRServer), the Virtual Desktop service, Steam, Razer Synapse and Cortex, Logi Options+",
  "OBS Studio 27.0.1 ran and the harness recorded with it per test, but its screen capture source rendered black and its desktop audio was silent, so the OBS recordings carry no picture or sound (each test notes it); the per-client videos and the received-audio measurements are unaffected",
  "Docker Desktop's WSL machine held about 19 GB with the stack's 14 containers (three webpack dev servers and Storybook among them); no Docker resource limits are set",
  "C: started with 6.6 GB free. A watchdog sampled it (every minute, later every 10 s, slower when the CPU was saturated) and stopped a run below 2 GB, later below 3 GB and then 2.5 GB. It stopped two runs. Dialog, closing phase of T7.7: 2.7 to 1.7 GB in about a minute, free RAM down to 1.3 GB; space came back to 6.7 GB once the browsers closed. LiveKit Cloud, T4.12 (four DESK clients and bots starting, free RAM 3.5 GB): 3.4 to 0.25 GB between two samples 40 s apart; back to 3.3 GB right after. All runs ended there",
  "What took the space: at the end of the local LiveKit run the WebKit client's web process in the netclient container crashed and WSL wrote a 3.1 GB crash dump into the user's TEMP folder on C: (moved afterwards to final-livekit-local-attempts on D:, which brought C: back to 6.5 GB). The page file on C: stood at 19.5 to 20 GB during the runs (its size before them was not recorded). What took the transient 3 GB during Cloud T4.12 was not found",
  "Reticulum's clock fell behind by 1 to 4 s a minute under load; the harness measured it every 10 minutes and restarted reticulum when it was over 45 s behind (several times per run)"
];

/**
 * Cells the run could not write itself, "<test key>@<block>": a test stopped before it wrote its result, given
 * the status its saved files show; `href` is relative to the evidence folder
 */
export const MANUAL_CELLS: Record<string, { status: "OK" | "NG" | "known limitation" | "invalid" | "skipped"; text: string; href: string }> = {
  "t7.7-no-bots@dialog": {
    status: "invalid",
    text:
      "ran its 10 minutes, then stopped in its closing phase by the C: watchdog (free space under 2 GB while RAM ran out), so it wrote no result. Saved: both headsets 32 to 50 fps, the iPhone 4 to 7 fps (floor 55); who hears whom 29 then 30 of 42, who sees whom 31 then 31 of 42 (one phone's sending failed, #21; nobody hears the iPhone, #35)",
    href: "final-dialog-attempts/t7.7-no-bots-dialog-stopped/grid-see-end.png"
  },
  "t4.12@livekit-cloud": {
    status: "skipped",
    text: "stopped during the test by the C: watchdog: free space fell from 3.4 to 0.25 GB within a minute while the four DESK clients and the bots started (free RAM 3.5 GB); its four DESK clients had entered (80 s), no check had run",
    href: "final-livekit-cloud/t4.12-livekit-cloud/entry.json"
  }
};

/** Why a test that ran in its block was skipped, by test key, for results written before the reporter kept skip reasons */
export const SKIP_REASONS: Record<string, string> = {
  "t7.7": "runs only with T7_MIXED_WITH_BOTS=1: with the two bots the mixed room never formed on this PC (step 8); the room without the bots ran instead"
};

/** A line added under a cell's key number, "<test key>@<block>" */
export const CELL_NOTES: Record<string, string> = {
  "t2.15@livekit-local":
    "the bots kept the room from forming (a bot's page did not take its microphone file within 60 s); the run again with the 4 DESK clients only was not made: all runs were stopped after the C: drive fell under 2 GB",
  "t4.12@livekit-local":
    "a socket error (page.goto net::ERR_TIMED_OUT): an environmental failure, but its one rerun was not made: all runs were stopped after the C: drive fell under 2 GB",
  "t7.7-no-bots@livekit-local":
    "the WebKit client's web process crashed (WSL wrote a 3.1 GB crash dump to C:, now moved to final-livekit-local-attempts); its one rerun was not made: all runs were stopped after the C: drive fell under 2 GB",
  "t2.15@dialog":
    "4 DESK clients without bots: the run with 4 BOT stopped after 10 min when a bot's page load timed out (net::ERR_TIMED_OUT) and the DESK pages stopped answering; kept in final-dialog-attempts/t2.15-dialog-with-bots"
};

/** A line under each run in the header: what the run's time span holds besides the one pass of the suites */
export const RUN_NOTES: Partial<Record<BlockName, string>> = {
  dialog:
    "T0 (preflight and offline tests) first; one pass of all suites, stopped by the C: watchdog in T7.7's closing phase (the last test); the soak run again at the end with the 4 DESK clients only",
  "livekit-local": "one pass of all suites; the soak with the bots failed, and its run with the DESK clients only was not made",
  "livekit-cloud": "one pass of the LiveKit tests without the soak, stopped by the C: watchdog during T4.12; T5, T6 and T7 not run"
};

/** What this run showed that BASELINE.md does not list, with the tests that showed it */
export type Observation = { text: string; kind: "product" | "harness" | "environment"; seen: { block: BlockName; key: string }[] };

export const NEW_OBSERVATIONS: Observation[] = [
  {
    kind: "product",
    text: "After the fourth switch of the room's media server (LiveKit back to Dialog, microphone muted), A's Dialog data channels never opened: 10,863 sends on a channel that was not open in six minutes, and the switch check did not finish. The #21 pattern after a switch; T2.7 passed its switches in the earlier steps and on Cloud in this run",
    seen: [{ block: "livekit-local", key: "t2.7" }]
  },
  {
    kind: "product",
    text: "After the netclient client's 10 s outage on LiveKit Cloud it no longer heard B (A and B heard everyone); in the earlier Cloud runs the audio came back for all",
    seen: [{ block: "livekit-cloud", key: "t2.9" }]
  },
  {
    kind: "product",
    text: "On Dialog the device simulator's #iot message reached A and C but not B and D (the bridging client forwards it), and D's N-impro answer was not sent; in step 4 every member received it (develop: nobody)",
    seen: [{ block: "dialog", key: "t2.11" }]
  },
  {
    kind: "product",
    text: "After the poor-network client's 10 s blackout its poses came back 8.3 s (Dialog) and 9.5 s (local LiveKit) after the link (step 8: at once on Dialog, 8.6 s on local LiveKit); the voice within 0.25 s",
    seen: [{ block: "dialog", key: "t7.5" }, { block: "livekit-local", key: "t7.5" }]
  },
  {
    kind: "harness",
    text: "The room link did not appear in B's view after it was placed, so the Dialog to Dialog move was not attempted (T1's move by the same path ran)",
    seen: [{ block: "dialog", key: "t2.6-dialog-to-dialog" }]
  },
  {
    kind: "harness",
    text: "The click on Room Info and Settings timed out with the People panel open, so the switch back to Dialog was not made",
    seen: [{ block: "livekit-local", key: "t2.8" }]
  },
  {
    kind: "harness",
    text: "An entry wait timed out: the phone stayed on Microphone Setup (T7.4); the headset half of T4.1 did not run (240 s)",
    seen: [{ block: "livekit-local", key: "t7.4" }, { block: "livekit-local", key: "t4.1" }]
  },
  {
    kind: "environment",
    text: "The bots kept the 40-minute soak from forming on both servers: a bot's page load timed out (Dialog), a bot's page did not take its microphone file (local LiveKit). Dialog's soak passed with the 4 DESK clients only. T4.12 (4 DESK and 4 BOT) did not complete in any block: a bot's page did not take its file (Dialog), a page load timed out at the socket (local LiveKit), the C: watchdog stopped it (Cloud)",
    seen: [{ block: "dialog", key: "t2.15" }, { block: "livekit-local", key: "t2.15" }, { block: "dialog", key: "t4.12" }, { block: "livekit-local", key: "t4.12" }]
  },
  {
    kind: "environment",
    text: "The WebKit client's web process crashed in the netclient container during the local mixed room; WSL wrote a 3.1 GB crash dump to the TEMP folder on C:, which took the drive to 3.4 GB free",
    seen: [{ block: "livekit-local", key: "t7.7-no-bots" }]
  },
  {
    kind: "environment",
    text: "T2.13: reticulum hands out TURN settings for the room, but no TURN server runs on this stack, so the relay-only transports of ?force_tcp and ?force_turn never connect (the same in steps 4 and 5)",
    seen: [{ block: "dialog", key: "t2.13" }]
  }
];
