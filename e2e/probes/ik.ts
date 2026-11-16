// Inverse kinematics probe (plan 3.2, T5): how a page's solver poses another client's avatar, measured on
// every animation frame against the pose the solver was given.
//
// From APP.sfu.avatarSync.models.avatarEidByClientId to APP.world.eid2Ik (the avatar's solver manager,
// whose rig description names the bones) and APP.avatarPoses (the pose the solver read this frame). The
// recorder runs in a requestAnimationFrame callback queued after the page's own frame loop, so it reads the
// bones as the frame drew them. Targets are in the room's space: the rig transform of the pose applied to the
// head and hands, which are in the rig's space (positions in metres; the rig turned by its YXZ angles).
//
// Per frame (degrees and centimetres):
// - hand: hand bone to the controller (position), and the hand bone's orientation against the controller's
//   turned by the hand correction both solvers apply (a quarter turn about z for a model facing -z, a third
//   of a turn about x otherwise), and the wrist's bend (the hand's rest axis against the forearm);
// - the drawn size: the new solver draws a VR sender's model at its ratio (the sender's announced standing
//   eye height over the eye height of the model this observer loaded, ikState.modelRatio) and scales the
//   root bone by it. Every rest-pose measure (the ankles' rest height, the eye height) is taken at the
//   model's own size and multiplied by that ratio each frame; the root's actual scale is recorded beside it;
// - eyes: the midpoint of the eye bones to the head pose, as it is (raw) and with the VR solver's deliberate
//   knee slack taken into account (it hangs the body 3 cm in the model's proportions, so 3 cm x the ratio in
//   the room, below the exact eye height so the legs keep a bend: the drawn eyes sit that much under the
//   headset); the eyes' height over the floor and their height against the headset's; the head bone's
//   facing against the headset's;
// - elbows and knees: how far each bends and to which side. The side is the angle between the way the lower
//   bone folds and the way the joint folds anatomically, both seen across the upper bone: the forearm folds
//   toward the model's front as it was in its rest pose, the shin toward its back, fixed in the upper bone's
//   own frame. Over 90° with a bend of 20° or more is the wrong side;
// - feet: the ankle's height over the floor (the rig's height) less its height in the rest pose, so a sole on
//   the floor reads 0 and below the floor negative; how far a foot on the floor slid since the last frame;
// - the largest change of any body bone since the last frame, in the rig's space (so walking and turning the
//   rig do not count), in position and in rotation, beside the largest change of the head and hands given;
// - spine twist: the yaw from the hips' facing to the chest's and from the chest's to the head's; and how
//   far the hips face away from where the headset looks;
// - NaN: values that are not finite in the world matrices of the model's bones.
import type { Page } from "@playwright/test";
import { NotApplicable } from "./compat";

/**
 * Plain JavaScript, no three.js: vectors and quaternions as arrays ([x, y, z], [x, y, z, w]). The page
 * code uses it, and ikSelfTest() runs the same source in Node against cases with known answers.
 */
export const IK_MATH = `
const IkMath = (() => {
  const RAD = 180 / Math.PI;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = a => Math.sqrt(dot(a, a));
  const norm = a => { const l = len(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; };
  const dist = (a, b) => len(sub(a, b));
  /** Degrees between two directions; null when either has no length */
  const angle = (a, b) => {
    const la = len(a), lb = len(b);
    if (la < 1e-9 || lb < 1e-9) return null;
    return Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (la * lb)))) * RAD;
  };
  /** The part of v across the unit axis */
  const across = (v, axis) => sub(v, scale(axis, dot(v, axis)));
  const qMul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
  const qInv = q => [-q[0], -q[1], -q[2], q[3]];
  const qRot = (q, v) => {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };
  /** three.js's Quaternion.setFromEuler for the order YXZ (radians) */
  const qFromEulerYXZ = (x, y, z) => {
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
  };
  const qAxisAngle = (axis, a) => { const s = Math.sin(a / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)]; };
  /** Degrees of the turn between two orientations */
  const qAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * RAD;
  /** A point given in the rig's space, in the room's space */
  const rigToWorld = (rigPos, rigQuat, p) => add(qRot(rigQuat, p), rigPos);
  const worldToRig = (rigPos, rigQuat, w) => qRot(qInv(rigQuat), sub(w, rigPos));
  /** The yaw of a direction, radians, zero facing -z, left positive (as the camera's) */
  const yawOf = v => Math.atan2(-v[0], -v[2]);
  const wrapDeg = d => { let w = d % 360; if (w > 180) w -= 360; if (w <= -180) w += 360; return w; };
  /**
   * A joint between an upper and a lower bone: [bend, side] in degrees. Bend is the angle between the two
   * bones; side is the angle between the way the lower bone leaves the upper bone's line and the way it
   * folds anatomically (both across the upper bone). Side is null while the limb is straight.
   */
  const bendSide = (start, joint, end, foldWorld) => {
    const upper = norm(sub(joint, start));
    const lower = norm(sub(end, joint));
    const bend = angle(upper, lower);
    const leaves = across(lower, upper);
    const folds = across(foldWorld, upper);
    if (bend === null || len(leaves) < 1e-4 || len(folds) < 1e-4) return [bend === null ? 0 : bend, null];
    return [bend, angle(leaves, folds)];
  };
  return { RAD, add, sub, scale, dot, len, norm, dist, angle, across, qMul, qInv, qRot, qFromEulerYXZ, qAxisAngle, qAngle, rigToWorld, worldToRig, yawOf, wrapDeg, bendSide };
})();
`;

