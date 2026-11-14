// Trial (d): switching the LiveKit server between the Cloud block and the local block (plan 1.4).
// The three keys live in reticulum's server config (table ret0.server_configs, value {"value": ...}),
// which admin > Server Settings > WEBRTC edits. Values are never printed.
//   npx tsx trials/d-livekit.ts read    # saves the current values to .env.local as LIVEKIT_CLOUD_* (once)
//   npx tsx trials/d-livekit.ts local   # wss://hubs.local:7443, devkey, secret; restarts reticulum
//   npx tsx trials/d-livekit.ts cloud   # back to the LIVEKIT_CLOUD_* values of .env.local; restarts reticulum
//   npx tsx trials/d-livekit.ts show    # which block is active (URL only)
import fs from "node:fs";
import path from "node:path";
import { request } from "@playwright/test";
import { BASE, E2E, compose, readFixtures, sql, writeFixtures } from "./common";

const KEYS = {
  url: "webrtc-settings|livekit_server_url",
  key: "webrtc-settings|livekit_api_key",
  secret: "webrtc-settings|livekit_api_secret"
} as const;
const LOCAL = { url: "wss://hubs.local:7443", key: "devkey", secret: "secret" };
const envFile = path.join(E2E, ".env.local");

function current(): Record<keyof typeof KEYS, string | null> {
  const rows = sql(`select key, value->>'value' from ret0.server_configs where key like 'webrtc-settings|livekit_%'`);
  const byKey = new Map(rows.split("\n").filter(Boolean).map(r => r.split("\t") as [string, string]));
  return { url: byKey.get(KEYS.url) ?? null, key: byKey.get(KEYS.key) ?? null, secret: byKey.get(KEYS.secret) ?? null };
}

function readEnv(): Record<string, string> {
  if (!fs.existsSync(envFile)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .filter(l => /^[A-Z_]+=/.test(l))
      .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  );
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

function write(values: { url: string; key: string; secret: string }) {
  for (const name of ["url", "key", "secret"] as const) {
    const json = JSON.stringify({ value: values[name] });
    sql(
      `insert into ret0.server_configs (key, value, inserted_at, updated_at) values (${lit(KEYS[name])}, ${lit(json)}::jsonb, now(), now()) ` +
        `on conflict (key) do update set value = excluded.value, updated_at = now()`
    );
  }
  // The values are read through a cache, and the content security policy is built from the URL
  compose(["restart", "reticulum"]);
}

const describe = (v: ReturnType<typeof current>) =>
  `url=${v.url ?? "(unset)"} key=${v.key ? `set (${v.key.length} chars)` : "(unset)"} secret=${v.secret ? `set (${v.secret.length} chars)` : "(unset)"}`;

const command = process.argv[2] ?? "show";
if (command === "read") {
  const v = current();
  const env = readEnv();
  if (env.LIVEKIT_CLOUD_URL) {
    console.log("LIVEKIT_CLOUD_* already in .env.local; not overwritten");
  } else if (v.url && v.url !== LOCAL.url) {
    fs.appendFileSync(
      envFile,
      `\n# LiveKit Cloud block, saved from reticulum's server config before switching to the local server\n` +
        `LIVEKIT_CLOUD_URL=${v.url}\nLIVEKIT_CLOUD_KEY=${v.key ?? ""}\nLIVEKIT_CLOUD_SECRET=${v.secret ?? ""}\n`
    );
    console.log("saved to .env.local:", describe(v));
  } else {
    console.log("nothing to save:", describe(v));
  }
} else if (command === "local") {
  write(LOCAL);
  console.log("local block:", describe(current()));
} else if (command === "cloud") {
  const env = readEnv();
  if (!env.LIVEKIT_CLOUD_URL) throw new Error("no LIVEKIT_CLOUD_URL in .env.local");
  write({ url: env.LIVEKIT_CLOUD_URL, key: env.LIVEKIT_CLOUD_KEY ?? "", secret: env.LIVEKIT_CLOUD_SECRET ?? "" });
  console.log("cloud block:", describe(current()));
} else if (command === "room") {
  // npx tsx trials/d-livekit.ts room <key> [sfu]: the trial room <key> (created if needed) on media server
  // sfu (0 Dialog, 2 LiveKit), set in the database as the room settings' "WebRTC SFU" would set it
  const key = process.argv[3] ?? "livekit";
  const sfu = Number(process.argv[4] ?? 2);
  const fixtures = readFixtures();
  fixtures.trials ??= {};
  if (!fixtures.trials[key]) {
    const api = await request.newContext({ ignoreHTTPSErrors: true });
    const res = await api.post(`${BASE}/api/v1/hubs`, { data: { hub: { name: `trial ${key}` } } });
    fixtures.trials[key] = (await res.json()).hub_id;
    writeFixtures(fixtures);
    await api.dispose();
  }
  const hubId = fixtures.trials[key];
  sql(`update ret0.hubs set sfu = ${sfu} where hub_sid = ${lit(hubId)}`);
  console.log(key, hubId, "sfu", sql(`select sfu from ret0.hubs where hub_sid = ${lit(hubId)}`));
} else if (command === "unset") {
  sql(`delete from ret0.server_configs where key like 'webrtc-settings|livekit_%'`);
  compose(["restart", "reticulum"]);
  console.log("unset:", describe(current()));
} else {
  console.log(describe(current()));
}
