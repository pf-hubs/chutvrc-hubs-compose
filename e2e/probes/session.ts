// Session probe (plan 3.2): what the client's media server session reports, read from APP.sfu.
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
  return page.evaluate(() => {
    const APP = (window as any).APP;
    const sfu = APP?.sfu;
    return {
      sfuId: sfu?.sfuId ?? null,
      isConnected: !!sfu?.isConnected,
      clientId: sfu?.clientId ?? "",
      hubId: APP?.hub?.hub_id ?? null,
      micTrack: sfu?.getLocalMicTrack?.()?.readyState ?? null,
      micEnabled: sfu?.isMicEnabled ?? null,
      isRecording: sfu?.bus?.isRecording ?? null,
      pageLoadedAt: performance.timeOrigin,
      url: location.href
    };
  });
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
    const APP = (window as any).APP;
    const own = APP.sfu?.clientId;
    const models: Map<string, number> | undefined = APP.sfu?.avatarSync?.models?.avatarEidByClientId;
    const poses: Map<string, unknown> | undefined = APP.avatarPoses?.poses;
    return {
      models: models ? [...models.keys()].filter(id => id !== own) : [],
      poses: poses ? [...poses.keys()].filter(id => id !== own) : [],
      avatarEntities: [...document.querySelectorAll("[networked-avatar]")].filter(el => el.id !== "avatar-rig").length
    };
  });
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

/** The audio and video tracks `page` keeps for another client (the remote stream of its media session) */
export function remoteTracks(page: Page, clientId: string): Promise<{ audio: string[]; video: string[] }> {
  return page.evaluate(clientId => {
    const stream: MediaStream | undefined = (window as any).APP?.sfu?.media?.remoteStream(clientId);
    const describe = (t: MediaStreamTrack) => `${t.id.slice(0, 8)} ${t.readyState}${t.muted ? " muted" : ""}`;
    return { audio: stream?.getAudioTracks().map(describe) ?? [], video: stream?.getVideoTracks().map(describe) ?? [] };
  }, clientId);
}
