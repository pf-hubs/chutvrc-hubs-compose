// Staging a subject for observers (T5): the subject's rig put at a fixed spot facing a fixed way, observers'
// cameras put at one spot looking at it, and the models that would stand in an observer's view hidden on
// that observer's page. Everything here moves the clients' own objects from outside (the rig, the pov node,
// an avatar model's placement), as the character controller and a user's look would; the client source is
// not changed.
import type { Page } from "@playwright/test";
import type { Client } from "./launch";

/** The sun's direction in the scene (the way its light travels), and the other lights */
export function sceneLights(page: Page): Promise<{ type: string; intensity: number; direction?: number[] }[]> {
  return page.evaluate(() => {
    const T = (window as any).AFRAME.THREE;
    const found: { type: string; intensity: number; direction?: number[] }[] = [];
    (window as any).AFRAME.scenes[0].object3D.traverse((o: any) => {
      if (!o.isLight) return;
      const entry: { type: string; intensity: number; direction?: number[] } = { type: o.type, intensity: o.intensity };
      if (o.isDirectionalLight) {
        const from = new T.Vector3().setFromMatrixPosition(o.matrixWorld);
        const to = new T.Vector3().setFromMatrixPosition(o.target.matrixWorld);
        const d = to.sub(from).normalize();
        entry.direction = [d.x, d.y, d.z].map((v: number) => +v.toFixed(3));
      }
      found.push(entry);
    });
    return found;
  });
}

/**
 * Puts the client's rig at (x, its current height, z) turned to `yawDeg` (0 faces -z), and its view straight
 * ahead with the given pitch (desktop: the pov node; in VR the headset sets the view). Any movement still
 * queued in the character controller is dropped.
 */
export async function placeRig(page: Page, x: number, z: number, yawDeg: number, pitchDeg = 0) {
  await page.evaluate(
    ({ x, z, yaw, pitch }) => {
      const scene = (window as any).AFRAME.scenes[0];
      const controller = scene.systems["hubs-systems"]?.characterController;
      if (controller) {
        controller.relativeMotion?.set(0, 0, 0);
        controller.nextRelativeMotion?.set(0, 0, 0);
        controller.dXZ = 0;
      }
      const rig = (document.querySelector("#avatar-rig") as any).object3D;
      rig.position.set(x, rig.position.y, z);
      rig.rotation.set(0, yaw, 0);
      rig.matrixNeedsUpdate = true;
      if (!scene.is("vr-mode")) {
        const pov = (document.querySelector("#avatar-pov-node") as any).object3D;
        pov.rotation.set(pitch, 0, 0);
        pov.matrixNeedsUpdate = true;
      }
    },
    { x, z, yaw: (yawDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 }
  );
}

export type Framing = {
  /** Where the subject stands and which way it faces (0: -z) */
  subject: { x: number; z: number; yawDeg: number };
  /** The observers' camera: distance from the subject, the bearing from the subject's facing (positive: to its left), the height it looks at */
  distance: number;
  bearingDeg: number;
  aimHeight: number;
};

/** The observers' rig position, yaw and pitch for a framing (a desktop camera is 1.6 m above its rig) */
export function observerPlace(f: Framing, eyeHeight = 1.6) {
  const facing = (f.subject.yawDeg * Math.PI) / 180;
  const bearing = facing + (f.bearingDeg * Math.PI) / 180;
  // The facing direction of yaw a is (-sin a, 0, -cos a)
  const x = f.subject.x - f.distance * Math.sin(bearing);
  const z = f.subject.z - f.distance * Math.cos(bearing);
  // Look back at the subject
  const yawDeg = (Math.atan2(-(f.subject.x - x), -(f.subject.z - z)) * 180) / Math.PI;
  const pitchDeg = (-Math.atan((eyeHeight - f.aimHeight) / f.distance) * 180) / Math.PI;
  return { x, z, yawDeg, pitchDeg };
}

/**
 * Hides, on the observer's page, every avatar model but the ones kept: they are moved 100 m under the floor
 * (the solvers write the bones relative to the model, so they stay there; the name tags, which follow the
 * neck, go with them). Used where observers stand at one spot and would otherwise see each other from inside.
 * Returns the client ids whose models were moved.
 */
export function hideAvatarsExcept(observer: Client, keep: string[]): Promise<string[]> {
  return observer.page.evaluate(keep => {
    const APP = (window as any).APP;
    const hidden: string[] = [];
    for (const [id, eid] of APP.sfu.avatarSync.models.avatarEidByClientId) {
      if (keep.includes(id)) continue;
      const model = APP.world.eid2obj.get(eid);
      if (!model) continue;
      model.position.y = -100;
      model.matrixNeedsUpdate = true;
      model.updateMatrix();
      hidden.push(id);
    }
    return hidden;
  }, keep);
}