/** The body bones the probe follows; IkFrame.jumpBone is an index into this list */
export const IK_BODY_BONES = ["hips", "spine", "chest", "neck", "head", "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot"] as const;

/** The per-frame fields, in the order the page returns them */
export const IK_FIELDS = [
  "t",
  "seq",
  "isVR",
  "tracked",
  "newSolver",
  "modelRatio",
  "rootScale",
  "handErrL",
  "handErrR",
  "handRotErrL",
  "handRotErrR",
  "wristL",
  "wristR",
  "eyeErr",
  "eyeErrSlack",
  "eyeDy",
  "eyeHeight",
  "headDirErr",
  "elbowBendL",
  "elbowSideL",
  "elbowBendR",
  "elbowSideR",
  "kneeBendL",
  "kneeSideL",
  "kneeBendR",
  "kneeSideR",
  "footL",
  "footR",
  "slideL",
  "slideR",
  "jumpPos",
  "jumpBone",
  "jumpRot",
  "inputJump",
  "twistHipsChest",
  "twistChestHead",
  "bodyTurn",
  "nan",
  "handLx",
  "handLy",
  "handLz",
  "handRx",
  "handRy",
  "handRz",
  "targetLx",
  "targetLy",
  "targetLz",
  "targetRx",
  "targetRy",
  "targetRz",
  "rigX",
  "rigZ",
  "rigYaw"
] as const;

export type IkField = (typeof IK_FIELDS)[number];
/** One frame; a value is null where it cannot be measured (no controller in VR, a missing bone, a straight limb) */
export type IkFrame = Record<IkField, number | null>;
export type IkRun = { frames: IkFrame[]; info: IkInfo | null; missing: number; errors: string[] };
export type IkInfo = {
  eid: number;
  rigSource: string;
  isFlippedY: boolean;
  forward: number[];
  bones: string[];
  /** At the model's own size (root scale 1) */
  restAnkle: { left: number | null; right: number | null };
  restEyeHeight: number | null;
  skeletonBones: number;
};

/**
 * The VR solver's deliberate drop of the body under the exact eye height, in the model's own metres
 * (STANDING_KNEE_SLACK of the client's ik/vr/solve-vr-body.ts): the legs keep a bend while the user stands
 */
export const KNEE_SLACK = 0.03;

