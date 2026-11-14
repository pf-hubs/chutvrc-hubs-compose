// Paths, host names and local settings shared by the harness, the scripts and the tests.
import fs from "node:fs";
import path from "node:path";

export const E2E = path.resolve(import.meta.dirname, "..");
export const COMPOSE_ROOT = path.resolve(E2E, "..");
export const PROFILES_DIR = path.join(E2E, "profiles");
export const EVIDENCE_DIR = path.join(E2E, "evidence");
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

/** Loads e2e/.env.local once (OBS WebSocket, LAN address); variables already set in the shell win */
export function loadLocalEnv() {
  const file = path.join(E2E, ".env.local");
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
