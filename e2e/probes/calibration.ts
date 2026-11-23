// The body calibration (fix F4), read from outside the page: what a wearer's page applied (the rig's scale, the
// view's height in the room, what it sends and announces) and how an observer's page draws another client (the
// announced eye height it holds, the VR solver's ratio, the root bone's scale, which solver drew it). Read-only;
// the client logs its captures to the console, which the harness already collects. The wearer's own head bone
// is shrunk in first person (apply-to-bones.ts), so its view is read from the point of view node, and the drawn
// eyes only from an observer.
import type { Page } from "@playwright/test";
import type { Client } from "../clients/launch";

/** A standing person's eyes over their height (EYE_HEIGHT_SHARE of the client's body-calibration.ts) */
export const EYE_HEIGHT_SHARE = 0.936;

export type BodyState = {
  /** The observer has a model for the client */
  eid: number | null;
  /** The standing eye height the client announced, in room metres, as this page holds it; null when none */
  announced: number | null;
  /** The solver's ratio for the model (ikState.modelRatio); null before the solver ran on it */
  modelRatio: number | null;
  /** Which solver drew it last: "vr", "screen" or "npc"; null before the first frame */
  solver: string | null;
  /** The root bone's scale: the size the model is drawn at over its own */
  rootScale: number | null;
  /** The model's eye height at its own size, in metres (AvatarIkManager.modelEyeHeight) */
  modelEye: number | null;
  /** The head height in the pose this page holds for the client, in the rig's space */
  headY: number | null;
};

/** How `page` draws `clientId`'s avatar */
export function bodyState(page: Page, clientId: string): Promise<BodyState> {
  return page.evaluate(id => {
    const APP = (window as any).APP;
    const eid = APP.sfu?.avatarSync?.models.avatarEidByClientId.get(id);
    const ik = eid === undefined ? null : APP.world.eid2Ik.get(eid);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? +v.toFixed(5) : null);
    return {
      eid: eid ?? null,
      announced: num(APP.avatarPoses.announcedEyeHeightOf(id)),
      modelRatio: num(ik?.ikState?.modelRatio),
      solver: ik?.ikState?.solver ?? null,
      rootScale: num(ik?.rig?.bones?.root?.scale?.y),
      modelEye: num(ik?.modelEyeHeight?.()),
      headY: num(APP.avatarPoses.get(id)?.head.pos.y)
    };
  }, clientId);
}

export type OwnView = {
  /** The rig's floor height and its uniform scale */
  rigY: number;
  rigScale: number;
  /** The view's height over the rig's floor in the room (the avatar's point of view, the left eye in VR) */
  viewHeight: number;
  /** The head height the page sends (rig space, room metres) and the right controller's */
  sentHeadY: number | null;
  sentRightY: number | null;
  /** The eye height it announces with its avatar, in room metres; null when none */
  announced: number | null;
  /** The emulated headset's own height (QUEST), real metres; null without IWER */
  deviceHeadY: number | null;
  /** Its own model's eye height at the model's size */
  ownModelEye: number | null;
  preferences: { bodyHeightCm: number; bodyPosture: string; bodyFit: string };
  inVr: boolean;
};

/** What the wearer's own page applied */
export function ownView(page: Page): Promise<OwnView> {
  return page.evaluate(() => {
    const APP = (window as any).APP;
    const T = (window as any).AFRAME.THREE;
    const scene = (window as any).AFRAME.scenes[0];
    const rig = (document.querySelector("#avatar-rig") as any).object3D;
    const pov = (document.querySelector("#avatar-pov-node") as any).object3D;
    rig.updateMatrixWorld(true);
    const w = new T.Vector3();
    pov.getWorldPosition(w);
    const pose = APP.avatarPoses.get(APP.sfu.clientId);
    const eid = APP.sfu.avatarSync?.models.avatarEidByClientId.get(APP.sfu.clientId);
    const ik = eid === undefined ? null : APP.world.eid2Ik.get(eid);
    const p = APP.store.state.preferences;
    const r = (v: unknown, d = 5) => (typeof v === "number" && Number.isFinite(v) ? +v.toFixed(d) : null);
    return {
      rigY: r(rig.position.y)!,
      rigScale: r(rig.scale.y)!,
      viewHeight: r(w.y - rig.position.y)!,
      sentHeadY: r(pose?.head.pos.y),
      sentRightY: r(pose?.rightHand.pos.y),
      announced: r(APP.avatarPoses.announcedEyeHeightOf(APP.sfu.clientId)),
      deviceHeadY: r((window as any).xrDevice?.position.y),
      ownModelEye: r(ik?.modelEyeHeight?.()),
      preferences: { bodyHeightCm: p.bodyHeightCm, bodyPosture: p.bodyPosture, bodyFit: p.bodyFit },
      inVr: scene.is("vr-mode")
    };
  });
}

export type CaptureEntry = { t: number; kind: "captured" | "timedOut"; height: number | null };

/** The page's capture results, from its console: "captured the headset at 1.620 m", or the warning that no capture was taken; `from` is an index into the log */
export function captureLog(client: Client, from = 0): CaptureEntry[] {
  const out: CaptureEntry[] = [];
  for (const e of client.log.slice(from)) {
    const m = /^Body calibration: captured the headset at ([\d.]+) m/.exec(e.text);
    if (m) out.push({ t: e.t, kind: "captured", height: Number(m[1]) });
    else if (/^Body calibration: no capture was taken/.test(e.text)) out.push({ t: e.t, kind: "timedOut", height: null });
  }
  return out;
}

export const XR_SESSION_MARK = "[e2e] XR session started";

/**
 * Logs XR_SESSION_MARK to the page's console whenever an immersive session starts, so the capture's
 * duration can be read off the same log clock as its result (the renderer's WebXR manager's sessionstart)
 */
export function markXrSessions(page: Page): Promise<void> {
  return page.evaluate(mark => {
    const xr = (window as any).AFRAME.scenes[0].renderer.xr;
    if ((window as any).__e2eXrMark) return;
    (window as any).__e2eXrMark = true;
    xr.addEventListener("sessionstart", () => console.log(mark));
  }, XR_SESSION_MARK);
}

/** The log time of the last session start mark at or after `from` */
export function lastSessionStart(client: Client, from = 0): number | null {
  const marks = client.log.slice(from).filter(e => e.text === XR_SESSION_MARK);
  return marks.length ? marks[marks.length - 1].t : null;
}