/** The recorder in page code: window.__e2eIk.start(key, clientId), .stop(key), .info(clientId), .ownCheck() */
export const IK_PROBE = `(() => {
  if (window.__e2eIk) return;
  ${IK_MATH}
  const M = IkMath;
  const FIELDS = ${JSON.stringify(IK_FIELDS)};
  const BODY = ${JSON.stringify(IK_BODY_BONES)};
  const arr3 = v => [v.x, v.y, v.z];
  const arr4 = q => [q.x, q.y, q.z, q.w];
  const r = (v, d) => v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

  /** What does not change while the model stays: rest frames in root space and the directions read from them */
  const prepare = clientId => {
    const APP = window.APP;
    const THREE = window.AFRAME.THREE;
    const models = APP && APP.sfu && APP.sfu.avatarSync && APP.sfu.avatarSync.models;
    if (!models || !APP.world || !APP.world.eid2Ik) return { notApplicable: true };
    const eid = models.avatarEidByClientId.get(clientId);
    if (eid === undefined) return null;
    const ik = APP.world.eid2Ik.get(eid);
    if (!ik || !ik.rig) return null;
    const rig = ik.rig;
    const B = rig.bones;
    if (!B.root || !B.hips) return null;
    const names = new Map();
    for (const [name, bone] of Object.entries(B)) if (bone) names.set(bone, name);
    // Root space: the frame of the root's children with the root at the origin, unturned, at the model's own
    // size (the new solver scales the root by its ratio; each frame multiplies these measures by it)
    const mats = new Map([[B.root, new THREE.Matrix4()]]);
    const restMatrix = o => {
      if (mats.has(o)) return mats.get(o);
      if (!o.parent) return null;
      const parent = restMatrix(o.parent);
      if (!parent) return null;
      const name = names.get(o);
      const rest = name ? rig.rest[name] : null;
      const local = new THREE.Matrix4().compose(rest ? rest.position : o.position, rest ? rest.quaternion : o.quaternion, o.scale);
      const m = new THREE.Matrix4().multiplyMatrices(parent, local);
      mats.set(o, m);
      return m;
    };
    const restPos = {}, restQuat = {};
    for (const [name, bone] of Object.entries(B)) {
      if (!bone) continue;
      const m = restMatrix(bone);
      if (!m) continue;
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.decompose(p, q, s);
      restPos[name] = arr3(p);
      restQuat[name] = arr4(q);
    }
    const forward = M.norm(arr3(rig.forward));
    const local = (name, v) => restQuat[name] ? M.qRot(M.qInv(restQuat[name]), v) : null;
    const facing = {};
    for (const name of ["hips", "spine", "chest", "neck", "head"]) facing[name] = local(name, forward);
    // The way the lower bone folds, across the upper bone, in the upper bone's own frame
    const fold = (upper, lower, way) => {
      if (!restPos[upper] || !restPos[lower]) return null;
      const axis = M.norm(M.sub(restPos[lower], restPos[upper]));
      const across = M.across(way, axis);
      return M.len(across) > 1e-6 ? local(upper, M.norm(across)) : null;
    };
    const back = M.scale(forward, -1);
    const folds = {
      leftElbow: fold("leftUpperArm", "leftLowerArm", forward),
      rightElbow: fold("rightUpperArm", "rightLowerArm", forward),
      leftKnee: fold("leftUpperLeg", "leftLowerLeg", back),
      rightKnee: fold("rightUpperLeg", "rightLowerLeg", back)
    };
    // The hand's rest axis: the forearm's direction at rest, in the hand's frame
    const handAxis = side => restPos[side + "Hand"] && restPos[side + "LowerArm"] ? local(side + "Hand", M.norm(M.sub(restPos[side + "Hand"], restPos[side + "LowerArm"]))) : null;
    const correction = rig.isFlippedY
      ? { left: M.qAxisAngle([0, 0, 1], Math.PI / 2), right: M.qAxisAngle([0, 0, 1], -Math.PI / 2) }
      : { left: M.qAxisAngle([1, 0, 0], -Math.PI / 3), right: M.qAxisAngle([1, 0, 0], -Math.PI / 3) };
    const eyes = ["leftEye", "rightEye"].filter(n => restPos[n]);
    const model = APP.world.eid2obj.get(eid);
    const skeleton = new Set();
    if (model) model.traverse(o => { if (o.isSkinnedMesh) for (const b of o.skeleton.bones) skeleton.add(b); });
    for (const name of BODY) if (B[name]) skeleton.add(B[name]);
    return {
      clientId, eid, ik, rig, B, forward, facing, folds, correction,
      handAxis: { left: handAxis("left"), right: handAxis("right") },
      restAnkle: { left: restPos.leftFoot ? restPos.leftFoot[1] : null, right: restPos.rightFoot ? restPos.rightFoot[1] : null },
      restEyeHeight: eyes.length ? eyes.reduce((a, n) => a + restPos[n][1], 0) / eyes.length : null,
      skeleton: [...skeleton],
      prev: null,
      info: {
        eid, rigSource: rig.source, isFlippedY: rig.isFlippedY, forward, bones: Object.keys(restPos),
        restAnkle: { left: restPos.leftFoot ? r(restPos.leftFoot[1], 4) : null, right: restPos.rightFoot ? r(restPos.rightFoot[1], 4) : null },
        restEyeHeight: eyes.length ? r(eyes.reduce((a, n) => a + restPos[n][1], 0) / eyes.length, 4) : null,
        skeletonBones: skeleton.size
      }
    };
  };

  const P = new (window.AFRAME.THREE.Vector3)(), Q = new (window.AFRAME.THREE.Quaternion)(), S = new (window.AFRAME.THREE.Vector3)();
  const worldOf = bone => { bone.matrixWorld.decompose(P, Q, S); return { p: arr3(P), q: arr4(Q) }; };

  const sample = ctx => {
    const APP = window.APP;
    const pose = APP.avatarPoses.get(ctx.clientId);
    if (!pose) return null;
    const B = ctx.B;
    B.root.updateWorldMatrix(true, true);
    const rigPos = arr3(pose.rig.pos);
    const rigQuat = M.qFromEulerYXZ(pose.rig.rot.x, pose.rig.rot.y, 0);
    const W = {};
    for (const name of BODY) if (B[name]) W[name] = worldOf(B[name]);
    const out = {};
    for (const f of FIELDS) out[f] = null;
    out.t = performance.timeOrigin + performance.now();
    out.seq = pose.seq;
    out.isVR = pose.isVR ? 1 : 0;
    out.tracked = pose.tracked;
    const newSolver = !!APP.store.state.preferences.avatarIkV2;
    out.newSolver = newSolver ? 1 : 0;
    // The size the model is drawn at over its own: the new solver's ratio (1 for the screen and chatbot
    // solvers); the old solver draws the model at its own size
    const state = ctx.ik.ikState;
    const ratio = newSolver && state && Number.isFinite(state.modelRatio) && state.modelRatio > 0 ? state.modelRatio : 1;
    out.modelRatio = r(ratio, 5);
    out.rootScale = r(B.root.scale.y, 5);
    out.rigX = r(rigPos[0], 4);
    out.rigZ = r(rigPos[2], 4);
    out.rigYaw = r(pose.rig.rot.y * M.RAD, 2);
    const parts = { left: pose.leftHand, right: pose.rightHand };
    for (const side of ["left", "right"]) {
      const S1 = side === "left" ? "L" : "R";
      const hand = W[side + "Hand"];
      const part = parts[side];
      const target = M.rigToWorld(rigPos, rigQuat, arr3(part.pos));
      out["target" + S1 + "x"] = r(target[0], 4); out["target" + S1 + "y"] = r(target[1], 4); out["target" + S1 + "z"] = r(target[2], 4);
      if (hand) { out["hand" + S1 + "x"] = r(hand.p[0], 4); out["hand" + S1 + "y"] = r(hand.p[1], 4); out["hand" + S1 + "z"] = r(hand.p[2], 4); }
      const trackedBit = side === "left" ? 2 : 4;
      if (hand && pose.isVR && (pose.tracked & trackedBit)) {
        out["handErr" + S1] = r(M.dist(hand.p, target) * 100, 2);
        const want = M.qMul(M.qMul(rigQuat, arr4(part.quat)), ctx.correction[side]);
        out["handRotErr" + S1] = r(M.qAngle(hand.q, want), 2);
      }
      const lower = W[side + "LowerArm"];
      if (hand && lower && ctx.handAxis[side]) out["wrist" + S1] = r(M.angle(M.sub(hand.p, lower.p), M.qRot(hand.q, ctx.handAxis[side])), 2);
      const upperArm = W[side + "UpperArm"];
      if (upperArm && lower && hand && ctx.folds[side + "Elbow"]) {
        const [bend, sideAngle] = M.bendSide(upperArm.p, lower.p, hand.p, M.qRot(upperArm.q, ctx.folds[side + "Elbow"]));
        out["elbowBend" + S1] = r(bend, 2);
        out["elbowSide" + S1] = r(sideAngle, 2);
      }
      const thigh = W[side + "UpperLeg"], shin = W[side + "LowerLeg"], foot = W[side + "Foot"];
      if (thigh && shin && foot && ctx.folds[side + "Knee"]) {
        const [bend, sideAngle] = M.bendSide(thigh.p, shin.p, foot.p, M.qRot(thigh.q, ctx.folds[side + "Knee"]));
        out["kneeBend" + S1] = r(bend, 2);
        out["kneeSide" + S1] = r(sideAngle, 2);
      }
      if (foot && ctx.restAnkle[side] !== null) {
        const clearance = foot.p[1] - rigPos[1] - ctx.restAnkle[side] * ratio;
        out["foot" + S1] = r(clearance * 100, 2);
        const prevFoot = ctx.prev && ctx.prev.W[side + "Foot"];
        if (prevFoot && ctx.prev.clear[side] < 0.03 && clearance < 0.03) out["slide" + S1] = r(Math.hypot(foot.p[0] - prevFoot.p[0], foot.p[2] - prevFoot.p[2]) * 100, 3);
      }
    }
    // Eyes and head
    const head = W.head;
    const headset = M.rigToWorld(rigPos, rigQuat, arr3(pose.head.pos));
    let eyes = null;
    const eyeBones = [B.leftEye, B.rightEye].filter(Boolean);
    if (eyeBones.length) {
      eyes = [0, 0, 0];
      for (const e of eyeBones) { e.updateWorldMatrix(false, false); eyes = M.add(eyes, worldOf(e).p); }
      eyes = M.scale(eyes, 1 / eyeBones.length);
    } else if (head) eyes = M.add(head.p, [0, 0.08, 0]);
    if (eyes) {
      out.eyeErr = r(M.dist(eyes, headset) * 100, 2);
      // The VR solver hangs the body KNEE_SLACK (model metres) under the exact eye height, so the drawn eyes
      // are meant to sit that times the ratio under the headset; only in VR with the new solver
      const slack = newSolver && pose.isVR ? ${KNEE_SLACK} * ratio : 0;
      out.eyeErrSlack = r(M.dist(eyes, [headset[0], headset[1] - slack, headset[2]]) * 100, 2);
      out.eyeDy = r((eyes[1] - headset[1]) * 100, 2);
      out.eyeHeight = r(eyes[1] - rigPos[1], 4);
    }
    if (head && ctx.facing.head) out.headDirErr = r(M.angle(M.qRot(head.q, ctx.facing.head), M.qRot(M.qMul(rigQuat, arr4(pose.head.quat)), [0, 0, -1])), 2);
    // Spine twist
    const yaw = name => W[name] && ctx.facing[name] ? M.yawOf(M.qRot(W[name].q, ctx.facing[name])) * M.RAD : null;
    const hipsYaw = yaw("hips"), chestYaw = yaw("chest") !== null ? yaw("chest") : yaw("spine"), headYaw = yaw("head");
    if (hipsYaw !== null && chestYaw !== null) out.twistHipsChest = r(M.wrapDeg(chestYaw - hipsYaw), 2);
    if (chestYaw !== null && headYaw !== null) out.twistChestHead = r(M.wrapDeg(headYaw - chestYaw), 2);
    // How far the hips face away from where the headset looks (yaw only)
    const headsetYaw = M.yawOf(M.qRot(M.qMul(rigQuat, arr4(pose.head.quat)), [0, 0, -1])) * M.RAD;
    if (hipsYaw !== null) out.bodyTurn = r(M.wrapDeg(headsetYaw - hipsYaw), 2);
    // Jumps in the rig's space
    const rigSpace = {};
    for (const name of BODY) if (W[name]) rigSpace[name] = { p: M.worldToRig(rigPos, rigQuat, W[name].p), q: M.qMul(M.qInv(rigQuat), W[name].q) };
    const inputs = { head: arr3(pose.head.pos), left: arr3(pose.leftHand.pos), right: arr3(pose.rightHand.pos) };
    if (ctx.prev) {
      let jumpPos = 0, jumpBone = null, jumpRot = 0, inputJump = 0;
      BODY.forEach((name, i) => {
        const a = ctx.prev.rigSpace[name], b = rigSpace[name];
        if (!a || !b) return;
        const d = M.dist(a.p, b.p);
        if (d > jumpPos) { jumpPos = d; jumpBone = i; }
        jumpRot = Math.max(jumpRot, M.qAngle(a.q, b.q));
      });
      out.jumpBone = jumpBone;
      for (const k of ["head", "left", "right"]) inputJump = Math.max(inputJump, M.dist(inputs[k], ctx.prev.inputs[k]));
      out.jumpPos = r(jumpPos * 100, 3);
      out.jumpRot = r(jumpRot, 3);
      out.inputJump = r(inputJump * 100, 3);
    }
    // NaN in the model's bones
    let nan = 0;
    for (const b of ctx.skeleton) for (const v of b.matrixWorld.elements) if (!Number.isFinite(v)) nan++;
    out.nan = nan;
    ctx.prev = { W, rigSpace, inputs, clear: { left: out.footL === null ? 1 : out.footL / 100, right: out.footR === null ? 1 : out.footR / 100 } };
    return FIELDS.map(f => out[f]);
  };

  const runs = new Map();
  window.__e2eIk = {
    info(clientId) {
      const ctx = prepare(clientId);
      return ctx && ctx.notApplicable ? { notApplicable: true } : ctx ? ctx.info : null;
    },
    start(key, clientId) {
      const run = { clientId, ctx: null, frames: [], missing: 0, errors: [], running: true, info: null };
      runs.set(key, run);
      const raf = window.requestAnimationFrame.bind(window);
      const frame = () => {
        if (!run.running) return;
        try {
          const eid = window.APP.sfu.avatarSync.models.avatarEidByClientId.get(clientId);
          if (!run.ctx || run.ctx.eid !== eid) {
            run.ctx = eid === undefined ? null : prepare(clientId);
            if (run.ctx && run.ctx.notApplicable) run.ctx = null;
            if (run.ctx && !run.info) run.info = run.ctx.info;
          }
          const row = run.ctx ? sample(run.ctx) : null;
          if (row) run.frames.push(row);
          else run.missing++;
        } catch (e) {
          if (run.errors.length < 5) run.errors.push(String(e && e.stack || e).slice(0, 300));
        }
        raf(frame);
      };
      raf(frame);
    },
    stop(key) {
      const run = runs.get(key);
      if (!run) return null;
      run.running = false;
      runs.delete(key);
      return { frames: run.frames, info: run.info, missing: run.missing, errors: run.errors };
    },
    /**
     * The known-answer check on the page that sends the pose: the own pose's head and controllers taken
     * through rigToWorld against where the scene has the pov node and the controller objects
     */
    ownCheck() {
      const APP = window.APP;
      const pose = APP.avatarPoses.get(APP.sfu.clientId);
      if (!pose) return null;
      const THREE = window.AFRAME.THREE;
      const rigPos = arr3(pose.rig.pos);
      const rigQuat = M.qFromEulerYXZ(pose.rig.rot.x, pose.rig.rot.y, 0);
      const out = {};
      for (const [key, part, selector] of [["head", pose.head, "#avatar-pov-node"], ["left", pose.leftHand, "#player-left-controller"], ["right", pose.rightHand, "#player-right-controller"]]) {
        const o = document.querySelector(selector).object3D;
        o.updateWorldMatrix(true, false);
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        o.matrixWorld.decompose(p, q, s);
        const mine = M.rigToWorld(rigPos, rigQuat, arr3(part.pos));
        out[key] = { positionMm: r(M.dist(mine, arr3(p)) * 1000, 3), turnDeg: r(M.qAngle(M.qMul(rigQuat, arr4(part.quat)), arr4(q)), 3), world: arr3(p).map(v => r(v, 4)) };
      }
      out.rig = { pos: rigPos.map(v => r(v, 4)), yawDeg: r(pose.rig.rot.y * M.RAD, 2) };
      return out;
    }
  };
})();`;

