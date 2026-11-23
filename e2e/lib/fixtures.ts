// e2e/fixtures.json: the accounts, the scene and the rooms of plan 1.5 on this machine.
// setup/create-fixtures.ts writes it; tests read it. Git ignores it (fixtures.example.json shows the shape).
import fs from "node:fs";
import { FIXTURES_FILE } from "./env";

export type AccountName = "admin" | "member1" | "member2";
export type MediaServer = "dialog" | "livekit";
/** reticulum's hubs.sfu column and APP.sfu.sfuId */
export const SFU_ID: Record<MediaServer, number> = { dialog: 0, livekit: 2 };

export type RoomName =
  | "dialog-main"
  | "livekit-main"
  | "switch"
  | "move-target-dialog"
  | "move-target-livekit"
  | "speak-x"
  | "listen-y"
  | "listen-z"
  | "nimpro"
  | "bitecs";

export type Account = { email: string; accountId: string; isAdmin: boolean };

export type Room = {
  hubId: string;
  owner: AccountName;
  mediaServer: MediaServer;
  sceneId?: string;
  /** What a later step still has to set up on this room */
  todo?: string;
};

export type SceneFixture = { sceneId: string; name: string; modelUrl: string; source: string };

export type Fixtures = {
  host: string;
  /** The Crater scene most rooms use */
  scene?: SceneFixture;
  /** Every published scene: crater, and nimpro (the N-impro set) */
  scenes?: Record<string, SceneFixture>;
  accounts: Record<AccountName, Account>;
  rooms: Record<RoomName, Room>;
  /** Rooms of the step 2 trials, kept for the trial scripts */
  trials?: Record<string, string>;
};

export function readFixtures(): Fixtures {
  if (!fs.existsSync(FIXTURES_FILE)) throw new Error("e2e/fixtures.json is missing: run npx tsx setup/create-fixtures.ts");
  return JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8"));
}

export function writeFixtures(fixtures: Fixtures) {
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2) + "\n");
}

/** A room of plan 1.5; throws when the fixture script has not created it yet */
export function room(name: RoomName): Room {
  const r = readFixtures().rooms[name];
  if (!r?.hubId) throw new Error(`room ${name} has no hub id in fixtures.json: run npx tsx setup/create-fixtures.ts`);
  return r;
}
