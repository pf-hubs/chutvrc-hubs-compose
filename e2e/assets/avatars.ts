// The avatar models of plan 1.6, downloaded from their public sources into assets/avatars/ (git ignores
// the binaries; SOURCES.md records source and licence). Each file is checked against the SHA-256 it had
// when it was chosen, so a changed upstream file is noticed rather than tested silently.
//   npx tsx assets/avatars.ts          download what is missing, verify everything
// Served at https://hubs.local:3001/avatars/<file> (the assets service), the URL form a profile's
// avatarId takes (TRIALS.md, trial g).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ASSETS_DIR, ASSETS_URL } from "../lib/env";

export type AvatarName = "rpm" | "vrm0" | "vrm1" | "unfamiliar";

export type AvatarAsset = {
  file: string;
  url: string;
  sha256: string;
  /** What the solver's bone mapping is expected to make of it (T4.7) */
  expect: "keywords" | "vrm" | "no humanoid rig";
  describe: string;
};

export const AVATARS: Record<AvatarName, AvatarAsset> = {
  rpm: {
    file: "readyplayer.me.glb",
    url: "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/readyplayer.me.glb",
    sha256: "b69cec7a5cc7dc7e1c1f19c324024d090ae06e1315441a7bce4bf236112addc1",
    expect: "keywords",
    describe: "Ready Player Me sample avatar (glTF, Mixamo-style bone names)"
  },
  vrm0: {
    file: "three-vrm-girl.vrm",
    url: "https://raw.githubusercontent.com/pixiv/three-vrm/v0.6.11/packages/three-vrm/examples/models/three-vrm-girl.vrm",
    sha256: "e6e179dea8bafc712900b5012628166a64e982d45566fb705d2ec52f579279b9",
    expect: "vrm",
    describe: "VRoid Studio sample (VRM 0.x, humanoid extension VRM)"
  },
  vrm1: {
    file: "VRM1_Constraint_Twist_Sample.vrm",
    url: "https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm",
    sha256: "12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2",
    expect: "vrm",
    describe: "VRM 1.0 sample (humanoid extension VRMC_vrm)"
  },
  unfamiliar: {
    file: "CesiumMan.glb",
    url: "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/glTF-Binary/CesiumMan.glb",
    sha256: "b7001eaeea8254bd44773bcd247e78696d94169388fbb2a1800fc69434e777d9",
    expect: "no humanoid rig",
    describe: "glTF sample with joints named Skeleton_torso_joint_1, leg_joint_L_1, ...: no hips or head the keyword table knows"
  }
};

export const avatarFile = (name: AvatarName) => path.join(ASSETS_DIR, "avatars", AVATARS[name].file);
export const avatarUrl = (name: AvatarName) => `${ASSETS_URL}/avatars/${AVATARS[name].file}`;

const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function missingAvatars(): AvatarName[] {
  return (Object.keys(AVATARS) as AvatarName[]).filter(n => !fs.existsSync(avatarFile(n)));
}

async function download(name: AvatarName) {
  const { url } = AVATARS[name];
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  fs.mkdirSync(path.dirname(avatarFile(name)), { recursive: true });
  fs.writeFileSync(avatarFile(name), Buffer.from(await response.arrayBuffer()));
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("assets/avatars.ts")) {
  for (const name of Object.keys(AVATARS) as AvatarName[]) {
    const asset = AVATARS[name];
    if (!fs.existsSync(avatarFile(name))) {
      console.log(`${name}: downloading ${asset.url}`);
      await download(name);
    }
    const hash = sha256(avatarFile(name));
    const size = fs.statSync(avatarFile(name)).size;
    const verdict = !asset.sha256 ? "no hash recorded yet" : hash === asset.sha256 ? "hash matches" : `HASH DIFFERS (expected ${asset.sha256})`;
    console.log(`${name}: ${asset.file} ${size} bytes, sha256 ${hash}: ${verdict}`);
  }
}
