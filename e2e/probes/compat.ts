// Capability layer (plan step 5, section 6): the probes read the client from outside, and what they read
// differs between builds of the client.
//
// - "session" build (feature/sfu-refactor and later): APP.sfu is an SfuSession with sfuId, isConnected,
//   bus (the data channel bus and its recording), media (remote streams) and avatarSync; from the avatar
//   refactor on, APP.avatarPoses holds every client's pose with the sender's sequence number.
// - "adapter" build (develop and older): APP.sfu is the media server adapter itself, with _sfuId,
//   _avatarSyncHelper (avatar models in _client2AvatarEid, the last received #avatar-RIG/HEAD/LEFT/RIGHT
//   transforms in _client2Transform), _isRecording and _recordedDataChannelMessages.
//
// COMPAT_SHIM, an init script every client gets (clients/launch.ts, clients/bot.ts), puts window.__e2eApi
// into the page: the readings that mean the same on both builds (session state, remote tracks, which
// remote avatar models are drawn, poses, the own avatar announcement). The probes call it instead of
// APP.sfu directly. What only one build has (the packet log of the data channel bus, the IK probe) throws
// NotApplicable on the other, and a check that meets it is recorded as "not applicable on this build"
// (report/evidence.ts), not as OK or NG.
import type { Page } from "@playwright/test";

/**
 * Page code (an init script; it only reads APP when called). On the adapter build a pose has no sequence
 * number: each #avatar-RIG packet is decoded into a new transform object, so the shim numbers the distinct
 * objects it has seen for a client, and "seq" there counts packets the probe saw arrive between readings.
 */
export const COMPAT_SHIM = `(() => {
  if (window.__e2eApi) return;
  const sfu = () => (window.APP ? window.APP.sfu : undefined);
  const has = (o, key) => o !== null && o !== undefined && typeof o === "object" && key in o;
  const vec = v => (v ? { x: v.x, y: v.y, z: v.z } : { x: 0, y: 0, z: 0 });
  // The adapter build's avatar sync helper (also what feature/sfu-refactor's session hands out as avatarSync)
  const helper = () => {
    const s = sfu();
    if (!s) return undefined;
    if (s._avatarSyncHelper) return s._avatarSyncHelper;
    const sync = has(s, "avatarSync") ? s.avatarSync : undefined;
    return sync && sync._client2Transform ? sync : undefined;
  };
  const seen = new WeakMap();
  const counters = new Map();
  const legacySeq = (clientId, transform) => {
    if (!transform) return null;
    if (!seen.has(transform)) {
      const n = (counters.get(clientId) || 0) + 1;
      counters.set(clientId, n);
      seen.set(transform, n);
    }
    return seen.get(transform);
  };
  const api = {
    /** "session" (APP.sfu is an SfuSession), "adapter" (APP.sfu is the adapter itself), null before APP.sfu exists */
    kind() {
      const s = sfu();
      if (!s) return null;
      return has(s, "bus") || has(s, "media") ? "session" : "adapter";
    },
    capabilities() {
      const kind = api.kind();
      const APP = window.APP || {};
      return {
        kind,
        packetLog: kind === "session",
        poseStore: !!APP.avatarPoses,
        poseSequence: !!APP.avatarPoses,
        ik: !!(APP.world && APP.world.eid2Ik)
      };
    },
    sfuId() {
      const s = sfu();
      if (!s) return null;
      const id = has(s, "sfuId") ? s.sfuId : s._sfuId;
      return id === undefined ? null : id;
    },
    clientId() {
      const s = sfu();
      return (s && (s.clientId || s._clientId)) || "";
    },
    isConnected() {
      const s = sfu();
      if (!s) return false;
      if (has(s, "isConnected")) return !!s.isConnected;
      // The adapter build has no isConnected: Dialog counts as connected once it has a send transport (what
      // the session build's Dialog adapter reads), LiveKit while its room is connected
      if (s._sfuId === 0) return !!s._sendTransport && !(s._sendTransport.closed || s._sendTransport._closed);
      if (has(s, "_room")) return !!s._room && s._room.state === "connected";
      return s.connectionState === "connected";
    },
    isRecording() {
      const s = sfu();
      if (!s) return null;
      if (has(s, "bus")) return s.bus ? !!s.bus.isRecording : null;
      return s._isRecording === undefined ? null : !!s._isRecording;
    },
    session() {
      const s = sfu();
      const APP = window.APP;
      const mic = s && s.getLocalMicTrack ? s.getLocalMicTrack() : undefined;
      return {
        sfuId: api.sfuId(),
        isConnected: api.isConnected(),
        clientId: api.clientId(),
        hubId: (APP && APP.hub && APP.hub.hub_id) || null,
        micTrack: (mic && mic.readyState) || null,
        micEnabled: s && s.isMicEnabled !== undefined ? s.isMicEnabled : null,
        isRecording: api.isRecording(),
        pageLoadedAt: performance.timeOrigin,
        url: location.href
      };
    },
    /** The tracks this client keeps for another client's media (audio and video) */
    remoteTracks(clientId) {
      const s = sfu();
      if (!s) return [];
      if (has(s, "media")) {
        const stream = s.media && s.media.remoteStream(clientId);
        return stream ? stream.getTracks() : [];
      }
      if (s._remoteMediaStreams) {
        const stream = s._remoteMediaStreams.get(clientId);
        return stream ? stream.getTracks() : [];
      }
      if (s._consumers) {
        const consumers = typeof s._consumers.values === "function" ? [...s._consumers.values()] : [...s._consumers];
        return consumers.filter(c => c && !c.closed && c.appData && c.appData.peerId === clientId && c.track).map(c => c.track);
      }
      return [];
    },
    /** Avatar entity per client whose model this client loaded (its own included) */
    modelEids() {
      const s = sfu();
      if (!s) return new Map();
      const sync = has(s, "avatarSync") ? s.avatarSync : undefined;
      if (sync && sync.models && sync.models.avatarEidByClientId) return sync.models.avatarEidByClientId;
      const h = helper();
      return (h && h._client2AvatarEid) || new Map();
    },
    /** Clients whose pose this client holds (its own included) */
    poseIds() {
      const APP = window.APP;
      if (APP && APP.avatarPoses) return [...APP.avatarPoses.poses.keys()];
      const h = helper();
      const rig = h && h._client2Transform && h._client2Transform.get("RIG");
      return rig ? [...rig.keys()] : [];
    },
    /** A client's pose: rig and head position and rotation (head in the rig's space), sequence, flags */
    pose(clientId) {
      const APP = window.APP;
      if (APP && APP.avatarPoses) {
        const p = APP.avatarPoses.get(clientId);
        if (!p) return null;
        return {
          rig: { pos: vec(p.rig.pos), rot: vec(p.rig.rot) },
          head: { pos: vec(p.head.pos), rot: vec(p.head.rot) },
          left: { pos: vec(p.leftHand.pos), rot: vec(p.leftHand.rot) },
          right: { pos: vec(p.rightHand.pos), rot: vec(p.rightHand.rot) },
          seq: p.seq,
          tracked: p.tracked,
          isVR: p.isVR,
          animState: p.animState === undefined ? null : p.animState,
          source: "pose store"
        };
      }
      const h = helper();
      const part = name => h && h._client2Transform && h._client2Transform.get(name) && h._client2Transform.get(name).get(clientId);
      const rig = part("RIG");
      if (!rig) return null;
      const head = part("HEAD");
      const left = part("LEFT");
      const right = part("RIGHT");
      const vr = h._client2VrMode && h._client2VrMode.get(clientId);
      const anim = h._client2AnimState && h._client2AnimState.get(clientId);
      return {
        rig: { pos: vec(rig.pos), rot: vec(rig.rot) },
        head: { pos: vec(head && head.pos), rot: vec(head && head.rot) },
        left: { pos: vec(left && left.pos), rot: vec(left && left.rot) },
        right: { pos: vec(right && right.pos), rot: vec(right && right.rot) },
        seq: legacySeq(clientId, rig),
        tracked: null,
        isVR: vr === undefined ? null : !!vr,
        animState: anim === undefined ? null : anim,
        source: "per-part transforms"
      };
    },
    /**
     * The own rig, head (#avatar-pov-node) and controllers as the scene has them (local transforms; the head
     * and controllers are children of the rig): what the own pose is sampled from, on every build
     */
    ownObjects() {
      const object = selector => {
        const el = document.querySelector(selector);
        return el && el.object3D;
      };
      const rig = object("#avatar-rig");
      if (!rig) return null;
      const part = o => (o ? { pos: vec(o.position), rot: vec(o.rotation), visible: !!o.visible } : null);
      return { rig: part(rig), head: part(object("#avatar-pov-node")), left: part(object("#player-left-controller")), right: part(object("#player-right-controller")) };
    },
    /** Sends the own avatar announcement (#avatarId) again; false when there is no avatar sync */
    announceAvatar() {
      const s = sfu();
      const sync = s && (has(s, "avatarSync") ? s.avatarSync : s._avatarSyncHelper);
      if (!sync || typeof sync.sendSelfAvatarSrc !== "function") return false;
      sync.sendSelfAvatarSrc();
      return true;
    }
  };
  window.__e2eApi = api;
})();`;

