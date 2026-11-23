// The media server block of a run (plan 1.4) and switching the server-wide LiveKit setting.
//
// Which LiveKit server rooms set to LiveKit use is a server setting (admin > Server Settings > WEBRTC:
// "LiveKit Server URL", "LiveKit API Key", "LiveKit API Secret"), kept in ret0.server_configs as
// webrtc-settings|livekit_server_url, _api_key and _api_secret, each {"value": ...}. Reticulum reads them
// through a cache and builds its content security policy from the URL, so a change takes a restart.
//
// A run picks its block with MEDIA_BLOCK:
//   dialog          Dialog rooms only; the LiveKit setting is left as it is (default)
//   livekit-local   the local server, wss://hubs.local:7443 with devkey / secret (docker-compose.e2e.yml)
//   livekit-cloud   the LiveKit Cloud project of LIVEKIT_CLOUD_URL, _KEY and _SECRET in e2e/.env.local
// Tests marked for LiveKit run in whichever LiveKit block is active and are skipped in the Dialog block;
// tests marked for Dialog run in the Dialog block. The global setup switches the server to the block and
// the global teardown puts back what it found (MEDIA_BLOCK_RESTORE=0 leaves the block switched on).
//
// Key and secret are never printed or written anywhere but the database and .env.local.
//   npx tsx lib/livekit.ts show | local | cloud | unset | read
import fs from "node:fs";
import path from "node:path";
import { E2E } from "./env";
import { restartReticulum, sql, sqlText } from "./stack";

export type MediaBlock = "dialog" | "livekit-local" | "livekit-cloud";
export type LiveKitBlock = "local" | "cloud" | "unset";

export const MEDIA_BLOCKS: MediaBlock[] = ["dialog", "livekit-local", "livekit-cloud"];

const KEYS = {
  url: "webrtc-settings|livekit_server_url",
  key: "webrtc-settings|livekit_api_key",
  secret: "webrtc-settings|livekit_api_secret"
} as const;

type LiveKitValues = Record<keyof typeof KEYS, string>;

export const LOCAL_LIVEKIT: LiveKitValues = { url: "wss://hubs.local:7443", key: "devkey", secret: "secret" };

const ENV_FILE = path.join(E2E, ".env.local");

/** The block this run uses, from MEDIA_BLOCK; "dialog" when it is not set */
export function mediaBlock(): MediaBlock {
  const value = (process.env.MEDIA_BLOCK ?? "dialog").trim();
  if (!MEDIA_BLOCKS.includes(value as MediaBlock)) {
    throw new Error(`MEDIA_BLOCK=${value} is not one of ${MEDIA_BLOCKS.join(", ")}`);
  }
  return value as MediaBlock;
}

/** The LiveKit server setting a block needs; null for the Dialog block, which needs none */
export function liveKitBlockFor(block: MediaBlock): LiveKitBlock | null {
  return block === "livekit-local" ? "local" : block === "livekit-cloud" ? "cloud" : null;
}

function readValues(): Partial<LiveKitValues> {
  const rows = sql(`select key, value->>'value' from ret0.server_configs where key like 'webrtc-settings|livekit_%'`);
  const byKey = new Map(
    rows
      .split("\n")
      .filter(Boolean)
      .map(r => r.split("\t") as [string, string])
  );
  return { url: byKey.get(KEYS.url), key: byKey.get(KEYS.key), secret: byKey.get(KEYS.secret) };
}

/**
 * Which LiveKit server the server settings point at. The URL is given for the local server only: the
 * Cloud URL names the project and is kept out of logs and evidence like the key and secret.
 */
export function activeLiveKitBlock(): { block: LiveKitBlock; url: string | null } {
  const url = readValues().url || null;
  const block: LiveKitBlock = !url ? "unset" : url === LOCAL_LIVEKIT.url ? "local" : "cloud";
  return { block, url: block === "local" ? url : null };
}