/** Installs the probe in the page (idempotent) */
export async function installIk(page: Page) {
  await page.evaluate(code => new Function(code)(), IK_PROBE);
}

/** What the probe reads of `clientId`'s model on `page`; null while the page has no model for the client */
export async function ikInfo(page: Page, clientId: string): Promise<IkInfo | null> {
  await installIk(page);
  const info = await page.evaluate(id => (window as any).__e2eIk.info(id), clientId);
  if (info?.notApplicable) throw new NotApplicable("the inverse kinematics probe needs the avatar model manager and APP.world.eid2Ik");
  return info;
}

export async function startIk(page: Page, key: string, clientId: string) {
  await installIk(page);
  await page.evaluate(({ key, clientId }) => (window as any).__e2eIk.start(key, clientId), { key, clientId });
}

export async function stopIk(page: Page, key: string): Promise<IkRun> {
  const run = await page.evaluate(key => (window as any).__e2eIk?.stop(key) ?? null, key);
  if (!run) return { frames: [], info: null, missing: 0, errors: ["no recorder with this key"] };
  return { ...run, frames: run.frames.map((row: (number | null)[]) => Object.fromEntries(IK_FIELDS.map((f, i) => [f, row[i]])) as IkFrame) };
}

export type OwnCheck = { head: { positionMm: number; turnDeg: number }; left: { positionMm: number; turnDeg: number }; right: { positionMm: number; turnDeg: number }; rig: { pos: number[]; yawDeg: number } };