/** Thrown by a probe that needs what this build of the client does not have; checks record it as not applicable */
export class NotApplicable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotApplicable";
  }
}

export const isNotApplicable = (e: unknown) => e instanceof NotApplicable || (e as Error)?.name === "NotApplicable";

export type Capabilities = {
  /** "session": APP.sfu is an SfuSession; "adapter": APP.sfu is the media server adapter (develop and older) */
  kind: "session" | "adapter" | null;
  /** APP.sfu.bus.startRecording()/takeRecording(): the packet log (probes/packets.ts) */
  packetLog: boolean;
  /** APP.avatarPoses: per-frame poses in one store */
  poseStore: boolean;
  /** Poses carry the sender's sequence number (on the adapter build, seq counts packets seen arriving) */
  poseSequence: boolean;
  /** APP.world.eid2Ik: the IK probe */
  ik: boolean;
};

export function capabilities(page: Page): Promise<Capabilities> {
  return page.evaluate(() => (window as any).__e2eApi.capabilities());
}

/** Throws NotApplicable when the page's build lacks `capability`; `what` names the probe for the report */
export async function requireCapability(page: Page, capability: Exclude<keyof Capabilities, "kind">, what: string) {
  const caps = await capabilities(page);
  if (!caps[capability]) throw new NotApplicable(`${what} needs ${CAPABILITY_TEXT[capability]}, which this build (${caps.kind ?? "no APP.sfu"}) does not have`);
}

const CAPABILITY_TEXT: Record<Exclude<keyof Capabilities, "kind">, string> = {
  packetLog: "the data channel bus's recording (APP.sfu.bus)",
  poseStore: "the pose store (APP.avatarPoses)",
  poseSequence: "pose sequence numbers (APP.avatarPoses)",
  ik: "the IK solvers (APP.world.eid2Ik)"
};

/** The label avatar poses travel on: one #avatar-pose packet per frame, or #avatar-RIG (and HEAD, LEFT, RIGHT) */
export const poseLabel = (caps: Capabilities) => (caps.poseStore ? "#avatar-pose" : "#avatar-RIG");

/** Page code for waitForFunction: the page's media server session is connected */
export const IS_CONNECTED = () => !!(window as any).__e2eApi?.isConnected();