/** The LIVEKIT_CLOUD_* values of .env.local; throws when they are missing */
function cloudValues(): LiveKitValues {
  const env = readEnvFile();
  if (!env.LIVEKIT_CLOUD_URL || !env.LIVEKIT_CLOUD_KEY || !env.LIVEKIT_CLOUD_SECRET) {
    throw new Error("LIVEKIT_CLOUD_URL, LIVEKIT_CLOUD_KEY and LIVEKIT_CLOUD_SECRET are needed in e2e/.env.local for the LiveKit Cloud block");
  }
  return { url: env.LIVEKIT_CLOUD_URL, key: env.LIVEKIT_CLOUD_KEY, secret: env.LIVEKIT_CLOUD_SECRET };
}

function readEnvFile(): Record<string, string> {
  if (!fs.existsSync(ENV_FILE)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(ENV_FILE, "utf8")
      .split(/\r?\n/)
      .filter(l => /^[A-Z_]+=/.test(l))
      .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
  );
}

/** Whether the LiveKit Cloud values are in .env.local (without reading them out) */
export function hasCloudValues(): boolean {
  const env = readEnvFile();
  return !!(env.LIVEKIT_CLOUD_URL && env.LIVEKIT_CLOUD_KEY && env.LIVEKIT_CLOUD_SECRET);
}

/**
 * Points the server's LiveKit setting at a block (or removes it) and restarts reticulum, as saving the
 * WEBRTC tab and restarting by hand does. Does nothing when the setting is already there.
 */
export async function setLiveKitBlock(block: LiveKitBlock): Promise<{ changed: boolean }> {
  const current = readValues();
  if (block === "unset") {
    if (!current.url && !current.key && !current.secret) return { changed: false };
    sql(`delete from ret0.server_configs where key like 'webrtc-settings|livekit_%'`);
  } else {
    const wanted = block === "local" ? LOCAL_LIVEKIT : cloudValues();
    if (current.url === wanted.url && current.key === wanted.key && current.secret === wanted.secret) return { changed: false };
    for (const name of ["url", "key", "secret"] as const) {
      sql(
        `insert into ret0.server_configs (key, value, inserted_at, updated_at) values (${sqlText(KEYS[name])}, ${sqlText(JSON.stringify({ value: wanted[name] }))}::jsonb, now(), now()) ` +
          `on conflict (key) do update set value = excluded.value, updated_at = now()`
      );
    }
  }
  await restartReticulum();
  return { changed: true };
}

/** Saves the current values to .env.local as LIVEKIT_CLOUD_* when they are a Cloud block and none are saved yet */
function saveCurrentAsCloud(): string {
  const v = readValues();
  if (readEnvFile().LIVEKIT_CLOUD_URL) return "LIVEKIT_CLOUD_* already in .env.local; not overwritten";
  if (!v.url || v.url === LOCAL_LIVEKIT.url) return "the server has no Cloud block set; nothing saved";
  fs.appendFileSync(
    ENV_FILE,
    `\n# LiveKit Cloud block, saved from reticulum's server settings\nLIVEKIT_CLOUD_URL=${v.url}\nLIVEKIT_CLOUD_KEY=${v.key ?? ""}\nLIVEKIT_CLOUD_SECRET=${v.secret ?? ""}\n`
  );
  return "saved the Cloud block to .env.local";
}

function describe(): string {
  const v = readValues();
  const { block, url } = activeLiveKitBlock();
  const shown = block === "cloud" ? "(the Cloud project's)" : url ?? "(unset)";
  return `LiveKit block ${block}: url ${shown}, key ${v.key ? "set" : "(unset)"}, secret ${v.secret ? "set" : "(unset)"}`;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("lib/livekit.ts")) {
  const command = process.argv[2] ?? "show";
  if (command === "local" || command === "cloud" || command === "unset") {
    const { changed } = await setLiveKitBlock(command);
    console.log(`${changed ? "switched, reticulum restarted" : "already set"}; ${describe()}`);
  } else if (command === "read") {
    console.log(saveCurrentAsCloud());
  } else {
    console.log(describe());
  }
}