/** The sender's own pose through the probe's maths against the scene's own objects (known answer: 0) */
export async function ikOwnCheck(page: Page): Promise<OwnCheck | null> {
  await installIk(page);
  return page.evaluate(() => (window as any).__e2eIk.ownCheck());
}

// ---------- Summary ----------

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const mean = (v: number[]) => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : null);
const max = (v: number[]) => (v.length ? Math.max(...v) : null);
const min = (v: number[]) => (v.length ? Math.min(...v) : null);
const p95 = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(0.95 * v.length))] : null);
const r2 = (v: number | null) => (v === null ? null : +v.toFixed(2));

/** A joint on the wrong side: bent 20 degrees or more, folding more than 90 degrees away from its anatomical way */
export const WRONG_SIDE_DEG = 90;
export const MIN_BEND_DEG = 20;
/** A sole this far under the floor counts as below it */
export const BELOW_FLOOR_CM = 2;

export type IkSummary = {
  frames: number;
  vrFrames: number;
  /** Both hands together, over frames in VR where the hand's controller is tracked (cm, degrees) */
  handErrMean: number | null;
  handErrP95: number | null;
  handErrMax: number | null;
  handRotErrMean: number | null;
  handRotErrMax: number | null;
  wristMax: number | null;
  eyeErrMean: number | null;
  eyeErrMax: number | null;
  /** With the VR solver's knee slack taken into account (the raw distance is eyeErr*) */
  eyeErrSlackMean: number | null;
  eyeErrSlackMax: number | null;
  /** The eyes' height against the headset's: mean (negative: under it) */
  eyeDyMean: number | null;
  /** The drawn eyes' height over the floor: mean, in metres */
  eyeHeightMean: number | null;
  headDirErrMean: number | null;
  headDirErrMax: number | null;
  /** Frames with an elbow (or knee) on the wrong side, either side, and the largest side angle of a bent joint */
  elbowWrong: number;
  elbowSideMax: number | null;
  kneeWrong: number;
  kneeSideMax: number | null;
  /** The lowest sole (cm; negative under the floor), frames with a sole under the floor, the highest */
  footMin: number | null;
  belowFloorFrames: number;
  footMax: number | null;
  /** Total horizontal sliding of the feet while on the floor (cm) */
  slide: number;
  jumpPosMax: number | null;
  /** The bone that made the largest jump */
  jumpBone: string | null;
  jumpRotMax: number | null;
  inputJumpMax: number | null;
  /** The largest bone change beyond the largest change of the input in the same frame (cm) */
  jumpExcessMax: number | null;
  twistMax: number | null;
  twistChestHeadMax: number | null;
  /** How far the hips faced away from the headset's yaw: the most, and at the motion's end */
  bodyTurnMax: number | null;
  bodyTurnEnd: number | null;
  nanFrames: number;
  /** The new solver's ratio and the root bone's scale, at the motion's end (1: the model's own size) */
  modelRatio: number | null;
  rootScale: number | null;
};

