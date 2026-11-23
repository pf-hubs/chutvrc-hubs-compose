// Paths, host names and local settings shared by the harness, the scripts and the tests.
import fs from "node:fs";
import path from "node:path";

export const E2E = path.resolve(import.meta.dirname, "..");
export const COMPOSE_ROOT = path.resolve(E2E, "..");

/** Loads e2e/.env.local (OBS WebSocket, LAN address, directories); variables already set in the shell win */
export function loadLocalEnv() {
  const file = path.join(E2E, ".env.local");
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
// The directories below can be set there, so it is read before they are worked out
loadLocalEnv();

/** A directory named by a setting (absolute, or relative to e2e/), or the folder under e2e/ */
const directorySetting = (name: string, fallback: string) => {
  const value = process.env[name]?.trim();
  return value ? path.resolve(E2E, value) : path.join(E2E, fallback);
};
/** Signed-in browser profiles, one folder per client (PROFILES_DIR; e2e/profiles by default) */
export const PROFILES_DIR = directorySetting("PROFILES_DIR", "profiles");
/** Evidence of every run, evidence/<run-id>/ (EVIDENCE_DIR; e2e/evidence by default) */
export const EVIDENCE_DIR = directorySetting("EVIDENCE_DIR", "evidence");
export const ASSETS_DIR = path.join(E2E, "assets");
export const CLIPS_DIR = path.join(ASSETS_DIR, "clips");
export const FIXTURES_FILE = path.join(E2E, "fixtures.json");

export const HOST = "hubs.local";
/** The client as reticulum serves it */
export const BASE_URL = `https://${HOST}:4000`;
/** The assets service: e2e/assets/ over TLS, a port the content security policy allows */
export const ASSETS_URL = `https://${HOST}:3001`;

/** The five repositories whose commits a run records */
export const REPOS = {
  compose: COMPOSE_ROOT,
  hubs: path.join(COMPOSE_ROOT, "services", "hubs"),
  reticulum: path.join(COMPOSE_ROOT, "services", "reticulum"),
  dialog: path.join(COMPOSE_ROOT, "services", "dialog"),
  spoke: path.join(COMPOSE_ROOT, "services", "spoke")
} as const;

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
