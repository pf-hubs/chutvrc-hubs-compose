// Session probe (plan 3.2): what the client's media server session reports, read from APP.sfu through
// the capability layer (probes/compat.ts), so it reads the same on the session and the adapter builds.
import type { Page } from "@playwright/test";

export type Session = {
  /** 0 Dialog, 2 LiveKit; null before the session exists */
  sfuId: number | null;
  isConnected: boolean;
  clientId: string;
  hubId: string | null;
  /** readyState of the local microphone track: "live", "ended" or null when there is none */
  micTrack: string | null;
  micEnabled: boolean | null;
  isRecording: boolean | null;
  /** performance.timeOrigin: changes only when the page is loaded again */
  pageLoadedAt: number;
  url: string;
};

export function readSession(page: Page): Promise<Session> {
  return page.evaluate(() => (window as any).__e2eApi.session());
}

export type Peers = {
  /** Other clients whose avatar model this client loaded (avatar sync), i.e. whose avatar it draws */
  models: string[];
  /** Other clients whose pose this client holds */
  poses: string[];
  /** Networked avatar entities besides the own rig (NAF) */
  avatarEntities: number;
};

/** The other clients this client knows of, three ways */
export function readPeers(page: Page): Promise<Peers> {
  return page.evaluate(() => {
    const api = (window as any).__e2eApi;
    const own = api.clientId();
    return {
      models: [...api.modelEids().keys()].filter((id: string) => id !== own),
      poses: api.poseIds().filter((id: string) => id !== own),
      avatarEntities: [...document.querySelectorAll("[networked-avatar]")].filter(el => el.id !== "avatar-rig").length
    };
  });
}

/** Whether `page` draws `clientId`'s avatar: a model entity whose object and every parent are visible */
export function drawsAvatar(page: Page, clientId: string): Promise<{ model: boolean; visible: boolean }> {
  return page.evaluate(clientId => {
    const APP = (window as any).APP;
    const eid = (window as any).__e2eApi.modelEids().get(clientId);
    if (eid === undefined) return { model: false, visible: false };
    let visible = true;
    for (let o = APP.world.eid2obj.get(eid); o; o = o.parent) if (!o.visible) visible = false;
    return { model: true, visible };
  }, clientId);
}

/**
 * Frame rate over `ms` (plan 2.2: measured before each test; below 55 fps on DESK or QUEST the run is
 * invalid). Both requestAnimationFrame callbacks and frames the renderer drew.
 */
export function measureFrameRate(page: Page, ms = 3000): Promise<{ raf: number; rendered: number }> {
  return page.evaluate(
    ms =>
      new Promise<{ raf: number; rendered: number }>(resolve => {
        const renderer = (window as any).AFRAME?.scenes?.[0]?.renderer;
        const f0 = renderer?.info?.render?.frame ?? 0;
        let n = 0;
        const t0 = performance.now();
        const tick = (t: number) => {
          n++;
          if (t - t0 < ms) return requestAnimationFrame(tick);
          const s = (t - t0) / 1000;
          resolve({ raf: +(n / s).toFixed(1), rendered: +(((renderer?.info?.render?.frame ?? 0) - f0) / s).toFixed(1) });
        };
        requestAnimationFrame(tick);
      }),
    ms
  );
}

export const MIN_FRAME_RATE = 55;

/** The audio and video tracks `page` keeps for another client (its remote stream, or the adapter's consumers) */
export function remoteTracks(page: Page, clientId: string): Promise<{ audio: string[]; video: string[] }> {
  return page.evaluate(clientId => {
    const tracks: MediaStreamTrack[] = (window as any).__e2eApi.remoteTracks(clientId);
    const describe = (t: MediaStreamTrack) => `${t.id.slice(0, 8)} ${t.readyState}${t.muted ? " muted" : ""}`;
    return { audio: tracks.filter(t => t.kind === "audio").map(describe), video: tracks.filter(t => t.kind === "video").map(describe) };
  }, clientId);
}