export function summariseIk(frames: IkFrame[]): IkSummary {
  const col = (f: IkField) => frames.map(x => x[f]).filter(finite);
  const both = (a: IkField, b: IkField) => [...col(a), ...col(b)];
  const wrong = (bendA: IkField, sideA: IkField, bendB: IkField, sideB: IkField) =>
    frames.filter(x => [[bendA, sideA], [bendB, sideB]].some(([b, s]) => finite(x[b as IkField]) && finite(x[s as IkField]) && (x[b as IkField] as number) >= MIN_BEND_DEG && (x[s as IkField] as number) > WRONG_SIDE_DEG)).length;
  const bentSides = (bend: IkField, side: IkField) => frames.filter(x => finite(x[bend]) && (x[bend] as number) >= MIN_BEND_DEG && finite(x[side])).map(x => x[side] as number);
  const feet = both("footL", "footR");
  const excess = frames.filter(x => finite(x.jumpPos) && finite(x.inputJump)).map(x => (x.jumpPos as number) - (x.inputJump as number));
  const ratios = col("modelRatio");
  const roots = col("rootScale");
  return {
    frames: frames.length,
    vrFrames: frames.filter(x => x.isVR === 1).length,
    handErrMean: r2(mean(both("handErrL", "handErrR"))),
    handErrP95: r2(p95(both("handErrL", "handErrR"))),
    handErrMax: r2(max(both("handErrL", "handErrR"))),
    handRotErrMean: r2(mean(both("handRotErrL", "handRotErrR"))),
    handRotErrMax: r2(max(both("handRotErrL", "handRotErrR"))),
    wristMax: r2(max(both("wristL", "wristR"))),
    eyeErrMean: r2(mean(col("eyeErr"))),
    eyeErrMax: r2(max(col("eyeErr"))),
    eyeErrSlackMean: r2(mean(col("eyeErrSlack"))),
    eyeErrSlackMax: r2(max(col("eyeErrSlack"))),
    eyeDyMean: r2(mean(col("eyeDy"))),
    eyeHeightMean: (() => {
      const v = mean(col("eyeHeight"));
      return v === null ? null : +v.toFixed(4);
    })(),
    headDirErrMean: r2(mean(col("headDirErr"))),
    headDirErrMax: r2(max(col("headDirErr"))),
    elbowWrong: wrong("elbowBendL", "elbowSideL", "elbowBendR", "elbowSideR"),
    elbowSideMax: r2(max([...bentSides("elbowBendL", "elbowSideL"), ...bentSides("elbowBendR", "elbowSideR")])),
    kneeWrong: wrong("kneeBendL", "kneeSideL", "kneeBendR", "kneeSideR"),
    kneeSideMax: r2(max([...bentSides("kneeBendL", "kneeSideL"), ...bentSides("kneeBendR", "kneeSideR")])),
    footMin: r2(min(feet)),
    belowFloorFrames: frames.filter(x => [x.footL, x.footR].some(v => finite(v) && v < -BELOW_FLOOR_CM)).length,
    footMax: r2(max(feet)),
    slide: +both("slideL", "slideR").reduce((a, v) => a + v, 0).toFixed(2),
    jumpPosMax: r2(max(col("jumpPos"))),
    jumpBone: (() => {
      let best: IkFrame | null = null;
      for (const x of frames) if (finite(x.jumpPos) && (!best || (x.jumpPos as number) > (best.jumpPos as number))) best = x;
      return best && finite(best.jumpBone) ? (IK_BODY_BONES[best.jumpBone as number] ?? null) : null;
    })(),
    jumpRotMax: r2(max(col("jumpRot"))),
    inputJumpMax: r2(max(col("inputJump"))),
    jumpExcessMax: r2(max(excess)),
    twistMax: r2(max(col("twistHipsChest").map(Math.abs))),
    twistChestHeadMax: r2(max(col("twistChestHead").map(Math.abs))),
    bodyTurnMax: r2(max(col("bodyTurn").map(Math.abs))),
    bodyTurnEnd: (() => {
      const v = col("bodyTurn");
      return v.length ? r2(Math.abs(v[v.length - 1])) : null;
    })(),
    nanFrames: frames.filter(x => (x.nan ?? 0) > 0).length,
    modelRatio: ratios.length ? ratios[ratios.length - 1] : null,
    rootScale: roots.length ? roots[roots.length - 1] : null
  };
}

/** CSV of IK frames: one row per frame, with the series' labels in front */
export function ikCsv(rows: { labels: Record<string, string>; frames: IkFrame[] }[]): string {
  const labelKeys = rows.length ? Object.keys(rows[0].labels) : [];
  const lines = [[...labelKeys, ...IK_FIELDS].join(",")];
  for (const { labels, frames } of rows) {
    const front = labelKeys.map(k => JSON.stringify(labels[k] ?? "")).join(",");
    for (const f of frames) lines.push(`${front},${IK_FIELDS.map(k => (f[k] === null ? "" : k === "t" ? (f[k] as number).toFixed(2) : f[k])).join(",")}`);
  }
  return lines.join("\n") + "\n";
}

// ---------- Known answers ----------

export type SelfTestCase = { name: string; expected: string; got: string; ok: boolean };

/** Runs the page's maths (IK_MATH) in Node against cases whose answers are known */
export function ikSelfTest(): SelfTestCase[] {
  const M = new Function(`${IK_MATH}; return IkMath;`)();
  const cases: SelfTestCase[] = [];
  const near = (a: number[], b: number[], tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  const fmt = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "number" ? +x.toFixed(4) : x));
  const check = (name: string, expected: unknown, got: unknown, ok: boolean) => cases.push({ name, expected: fmt(expected), got: fmt(got), ok });

  // A rig at (1, 0, 2) turned 90° to the left: a hand 0.25 m right, 1.2 m up and 0.35 m ahead in the rig's
  // space is 0.35 m toward -x (ahead after the turn), 0.25 m toward -z (right after the turn)
  const yaw90 = M.qFromEulerYXZ(0, Math.PI / 2, 0);
  const world = M.rigToWorld([1, 0, 2], yaw90, [0.25, 1.2, -0.35]);
  check("rig to room: (0.25, 1.2, -0.35) in a rig at (1, 0, 2) turned 90° left", [0.65, 1.2, 1.75], world, near(world, [0.65, 1.2, 1.75]));
  const back = M.worldToRig([1, 0, 2], yaw90, world);
  check("room to rig: the inverse of the above", [0.25, 1.2, -0.35], back, near(back, [0.25, 1.2, -0.35]));
  const ahead = M.qRot(yaw90, [0, 0, -1]);
  check("YXZ yaw 90°: the facing -z turns to -x", [-1, 0, 0], ahead, near(ahead, [-1, 0, 0]));
  check("yaw of -x is +90°", 90, M.yawOf([-1, 0, 0]) * M.RAD, Math.abs(M.yawOf([-1, 0, 0]) * M.RAD - 90) < 1e-9);
  const pitchUp = M.qRot(M.qFromEulerYXZ(Math.PI / 6, 0, 0), [0, 0, -1]);
  check("YXZ pitch 30°: the facing tilts up", [0, 0.5, -Math.sqrt(3) / 2], pitchUp, near(pitchUp, [0, 0.5, -Math.sqrt(3) / 2]));
  // The order: yaw 90° then pitch 30° looks to the left and up (YXZ applies yaw last)
  const yawPitch = M.qRot(M.qFromEulerYXZ(Math.PI / 6, Math.PI / 2, 0), [0, 0, -1]);
  check("YXZ yaw 90° with pitch 30°: left and up", [-Math.sqrt(3) / 2, 0.5, 0], yawPitch, near(yawPitch, [-Math.sqrt(3) / 2, 0.5, 0]));
  check("turn between orientations: 90° yaw", 90, M.qAngle([0, 0, 0, 1], yaw90), Math.abs(M.qAngle([0, 0, 0, 1], yaw90) - 90) < 1e-9);

  // An arm along +x (shoulder to elbow), folding forward (-z): bent 90°, on the right side (0°)
  const forwardFold = M.bendSide([0, 1.4, 0], [0.3, 1.4, 0], [0.3, 1.4, -0.3], [0, 0, -1]);
  check("elbow folding forward: bend 90°, side 0°", [90, 0], forwardFold, near(forwardFold, [90, 0], 1e-6));
  const backFold = M.bendSide([0, 1.4, 0], [0.3, 1.4, 0], [0.3, 1.4, 0.3], [0, 0, -1]);
  check("elbow folding backward: side 180° (wrong side)", [90, 180], backFold, near(backFold, [90, 180], 1e-6));
  const upFold = M.bendSide([0, 1.4, 0], [0.3, 1.4, 0], [0.3, 1.7, 0], [0, 0, -1]);
  check("elbow folding upward: side 90° (sideways)", [90, 90], upFold, near(upFold, [90, 90], 1e-6));
  const straight = M.bendSide([0, 1.4, 0], [0.3, 1.4, 0], [0.6, 1.4, 0], [0, 0, -1]);
  check("straight arm: no side", [0, null], straight, straight[0] < 1e-6 && straight[1] === null);
  // A leg with the knee forward and the shin folding back (+z) toward the anatomical back: right side
  const knee = M.bendSide([0.1, 0.9, 0], [0.1, 0.5, -0.15], [0.1, 0.1, 0], [0, 0, 1]);
  const expectedBend = (Math.acos((0.4 * 0.4 - 0.15 * 0.15) / (0.4 * 0.4 + 0.15 * 0.15)) * 180) / Math.PI;
  check("knee forward, shin back: side 0°", [expectedBend, 0], knee, near(knee, [expectedBend, 0], 1e-6));
  const kneeBack = M.bendSide([0.1, 0.9, 0], [0.1, 0.5, 0.15], [0.1, 0.1, 0], [0, 0, 1]);
  check("knee bent backward: side 180° (wrong side)", [expectedBend, 180], kneeBack, near(kneeBack, [expectedBend, 180], 1e-6));
  // The fold direction carried by a turned upper bone: an upper arm turned 90° about its own axis (+x)
  // carries the forward fold to point down; a forearm folding down is then on the right side
  const twistedFold = M.qRot(M.qAxisAngle([1, 0, 0], -Math.PI / 2), [0, 0, -1]);
  const twisted = M.bendSide([0, 1.4, 0], [0.3, 1.4, 0], [0.3, 1.1, 0], twistedFold);
  check("upper arm twisted 90°: the fold turns with it", [90, 0], twisted, near(twisted, [90, 0], 1e-6));
  return cases;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("probes/ik.ts") && process.argv[2] === "selftest") {
  const cases = ikSelfTest();
  for (const c of cases) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: expected ${c.expected}, got ${c.got}`);
  process.exit(cases.every(c => c.ok) ? 0 : 1);
}
