// T6 existing features and the upstream intake (plan 4, T6.1 to T6.10, and T6.11 for the Features menu), on Dialog in the Dialog block and on
// LiveKit in a LiveKit block where the feature touches the media server. T6.8 (no request to a reticulum.io
// host) and T6.10 (console errors) are scans of the whole run: every test's closing checks judge its own
// clients, and report/run-scans.ts reads every client of every test after the run (t6.8-whole-run,
// t6.10-whole-run in the report).
//
// T6.1 opens the admin pages, which show the real SMTP settings of this server: that client records no video,
// every screenshot of the admin pages masks the text fields, and the server settings are compared by hash only.
// Whatever a save changed is put back exactly as it was found.
import fs from "node:fs";
import crypto from "node:crypto";
import { test } from "./harness";
import type { Evidence } from "../report/evidence";
import { ASSETS_URL, BASE_URL, sleep } from "../lib/env";
import { ALL_FEATURES_ON, APP_CONFIG_CACHE_MS, compose, readFeatureSettings, restartReticulum, restoreFeatureSettings, setFeatureSettings, sql, sqlText, type FeatureSwitches } from "../lib/stack";
import { readFixtures, room, type MediaServer } from "../lib/fixtures";
import type { Client } from "../clients/launch";
import * as input from "../clients/input";
import { enterRoom } from "../clients/enter";
import { reannounceAvatars, reenterSilentSenders } from "../clients/workarounds";
import { answerAssetUrls } from "../clients/local-stack";
import { IMAGE_URL, MODEL_URL, PAGES_PDF_URL, VIDEO_URL } from "../assets/generate";
import { readPeers, readSession } from "../probes/session";
import { summariseRecording } from "../probes/recording";
import { ON_LIVEKIT, blockId, blockTitle, runsOn } from "./blocks";
import { closingChecks, connectedCheck, enterAll, frameRateCheck, idOf, mainRoom, startClients, waitUntil } from "./common";
import { CONTAINER_CERTIFICATE, KNOWN_MIC_WISH_LOST } from "./console-allowlist";

const SERVERS = ["dialog", "livekit"] as const;
/** Allowances for known failures these tests are not about, and for the netclient container (suites/console-allowlist.ts) */
const ALLOW = [KNOWN_MIC_WISH_LOST, ...CONTAINER_CERTIFICATE];

const meta = (id: string, server: MediaServer | null, covers: string) => ({
  annotation: [
    { type: "id", description: server ? `${id}-${blockId(server)}` : id },
    { type: "covers", description: covers }
  ]
});

/** Enters the clients together; a client whose sending failed at the joint join enters again (logged workaround) */
async function enterTogether(evidence: Evidence, clients: Client[], hubId: string) {
  const timings = await enterAll(evidence, clients, hubId);
  await reenterSilentSenders(clients, evidence, "so the test sees the feature rather than the joint join", c => enterRoom(c, hubId, { displayName: c.name }));
  return timings;
}

// ---------- T6.1 ----------

/** Every server setting as key and a hash of its value (values never leave the database in clear) */
function serverConfigHashes(): Record<string, string> {
  const rows = sql(`select key, md5(value::text) from ret0.server_configs order by key`);
  return Object.fromEntries(rows.split("\n").filter(Boolean).map(r => r.split("\t") as [string, string]));
}

/** The settings' values, kept in this process only, to put back what a save changed */
function serverConfigValues(): Map<string, string> {
  const rows = sql(`select key, encode(convert_to(value::text, 'UTF8'), 'base64') from ret0.server_configs order by key`);
  return new Map(rows.split("\n").filter(Boolean).map(r => {
    const [key, b64] = r.split("\t");
    return [key, Buffer.from(b64.replace(/\s/g, ""), "base64").toString("utf8")] as [string, string];
  }));
}

/** Runs SQL given on standard input, so no value appears in a command line or an error message */
function sqlQuiet(query: string) {
  try {
    compose(["exec", "-T", "db", "psql", "-U", "postgres", "-d", "ret_dev", "-At", "-v", "ON_ERROR_STOP=1"], query);
  } catch {
    throw new Error("restoring the server settings failed (the statement is not shown: it holds setting values)");
  }
}

/** Compares two hash snapshots: keys added, removed, changed (names only) */
function diffConfigs(before: Record<string, string>, after: Record<string, string>) {
  const added = Object.keys(after).filter(k => !(k in before));
  const removed = Object.keys(before).filter(k => !(k in after));
  const changed = Object.keys(before).filter(k => k in after && before[k] !== after[k]);
  return { added, removed, changed };
}

/** Hides the values of every text field on the admin page before a screenshot */
const MASK_FIELDS = `(() => {
  const style = document.createElement("style");
  style.id = "e2e-mask";
  style.textContent = "input, textarea { -webkit-text-security: disc !important; filter: blur(6px) !important; }";
  if (!document.getElementById("e2e-mask")) document.head.appendChild(style);
})()`;

const SMTP_KEYS = /^email\|/;
const LIVEKIT_KEYS = /^webrtc-settings\|livekit_/;

async function adminPages(evidence: Evidence) {
  const before = serverConfigHashes();
  const values = serverConfigValues();
  const appFeatures = () => sql(`select key, md5(value::text) from ret0.app_configs where key in ('features|bitecs_loader', 'features|addons_config')`);
  const appBefore = appFeatures();
  evidence.note(
    `server settings found: ${Object.keys(before).length} keys, SMTP keys ${Object.keys(before).filter(k => SMTP_KEYS.test(k)).length}, LiveKit keys ${Object.keys(before).filter(k => LIVEKIT_KEYS.test(k)).length}; ` +
      `compared by hash only; the admin client records no video and its screenshots mask every text field`
  );
  const [a] = await startClients(evidence, [{ identity: "admin", account: "admin", slot: "a", name: "A-admin", recordVideo: false }]);
  const page = a.page;
  const restore = async () => {
    const now = serverConfigHashes();
    const { added, changed, removed } = diffConfigs(before, now);
    if (!added.length && !changed.length && !removed.length) return { restored: false, added, changed, removed };
    const statements = [
      ...added.map(k => `delete from ret0.server_configs where key = ${sqlText(k)};`),
      ...[...changed, ...removed].map(
        k =>
          `insert into ret0.server_configs (key, value, inserted_at, updated_at) values (${sqlText(k)}, ${sqlText(values.get(k)!)}::jsonb, now(), now()) on conflict (key) do update set value = excluded.value, updated_at = now();`
      )
    ];
    sqlQuiet(statements.join("\n"));
    await restartReticulum();
    return { restored: true, added, changed, removed };
  };

  try {
    await evidence.check("The admin page opens for the admin", "F6", async () => {
      await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
      await page.getByText("Server Settings", { exact: false }).first().waitFor({ state: "visible", timeout: 90_000 });
      await page.evaluate(MASK_FIELDS);
      await evidence.screenshot(a, "admin-home");
      return { ok: true, summary: `admin opened at ${page.url().replace(/\?.*$/, "")}` };
    });

    const saveTab = async (tab: string, keys: RegExp) =>
      evidence.check(`Server Settings, ${tab} tab: Save keeps every value (SMTP and LiveKit included)`, "F6", async () => {
        await page.goto(`${BASE_URL}/admin#/server-setup`, { waitUntil: "domcontentloaded" });
        const tabButton = page.getByRole("tab", { name: tab, exact: true });
        await tabButton.waitFor({ state: "visible", timeout: 60_000 });
        await tabButton.click();
        await page.waitForFunction(() => !document.querySelector('[role="progressbar"]'), undefined, { timeout: 30_000 });
        await page.waitForTimeout(1000);
        await page.evaluate(MASK_FIELDS);
        const fields = await page.evaluate(() => [...document.querySelectorAll("label")].map(l => l.textContent?.trim()).filter(Boolean));
        await evidence.screenshot(a, `server-settings-${tab.toLowerCase()}`);
        const hashesBefore = serverConfigHashes();
        await page.getByRole("button", { name: "Save", exact: true }).click();
        const saved = await page.getByText(/Settings saved\.|Error saving/).first().waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false);
        const message = saved ? ((await page.getByText(/Settings saved\.|Error saving/).first().textContent()) ?? "") : "no message";
        await page.evaluate(MASK_FIELDS);
        await evidence.screenshot(a, `server-settings-${tab.toLowerCase()}-saved`);
        await page.waitForTimeout(1500);
        const after = serverConfigHashes();
        const d = diffConfigs(hashesBefore, after);
        const touched = [...d.changed, ...d.removed].filter(k => SMTP_KEYS.test(k) || LIVEKIT_KEYS.test(k));
        const tabKeys = Object.keys(hashesBefore).filter(k => keys.test(k));
        return {
          ok: /Settings saved/.test(message) && touched.length === 0 && d.removed.length === 0,
          summary:
            `"${message.trim()}"; fields on the tab: ${fields.length}; SMTP and LiveKit values changed or removed by the save: ${touched.length ? touched.join(", ") : "none"}; ` +
            `other keys added ${d.added.length ? d.added.join(", ") : "none"}, changed ${d.changed.length ? d.changed.join(", ") : "none"}, removed ${d.removed.length ? d.removed.join(", ") : "none"} ` +
            `(keys of this tab in the database: ${tabKeys.join(", ") || "none"})`,
          data: { message, fieldCount: fields.length, diff: d, tabKeys }
        };
      });
    await saveTab("Email", SMTP_KEYS);
    await saveTab("WebRTC", /^webrtc-settings\|/);

    await evidence.check("App Settings, Features: addons_config and bitecs_loader exist and stay empty", "F6", async () => {
      await page.goto(`${BASE_URL}/admin#/app-settings`, { waitUntil: "domcontentloaded" });
      const features = page.getByRole("tab", { name: "Features", exact: true });
      await features.waitFor({ state: "visible", timeout: 60_000 });
      await features.click();
      await page.waitForTimeout(2000);
      const fields = await page.evaluate(() => {
        const byLabel = (text: string) => {
          const label = [...document.querySelectorAll("label")].find(l => l.textContent?.trim() === text);
          if (!label) return null;
          const root = label.closest("div")?.parentElement ?? label.parentElement;
          const input = (label.htmlFor ? document.getElementById(label.htmlFor) : null) ?? root?.querySelector("input, textarea");
          return input ? { shown: true, type: (input as HTMLInputElement).type, value: (input as HTMLInputElement).type === "checkbox" ? String((input as HTMLInputElement).checked) : (input as HTMLInputElement).value } : { shown: true, type: "?", value: "?" };
        };
        return { bitecs: byLabel("Use BitECS loader"), addons: byLabel("Add-ons config JSON") };
      });
      await page.evaluate(MASK_FIELDS);
      await evidence.screenshot(a, "app-settings-features");
      const stored = appFeatures();
      const empty = (f: { value: string } | null) => !!f && (f.value === "" || f.value === "false");
      return {
        ok: !!fields.bitecs && !!fields.addons && empty(fields.bitecs) && empty(fields.addons) && stored === appBefore,
        summary: `"Use BitECS loader": ${fields.bitecs ? `shown, ${fields.bitecs.type} ${fields.bitecs.value || "(empty)"}` : "not shown"}; "Add-ons config JSON": ${fields.addons ? `shown, ${fields.addons.value ? "has a value" : "empty"}` : "not shown"}; stored rows ${stored ? stored.split("\n").length : 0} (unchanged ${stored === appBefore})`,
        data: { fields, storedRows: stored ? stored.split("\n").map(r => r.split("\t")[0]) : [] }
      };
    });
  } finally {
    const r = await restore();
    evidence.note(
      r.restored
        ? `server settings put back as found: removed the keys the saves added (${r.added.join(", ") || "none"}), restored ${[...r.changed, ...r.removed].join(", ") || "none"}; reticulum restarted`
        : "the server settings were unchanged after the saves; nothing to put back"
    );
    await evidence.check("The server settings are as found after the test", "F6", async () => {
      const d = diffConfigs(before, serverConfigHashes());
      return { ok: !d.added.length && !d.changed.length && !d.removed.length, summary: `added ${d.added.length}, changed ${d.changed.length}, removed ${d.removed.length} against the start`, data: d };
    });
  }
  await closingChecks(evidence, [a], ALLOW);
}

// ---------- T6.2 ----------

async function createRoomAndChat(evidence: Evidence, server: MediaServer) {
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a", name: "A-admin" },
    { identity: "member1", account: "member1", slot: "b", name: "B-member" }
  ]);
  const scenes = readFixtures().scenes ?? {};
  let hubId = "";
  await evidence.check("Create a room from the home page", "checklist-3", async () => {
    await a.page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    const create = a.page.getByRole("button", { name: "Create Room" }).first();
    await create.waitFor({ state: "visible", timeout: 60_000 });
    await create.click();
    await a.page.waitForURL(url => /^\/[A-Za-z0-9]{7}(\/|$)/.test(url.pathname), { timeout: 60_000 });
    hubId = new URL(a.page.url()).pathname.split("/")[1];
    await a.page.getByRole("button", { name: "Join Room" }).waitFor({ state: "visible", timeout: 120_000 });
    await evidence.screenshot(a, "created-room-lobby");
    const row = sql(`select name, sfu, entry_mode from ret0.hubs where hub_sid = ${sqlText(hubId)}`);
    return { ok: !!hubId && !!row, summary: `room ${hubId} created (name, sfu, entry mode: ${row.replace(/\t/g, ", ")})`, data: { hubId, row } };
  });
  if (!hubId) return closingChecks(evidence, [a, b], ALLOW);
  if (server === "livekit") {
    // The owner's room starts on the server default; this block's media server is set through the owner's Room Settings below
    evidence.note("the new room starts on the server's default media server; A switches it to LiveKit in Room Settings after entering");
  }
  await enterRoom(a, hubId, { displayName: a.name });
  if (server === "livekit") {
    await input.setRoomMediaServer(a.page, "LiveKit");
    await input.closeSidebar(a.page);
    await a.page.waitForFunction(() => (window as any).__e2eApi?.sfuId() === 2 && (window as any).__e2eApi?.isConnected(), undefined, { timeout: 45_000 });
  }

  const newName = `e2e T6.2 ${new Date().toISOString().slice(11, 19)}`;
  await evidence.check("Change the room's name in Room Settings", "checklist-3", async () => {
    await input.choosePopoverItem(a.page, "More", "Room Info and Settings");
    await a.page.getByRole("button", { name: "Edit", exact: true }).click();
    const field = a.page.getByLabel("Room Name");
    await field.fill(newName);
    await a.page.getByRole("button", { name: "Apply", exact: true }).click();
    await a.page.waitForTimeout(1500);
    await input.closeSidebar(a.page);
    const shown = await a.page.evaluate(() => (window as any).APP.hub?.name);
    const stored = sql(`select name from ret0.hubs where hub_sid = ${sqlText(hubId)}`);
    return { ok: shown === newName && stored === newName, summary: `A shows "${shown}", stored "${stored}"`, data: { shown, stored } };
  });

  const nimpro = scenes.nimpro;
  await evidence.check("Change the scene (Room Settings, Change Scene, Custom Scene URL)", "checklist-3", async () => {
    if (!nimpro) return { ok: false, summary: "no second scene in fixtures.json" };
    const sceneUrl = `${BASE_URL}/scenes/${nimpro.sceneId}`;
    await input.choosePopoverItem(a.page, "More", "Room Info and Settings");
    await a.page.getByRole("button", { name: "Change Scene", exact: true }).first().click();
    await a.page.getByText("Custom Scene", { exact: true }).first().click({ timeout: 20_000 });
    await a.page.getByLabel("Scene URL").fill(sceneUrl);
    await a.page.getByRole("button", { name: "Change Scene", exact: true }).last().click();
    const changed = await waitUntil(async () => (await a.page.evaluate(() => (window as any).APP.hub?.scene?.scene_id)) === nimpro.sceneId, 30_000);
    await a.page.waitForTimeout(4000);
    await evidence.screenshot(a, "scene-changed");
    const stored = sql(`select s.scene_sid from ret0.hubs h join ret0.scenes s on s.scene_id = h.scene_id where h.hub_sid = ${sqlText(hubId)}`);
    return { ok: !changed.timedOut && stored === nimpro.sceneId, summary: `A's room scene ${changed.value ? nimpro.sceneId : "unchanged"} after ${changed.ms} ms; stored ${stored} (${nimpro.name})`, data: { sceneUrl, stored } };
  });

  await evidence.check("B enters from the lobby: the new name and scene", "checklist-3", async () => {
    await enterRoom(b, hubId, { displayName: b.name });
    const seen = await b.page.evaluate(() => ({ name: (window as any).APP.hub?.name, scene: (window as any).APP.hub?.scene?.scene_id }));
    await evidence.screenshot(b, "entered");
    return { ok: seen.name === newName && seen.scene === nimpro?.sceneId, summary: `B sees name "${seen.name}", scene ${seen.scene}`, data: seen };
  });
  await connectedCheck(evidence, [a, b], server, "checklist-3");

  await evidence.check("Text chat both ways", "checklist-3", async () => {
    const send = async (c: Client, text: string) => {
      const chat = input.toolbarButton(c.page, "Chat");
      await chat.click();
      // The placeholder names the audience ("Send message to one other...", "Message..." when alone)
      const box = c.page.getByPlaceholder(/^(Send message|Message)/);
      await box.waitFor({ state: "visible", timeout: 10_000 });
      await box.fill(text);
      await box.press("Enter");
      await c.page.waitForTimeout(500);
      await chat.click();
    };
    const has = (c: Client, text: string) => waitUntil(() => c.page.evaluate(t => document.body.innerText.includes(t), text), 10_000);
    const fromA = `hello from A ${Date.now() % 10000}`;
    const fromB = `hello from B ${Date.now() % 10000}`;
    await send(a, fromA);
    const bGot = await has(b, fromA);
    await send(b, fromB);
    const aGot = await has(a, fromB);
    await evidence.screenshot(b, "chat");
    return { ok: !!bGot.value && !!aGot.value, summary: `B shows A's message: ${!!bGot.value}${bGot.value ? ` after ${bGot.ms} ms` : ""}; A shows B's: ${!!aGot.value}${aGot.value ? ` after ${aGot.ms} ms` : ""}` };
  });

  await evidence.check("Reactions: an emoji from A appears for both", "checklist-3", async () => {
    const count = (c: Client) => c.page.evaluate(() => document.querySelectorAll("[emoji]").length);
    const before = [await count(a), await count(b)];
    // The reactions are images labelled by their alt text; the popover is mounted afresh, so it is clicked at its place
    await input.toolbarButton(a.page, "React").click();
    await input.clickFound(a.page, `return document.querySelector('img[alt="Heart"]');`, undefined, "the Heart reaction");
    const shown = await waitUntil(async () => {
      const now = [await count(a), await count(b)];
      return now[0] > before[0] && now[1] > before[1] ? now : null;
    }, 10_000);
    await evidence.screenshot(b, "reaction");
    return { ok: !!shown.value, summary: `emoji entities A ${before[0]} -> ${shown.value?.[0] ?? (await count(a))}, B ${before[1]} -> ${shown.value?.[1] ?? (await count(b))}`, data: shown };
  });
  evidence.note(`room ${hubId} created by this test, named "${newName}", is left in the database (test data)`);
  await closingChecks(evidence, [a, b], ALLOW);
}

// ---------- T6.3 ----------

/** Page code (arg: { src }): the placed object with that URL (the nearest in view when several) */
const FIND = input.FIND_MEDIA_CODE;

type ObjectState = { exists: boolean; pos: [number, number, number] | null; scale: number | null; pinned: boolean | null; networkId: string | null; loaded: boolean };

function objectState(c: Client, src: string): Promise<ObjectState> {
  return c.page.evaluate(
    ({ finder, src }) => {
      const el = new Function("arg", finder)({ src });
      if (!el) return { exists: false, pos: null, scale: null, pinned: null, networkId: null, loaded: false };
      const THREE = (window as any).AFRAME.THREE;
      el.object3D.updateMatrixWorld(true);
      const p = new THREE.Vector3().setFromMatrixPosition(el.object3D.matrixWorld);
      return {
        exists: true,
        pos: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)] as [number, number, number],
        scale: +el.object3D.scale.x.toFixed(3),
        pinned: !!el.components.pinnable?.data?.pinned,
        networkId: el.components.networked?.data?.networkId ?? null,
        loaded: !el.querySelector?.("[loading-cube]") && !!el.components["media-loader"] && el.getAttribute("media-loader")?.src === src
      };
    },
    { finder: FIND, src }
  );
}

/** Where on A's screen the object is drawn */
function screenPoint(c: Client, src: string): Promise<{ x: number; y: number; onScreen: boolean } | null> {
  return c.page.evaluate(
    ({ finder, src }) => {
      const el = new Function("arg", finder)({ src });
      if (!el) return null;
      const scene = (window as any).AFRAME.scenes[0];
      const v = new (window as any).AFRAME.THREE.Vector3().setFromMatrixPosition(el.object3D.matrixWorld).project(scene.camera);
      const r = scene.canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, onScreen: v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 };
    },
    { finder: FIND, src }
  );
}

/** Holds the left button on the object and drags it by (dx, dy) pixels; with `scaleSteps`, shift and the wheel scale it while held */
async function grabAndDrag(c: Client, src: string, dx: number, dy: number, scaleSteps = 0) {
  await input.faceTowards(c.page, { mediaSrc: src });
  const at = await screenPoint(c, src);
  if (!at?.onScreen) throw new Error(`${src} is not on ${c.name}'s screen`);
  await c.page.mouse.move(at.x, at.y, { steps: 4 });
  await c.page.waitForTimeout(200);
  await c.page.mouse.down();
  await c.page.waitForTimeout(300);
  for (let i = 1; i <= 10; i++) {
    await c.page.mouse.move(at.x + (dx * i) / 10, at.y + (dy * i) / 10);
    await c.page.waitForTimeout(30);
  }
  if (scaleSteps) {
    await c.page.keyboard.down("Shift");
    for (let i = 0; i < Math.abs(scaleSteps); i++) {
      await c.page.mouse.wheel(0, scaleSteps > 0 ? -120 : 120);
      await c.page.waitForTimeout(60);
    }
    await c.page.keyboard.up("Shift");
  }
  await c.page.waitForTimeout(200);
  await c.page.mouse.up();
  await c.page.waitForTimeout(800);
}

/**
 * Clicks a button of the object's menu (pin, remove, ...), which shows while the scene is frozen and the
 * object hovered: Tab, the mouse on the object, then the button at its place on the screen, Tab again
 */
async function objectMenuButton(c: Client, src: string, selector: string) {
  await input.faceTowards(c.page, { mediaSrc: src });
  await input.holdKey(c.page, "Tab", 120);
  try {
    await c.page.waitForFunction(() => (window as any).AFRAME.scenes[0].is("frozen"), undefined, { timeout: 5000 });
    const at = await screenPoint(c, src);
    if (!at?.onScreen) throw new Error(`${src} is not on screen`);
    await c.page.mouse.move(at.x, at.y, { steps: 4 });
    const finder = `
      const media = (() => {${FIND}})();
      const shown = el => { for (let o = el.object3D; o; o = o.parent) if (!o.visible) return false; return true; };
      return [...(media ? media.querySelectorAll(${JSON.stringify(selector)}) : [])].find(shown) || null;`;
    const deadline = Date.now() + 10_000;
    let shownButton = false;
    while (!shownButton && Date.now() < deadline) {
      shownButton = await c.page.evaluate(({ finder, src }) => !!new Function("arg", finder)({ src }), { finder, src });
      if (!shownButton) {
        await c.page.mouse.move(at.x + (Date.now() % 2 ? 1 : -1), at.y);
        await c.page.waitForTimeout(250);
      }
    }
    if (!shownButton) throw new Error(`the ${selector} button of ${src} did not show`);
    await input.clickInWorld(c.page, finder, { src }, `the ${selector} button`);
    await c.page.waitForTimeout(800);
  } finally {
    if (await c.page.evaluate(() => (window as any).AFRAME.scenes[0].is("frozen")).catch(() => false)) await input.holdKey(c.page, "Tab", 120);
    await c.page.waitForTimeout(300);
  }
}

const dist = (a: number[] | null, b: number[] | null) => (a && b ? +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(3) : NaN);

async function placeAndHandle(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a", name: "A-admin" },
    { identity: "member1", account: "member1", slot: "b", name: "B-member" }
  ]);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); A (the owner) places and handles the objects, B watches; the old loader (the room's default)`);
  await enterTogether(evidence, [a, b], hub.hubId);
  await frameRateCheck(evidence, [a, b]);
  const items = [
    { kind: "image", src: IMAGE_URL },
    { kind: "video", src: VIDEO_URL },
    { kind: "GLB", src: MODEL_URL },
    { kind: "PDF", src: PAGES_PDF_URL }
  ];
  await evidence.check("Place an image, a video, a GLB and a PDF (Place, Upload): both clients show them", "B4", async () => {
    const rows: string[] = [];
    let ok = true;
    for (const item of items) {
      await input.placeFromUrl(a.page, item.src);
      const shown = await waitUntil(async () => {
        const [sa, sb] = [await objectState(a, item.src), await objectState(b, item.src)];
        return sa.exists && sb.exists && sa.loaded && sb.loaded ? { sa, sb } : null;
      }, 30_000);
      if (!shown.value) ok = false;
      rows.push(`${item.kind}: ${shown.value ? `on both after ${shown.ms} ms` : "not on both within 30 s"}`);
      // Each next object in another direction, so they do not overlap
      await input.snapTurn(a.page, "right", 1);
      await a.page.waitForTimeout(500);
    }
    await input.faceTowards(b.page, { mediaSrc: IMAGE_URL });
    await evidence.screenshot(b, "placed");
    return { ok, summary: rows.join("; "), data: rows };
  });

  const agree = async (src: string) => {
    const [sa, sb] = [await objectState(a, src), await objectState(b, src)];
    return { sa, sb, gap: dist(sa.pos, sb.pos), scaleGap: sa.scale !== null && sb.scale !== null ? +Math.abs(sa.scale - sb.scale).toFixed(3) : NaN };
  };

  await evidence.check("Grab and move the GLB with the mouse: it moves, and B agrees", "B4 review-fix-1", async () => {
    const before = await agree(MODEL_URL);
    await grabAndDrag(a, MODEL_URL, 220, -60);
    await a.page.waitForTimeout(1500);
    const after = await agree(MODEL_URL);
    const moved = dist(before.sa.pos, after.sa.pos);
    await evidence.screenshot(a, "glb-moved");
    return {
      ok: moved > 0.2 && after.gap < 0.05,
      summary: `A's GLB moved ${moved} m; A and B differ by ${after.gap} m afterwards`,
      data: { before, after }
    };
  });

  await evidence.check("Scale the image while holding it (shift and the wheel): B agrees", "B4", async () => {
    const before = await agree(IMAGE_URL);
    await grabAndDrag(a, IMAGE_URL, 0, 0, 6);
    await a.page.waitForTimeout(1500);
    const after = await agree(IMAGE_URL);
    return {
      ok: before.sa.scale !== null && after.sa.scale !== null && Math.abs(after.sa.scale - before.sa.scale) > 0.05 && after.scaleGap < 0.02,
      summary: `A's image scale ${before.sa.scale} -> ${after.sa.scale}; B ${before.sb.scale} -> ${after.sb.scale}`,
      data: { before, after }
    };
  });

  await evidence.check("Pin the video: a pinned object cannot be grabbed, and B shows it pinned", "B4", async () => {
    await objectMenuButton(a, VIDEO_URL, "[pin-networked-object-button]");
    const pinned = await waitUntil(async () => {
      const s = await agree(VIDEO_URL);
      return s.sa.pinned && s.sb.pinned ? s : null;
    }, 10_000);
    const before = await agree(VIDEO_URL);
    await grabAndDrag(a, VIDEO_URL, 250, 0).catch(e => evidence.note(`grabbing the pinned video: ${(e as Error).message}`));
    await a.page.waitForTimeout(1000);
    const after = await agree(VIDEO_URL);
    const moved = dist(before.sa.pos, after.sa.pos);
    await evidence.screenshot(a, "video-pinned");
    return {
      ok: !!pinned.value && moved < 0.02 && after.gap < 0.05,
      summary: `pinned on A ${before.sa.pinned}, on B ${before.sb.pinned}; a drag on it moved it ${moved} m (judged: under 2 cm); A and B differ by ${after.gap} m`,
      data: { before, after }
    };
  });

  await evidence.check("Delete the PDF from its menu: gone on both", "B4", async () => {
    await objectMenuButton(a, PAGES_PDF_URL, "[remove-networked-object-button]");
    const gone = await waitUntil(async () => !(await objectState(a, PAGES_PDF_URL)).exists && !(await objectState(b, PAGES_PDF_URL)).exists, 10_000);
    return { ok: !!gone.value, summary: gone.value ? `gone on both after ${gone.ms} ms` : `still there: A ${(await objectState(a, PAGES_PDF_URL)).exists}, B ${(await objectState(b, PAGES_PDF_URL)).exists}` };
  });

  // Put the room back: unpin and remove what this test placed (pinned objects stay in the room otherwise)
  await objectMenuButton(a, VIDEO_URL, "[pin-networked-object-button]").catch(() => {});
  for (const src of [VIDEO_URL, IMAGE_URL, MODEL_URL]) await objectMenuButton(a, src, "[remove-networked-object-button]").catch(e => evidence.note(`clean-up of ${src}: ${(e as Error).message}`));
  await closingChecks(evidence, [a, b], ALLOW);
}

// ---------- T6.4 ----------

const EXTERNAL = [
  { kind: "image", url: "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/uv_grid_opengl.jpg" },
  { kind: "video", url: "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/sintel.mp4" },
  { kind: "GLB", url: "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb" }
];

async function externalUrls(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [a] = await startClients(evidence, [{ identity: "admin", account: "admin", slot: "a", name: "A-admin" }]);
  const seen: string[] = [];
  a.context.on("request", r => {
    if (EXTERNAL.some(e => r.url().includes(new URL(e.url).pathname))) seen.push(r.url());
  });
  await enterRoom(a, hub.hubId, { displayName: a.name });
  const proxy = await a.page.evaluate(() => document.querySelector<HTMLMetaElement>('meta[name="env:CORS_PROXY_SERVER"]')?.content ?? null).catch(() => null);
  for (const item of EXTERNAL) {
    await evidence.check(`Paste an external ${item.kind} URL: it loads through the proxy`, "F8", async () => {
      const before = seen.length;
      await input.placeFromUrl(a.page, item.url);
      const loaded = await waitUntil(async () => {
        const s = await objectState(a, item.url);
        const failed = await a.page.evaluate(
          ({ finder, src }) => {
            const el = new Function("arg", finder)({ src });
            return !!el && (!!el.querySelector?.("[media-loader-error]") || el.components["media-loader"]?.showLoader === false && !!el.getAttribute("media-image-error"));
          },
          { finder: FIND, src: item.url }
        );
        return s.exists && s.loaded ? { s, failed } : null;
      }, 45_000);
      await a.page.waitForTimeout(2000);
      await input.faceTowards(a.page, { mediaSrc: item.url });
      await evidence.screenshot(a, `external-${item.kind}`);
      const requests = seen.slice(before);
      const direct = requests.filter(u => u.startsWith(item.url));
      const proxied = requests.filter(u => !u.startsWith(item.url));
      await input.snapTurn(a.page, "right", 1);
      return {
        ok: !!loaded.value && proxied.length > 0 && direct.length === 0,
        summary: `${loaded.value ? `placed and loaded after ${loaded.ms} ms` : "not loaded within 45 s"}; requests for it: ${proxied.length} through ${[...new Set(proxied.map(u => new URL(u).host))].join(", ") || "-"}, ${direct.length} straight to the origin`,
        data: { proxy, requests: requests.slice(0, 10) }
      };
    });
  }
  await closingChecks(evidence, [a], ALLOW);
}

// ---------- T6.5 ----------

async function pronouns(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a", name: "A-admin" },
    { identity: "member1", account: "member1", slot: "b", name: "B-member" }
  ]);
  await enterTogether(evidence, [a, b], hub.hubId);
  const ida = await idOf(a);
  const original = await a.page.evaluate(() => (window as any).APP.store.state.profile.pronouns ?? null);
  for (const value of ["she, her", "they them", "he/him, they"]) {
    await evidence.check(`Pronouns "${value}" in Change Name & Avatar: accepted and shown to B`, "upstream-intake", async () => {
      await input.choosePopoverItem(a.page, "More", "Change Name & Avatar");
      const field = a.page.getByLabel("Pronouns (optional)");
      await field.waitFor({ state: "visible", timeout: 15_000 });
      await field.fill(value);
      const valid = await field.evaluate(el => (el as HTMLInputElement).checkValidity());
      await a.page.getByRole("button", { name: "Accept", exact: true }).click();
      await a.page.waitForTimeout(1500);
      const stored = await a.page.evaluate(() => (window as any).APP.store.state.profile.pronouns);
      const atB = await waitUntil(
        () => b.page.evaluate(id => (window as any).APP.hubChannel?.presence?.state?.[id]?.metas?.[0]?.profile?.pronouns ?? null, ida).then(p => (p === value ? p : null)),
        10_000
      );
      await input.closeSidebar(b.page).catch(() => {});
      await b.page.getByRole("button", { name: /^People/ }).click();
      const listed = await waitUntil(() => b.page.evaluate(t => document.body.innerText.includes(`(${t})`), value), 5000);
      await evidence.screenshot(b, `people-${value.replace(/\W+/g, "-")}`);
      await input.closeSidebar(b.page).catch(() => {});
      return {
        ok: valid && stored === value && !!atB.value && !!listed.value,
        summary: `the field accepts it: ${valid}; A's profile keeps "${stored}"; B's presence shows "${atB.value ?? "-"}"; B's People list shows "(${value})": ${!!listed.value}`
      };
    });
  }
  // Put the profile back: no pronouns (an empty or null value is refused by the store's schema, so the key is removed)
  await a.page
    .evaluate(p => {
      const store = (window as any).APP.store;
      if (p) return store.update({ profile: { pronouns: p } });
      delete store.state.profile.pronouns;
      store.update({ profile: {} });
    }, original)
    .catch(() => {});
  await closingChecks(evidence, [a, b], ALLOW);
}

// ---------- T6.9 ----------

async function recordingFile(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a", name: "A-admin" },
    { identity: "member1", account: "member1", slot: "b", name: "B-member" }
  ]);
  await enterTogether(evidence, [a, b], hub.hubId);
  const [ida, idb] = [await idOf(a), await idOf(b)];
  await evidence.check("The downloaded chutvrc-recording file: valid JSON with #avatar-pose entries, sent and received", "B5 K2", async () => {
    await input.startRecording(a.page);
    await Promise.all([input.walk(a.page, "w", 1500), input.walk(b.page, "s", 1500)]);
    await a.page.waitForTimeout(4000);
    const download = await input.stopRecording(a.page);
    const name = download.suggestedFilename();
    const file = evidence.file(`recording-${a.name}.json`);
    await download.saveAs(file);
    evidence.addFile(`recording-${a.name}.json`, "recording", `the recording A downloaded (${name})`);
    const text = fs.readFileSync(file, "utf8");
    const s = summariseRecording(text);
    let shape = "";
    try {
      const first = (JSON.parse(text) as any[]).find(e => e.l === "#avatar-pose" && e.s === 0);
      shape = first ? `a received pose entry: keys ${Object.keys(first).join(", ")}; message keys ${Object.keys(first.m ?? {}).join(", ")}` : "no received pose entry";
    } catch {
      shape = "not JSON";
    }
    return {
      ok: name.startsWith(`chutvrc-recording-${hub.hubId}-`) && s.valid && s.poseSent > 0 && s.poseReceived > 0 && s.poseSenders.includes(idb),
      summary: `${name}: ${s.valid ? "valid JSON" : `not JSON (${s.error})`}, ${s.entries} entries over ${s.spanSeconds} s; #avatar-pose ${s.poseSent} sent, ${s.poseReceived} received (from B ${s.poseReceivedBySender[idb] ?? 0}, A's own coming back ${s.poseReceivedBySender[ida] ?? 0}); ${shape}`,
      data: s
    };
  });
  await closingChecks(evidence, [a, b], ALLOW);
}

// ---------- T6.11 ----------

/** The items of the Features menu a client should get: Recording and Nimpro for everyone, Broadcast for the room's owner */
function expectedFeatureItems(on: FeatureSwitches, isOwner: boolean): string[] {
  return [on.recording && "Recording", on.broadcast && isOwner && "Broadcast", on.nimpro && "Nimpro"].filter((x): x is string => !!x);
}

/** What a client that has entered shows: the toolbar's Features button, the items in its popover, the settings the page was served and its role */
async function featuresMenuSeen(c: Client) {
  await input.toolbarButton(c.page, "Voice").waitFor({ state: "visible", timeout: 30_000 });
  // The menu asks the room's presence for the role; polled on a timer, as the page's frames may be held
  await c.page
    .waitForFunction(() => !!(window as any).APP.hubChannel?.presence?.state?.[(window as any).NAF.clientId]?.metas?.[0]?.roles, undefined, { timeout: 15_000, polling: 200 })
    .catch(() => {});
  await c.page.waitForTimeout(1000);
  const page = await c.page.evaluate(() => {
    const f = (window as any).APP_CONFIG?.features ?? {};
    const roles = (window as any).APP.hubChannel?.presence?.state?.[(window as any).NAF.clientId]?.metas?.[0]?.roles;
    return { settings: { recording: !!f.enable_recording, broadcast: !!f.enable_public_speaking, nimpro: !!f.enable_nimpro }, isOwner: !!roles?.owner };
  });
  const button = await input.toolbarButton(c.page, "Features").isVisible().catch(() => false);
  let items: string[] = [];
  if (button) {
    await input.openFeatures(c.page);
    await c.page.waitForTimeout(300);
    items = await input.featureItemsShown(c.page);
  }
  return { ...page, button, items };
}

async function featuresMenu(evidence: Evidence) {
  test.setTimeout(20 * 60_000);
  const hub = room(mainRoom("dialog"));
  const [owner, member] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a", name: "A-owner" },
    { identity: "member1", account: "member1", slot: "b", name: "B-member" }
  ]);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); A-owner is the room's owner, B-member is not. The settings are written to ret0.app_configs; each case waits ${APP_CONFIG_CACHE_MS / 1000} s for reticulum's cache and loads the room again, since a page reads them once, as it is served`);
  const cases: { name: string; tag: string; on: FeatureSwitches }[] = [
    { name: "all three off", tag: "all-off", on: { recording: false, broadcast: false, nimpro: false } },
    { name: "all three on", tag: "all-on", on: ALL_FEATURES_ON },
    { name: "Recording off", tag: "recording-off", on: { ...ALL_FEATURES_ON, recording: false } },
    { name: "Broadcast off", tag: "broadcast-off", on: { ...ALL_FEATURES_ON, broadcast: false } },
    { name: "Nimpro off", tag: "nimpro-off", on: { ...ALL_FEATURES_ON, nimpro: false } }
  ];
  const stored = readFeatureSettings();
  try {
    for (const k of cases) {
      setFeatureSettings(k.on);
      await sleep(APP_CONFIG_CACHE_MS);
      await Promise.all([owner, member].map(c => enterRoom(c, hub.hubId, { displayName: c.name })));
      const seen = { owner: await featuresMenuSeen(owner), member: await featuresMenuSeen(member) };
      await evidence.screenshot(owner, `features-${k.tag}-owner`);
      await evidence.screenshot(member, `features-${k.tag}-member`);
      for (const c of [owner, member]) await c.page.keyboard.press("Escape").catch(() => {});
      await evidence.check(`Features menu with ${k.name}: the owner and a member each get the items they should`, "B5 F2 F9", async () => {
        const judge = (s: typeof seen.owner, isOwner: boolean) => {
          const want = expectedFeatureItems(k.on, isOwner);
          const served = s.settings.recording === k.on.recording && s.settings.broadcast === k.on.broadcast && s.settings.nimpro === k.on.nimpro;
          return { want, ok: served && s.isOwner === isOwner && s.button === want.length > 0 && s.items.join() === want.join() };
        };
        const [o, m] = [judge(seen.owner, true), judge(seen.member, false)];
        const text = (name: string, s: typeof seen.owner, j: typeof o) =>
          `${name} (owner role ${s.isOwner}): ${s.button ? `Features with ${s.items.join(", ") || "nothing"}` : "no Features button"}, wanted ${j.want.join(", ") || "no Features button"}`;
        return {
          ok: o.ok && m.ok,
          summary: `${text("owner", seen.owner, o)}; ${text("member", seen.member, m)}; the page was served recording ${seen.owner.settings.recording}, public speaking ${seen.owner.settings.broadcast}, Nimpro ${seen.owner.settings.nimpro}`,
          data: { on: k.on, seen }
        };
      });
    }
  } finally {
    restoreFeatureSettings(stored);
    await sleep(APP_CONFIG_CACHE_MS);
  }
  evidence.note("after the test: the three settings put back as they were when it began, and reticulum's cache waited out");
  await closingChecks(evidence, [owner, member], ALLOW);
}

// ---------- The tests ----------

test.describe("T6 features and the upstream intake", () => {
  test("T6.1 admin pages: Email and WebRTC saved, the add-on and loader settings empty", meta("t6.1", null, "F6"), async ({ evidence }) => {
    test.skip(ON_LIVEKIT, "runs once, in the Dialog block (server settings; no media server involved)");
    await adminPages(evidence);
  });
  test("T6.6 Spoke: a new project, one edit, published, a room with the scene", meta("t6.6", null, "F7"), async ({ evidence }) => {
    test.skip(ON_LIVEKIT, "runs once, in the Dialog block (the room only shows the scene)");
    test.setTimeout(20 * 60_000);
    await spokeToRoom(evidence);
  });
  test("T6.7 bitecs room: loader and add-on on, a video fetched once, pinned items and a frame item return, grab", meta("t6.7", null, "N1 N2 N3 N4 N5 review-fix-1 review-fix-6 review-fix-7 review-fix-8"), async ({ evidence }) => {
    test.skip(ON_LIVEKIT, "runs once, in the Dialog block (the bitecs room is on Dialog)");
    test.setTimeout(20 * 60_000);
    await bitecsRoom(evidence);
  });
  test("T6.11 the Features menu follows its three admin settings and the room role", meta("t6.11", null, "B5 F2 F9"), async ({ evidence }) => {
    test.skip(ON_LIVEKIT, "runs once, in the Dialog block (app settings; the menu does not depend on the media server)");
    await featuresMenu(evidence);
  });
  for (const server of SERVERS) {
    const title = blockTitle(server);
    test(`T6.2 create a room, rename it, change its scene, enter from the lobby, chat, react, on ${title}`, meta("t6.2", server, "checklist-3"), async ({ evidence }) => {
      runsOn(server);
      await createRoomAndChat(evidence, server);
    });
    test(`T6.3 place an image, a video, a GLB and a PDF; grab, move, scale, pin, delete, on ${title}`, meta("t6.3", server, "B4 review-fix-1"), async ({ evidence }) => {
      runsOn(server);
      await placeAndHandle(evidence, server);
    });
    test(`T6.4 external image, video and GLB URLs through the proxy, on ${title}`, meta("t6.4", server, "F8"), async ({ evidence }) => {
      runsOn(server);
      await externalUrls(evidence, server);
    });
    test(`T6.5 pronouns separated by commas and spaces, on ${title}`, meta("t6.5", server, "upstream-intake"), async ({ evidence }) => {
      runsOn(server);
      await pronouns(evidence, server);
    });
    test(`T6.9 the downloaded recording file, on ${title}`, meta("t6.9", server, "B5 K2"), async ({ evidence }) => {
      runsOn(server);
      await recordingFile(evidence, server);
    });
  }
});

// ---------- T6.6 ----------

/**
 * Spoke as a person uses it, signed in as the admin through the shared sign-in of hubs.local:4000: Projects,
 * New Project, New Empty Project (the Crater template; its terrain model points at a retired reticulum.io
 * host, now an unresolvable name), one element added from the Elements panel, Publish to Hubs, the scene
 * page, a room with the scene, entered.
 */
async function spokeToRoom(evidence: Evidence) {
  const [a] = await startClients(evidence, [{ identity: "admin", account: "admin", slot: "a", name: "A-admin" }]);
  const page = a.page;
  const sceneName = `e2e T6.6 ${new Date().toISOString().slice(11, 19)}`;
  let sceneUrl = "";
  await evidence.check("Spoke opens signed in: Projects, New Project, New Empty Project", "F7", async () => {
    await page.goto(`${BASE_URL}/spoke/projects`, { waitUntil: "domcontentloaded" });
    await page.getByText("New Project", { exact: true }).first().click({ timeout: 90_000 });
    await page.getByText("New Empty Project", { exact: true }).first().click({ timeout: 60_000 });
    await page.waitForURL(/\/spoke\/projects\/new/, { timeout: 60_000 });
    // The editor is up once its viewport canvas and hierarchy show
    await page.locator("canvas").first().waitFor({ state: "visible", timeout: 120_000 });
    await page.getByText("Hierarchy", { exact: false }).first().waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(5000);
    // A dialog about the template's terrain that could not be loaded may be open; it is recorded and closed
    const dialog = (await page.locator('[role="dialog"], [class*="Dialog"]').first().textContent({ timeout: 2000 }).catch(() => null))?.slice(0, 200) ?? null;
    if (dialog) await page.getByRole("button", { name: /^(Ok|OK|Close|Cancel)$/ }).first().click({ timeout: 3000 }).catch(() => {});
    await evidence.screenshot(a, "spoke-editor");
    return { ok: true, summary: `editor open at ${page.url().replace(BASE_URL, "")}${dialog ? `; a dialog showed: "${dialog.replace(/\s+/g, " ")}"` : ""}`, data: { dialog } };
  });

  /** Publish Scene..., the Save Project dialog the first time, the scene's name, Save and Publish, the check's confirmation */
  const publish = async (name: string): Promise<{ url: string; error: string | null }> => {
    await page.getByText(/^Publish to Hubs\.\.\.$|^Publish Scene\.\.\.$/).first().click({ timeout: 20_000 });
    const saveProject = page.getByRole("button", { name: "Save Project" });
    const sceneName = page.locator("#sceneName");
    await saveProject.or(sceneName).first().waitFor({ state: "visible", timeout: 30_000 });
    if (await saveProject.isVisible()) {
      await saveProject.click();
      await sceneName.waitFor({ state: "visible", timeout: 60_000 });
    }
    await sceneName.fill(name);
    await page.getByRole("button", { name: "Save and Publish" }).click();
    const confirm = page.getByRole("button", { name: "Publish Scene" });
    const view = page.getByText("View Your Scene");
    const failed = page.getByText("Error Publishing Project");
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      if (await view.isVisible().catch(() => false)) {
        const url = (await page.locator("a", { hasText: "View Your Scene" }).first().getAttribute("href")) ?? "";
        await evidence.screenshot(a, "spoke-published");
        await page.getByRole("button", { name: /^(Close|Ok|OK)$/ }).first().click({ timeout: 3000 }).catch(() => page.keyboard.press("Escape"));
        return { url, error: null };
      }
      if (await failed.isVisible().catch(() => false)) {
        const text = ((await page.locator('[class*="Dialog"]').filter({ hasText: "Error Publishing Project" }).first().textContent().catch(() => null)) ?? "Error Publishing Project").replace(/\s+/g, " ");
        await evidence.screenshot(a, "spoke-publish-error");
        await page.getByRole("button", { name: "Ok", exact: true }).click({ timeout: 3000 }).catch(() => {});
        return { url: "", error: text.slice(0, 300) };
      }
      if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
    return { url: "", error: "neither published nor an error within 4 minutes" };
  };

  await evidence.check("Publish the new project as the template opened it", "F7", async () => {
    const r = await publish(`${sceneName} as opened`);
    if (r.url) sceneUrl = r.url;
    return {
      ok: !r.error,
      summary: r.error
        ? `publishing failed: "${r.error}" (the template's terrain model, on the retired and now unresolvable uploads-prod.reticulum.io.invalid, did not load)`
        : `published as ${r.url.replace(BASE_URL, "")}`,
      data: r
    };
  });

  // Read only: Spoke keeps its editor on window.editor; every change goes through its panels and keys
  const nodesOf = () =>
    page.evaluate(() => {
      const names: string[] = [];
      (window as any).editor?.scene?.traverse((o: any) => o.constructor?.nodeName && o !== (window as any).editor.scene && names.push(o.constructor.nodeName));
      return names;
    });

  await evidence.check("Edit one thing: remove the terrain model that could not load (Hierarchy, Delete)", "F7", async () => {
    const before = await nodesOf();
    await page.getByText("Terrain_Crater1.glb", { exact: true }).first().click({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(1000);
    const after = await nodesOf();
    await evidence.screenshot(a, "spoke-edited");
    return {
      ok: before.includes("Model") && !after.includes("Model"),
      summary: `nodes before: ${before.join(", ")}; after: ${after.join(", ")} (what is left has no material: finding 32 of BASELINE.md stops the next publish)`,
      data: { before, after }
    };
  });

  await evidence.check("Publish to Hubs after the edit: the scene is published", "F7", async () => {
    const r = await publish(sceneName);
    if (r.url) sceneUrl = r.url;
    const sceneId = sceneUrl.match(/\/scenes\/([A-Za-z0-9]+)/)?.[1] ?? "";
    const stored = sceneId ? sql(`select name, state from ret0.scenes where scene_sid = ${sqlText(sceneId)}`) : "";
    return {
      ok: !r.error && !!sceneId && stored.startsWith(sceneName),
      summary: r.error ? `publishing failed: "${r.error}"` : `published "${sceneName}" as ${sceneUrl.replace(BASE_URL, "") || "?"}; stored ${stored.replace(/\t/g, ", ") || "nothing"}`,
      data: { sceneUrl, stored }
    };
  });


  await evidence.check("A room with the published scene: created from the scene page and entered", "F7", async () => {
    if (!sceneUrl) return { ok: false, summary: "no scene URL" };
    const sceneId = sceneUrl.match(/\/scenes\/([A-Za-z0-9]+)/)![1];
    await page.goto(sceneUrl.startsWith("http") ? sceneUrl : `${BASE_URL}${sceneUrl}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Create a room with this scene").first().click({ timeout: 60_000 });
    await page.waitForURL(url => /^\/[A-Za-z0-9]{7}(\/|$)/.test(url.pathname), { timeout: 60_000 });
    const hubId = new URL(page.url()).pathname.split("/")[1];
    await enterRoom(a, hubId, { displayName: a.name });
    const loaded = await waitUntil(
      () => page.evaluate(() => {
        const env = document.querySelector("#environment-scene") as any;
        return !!env && env.object3D.children.length > 0 && (window as any).APP.hub?.scene?.scene_id;
      }),
      60_000
    );
    await page.waitForTimeout(3000);
    await evidence.screenshot(a, "room-with-scene");
    const sid = await page.evaluate(() => (window as any).APP.hub?.scene?.scene_id);
    evidence.note(`room ${hubId} with the scene ${sceneId}, created by this test, is left in the database (test data)`);
    return { ok: sid === sceneId && !!loaded.value, summary: `room ${hubId}: scene ${sid} (${sid === sceneId ? "the published one" : "not the published one"}); environment loaded ${!!loaded.value}`, data: { hubId, sid } };
  });
  await closingChecks(evidence, [a], [
    ...ALLOW,
    {
      pattern: /uploads-prod\.reticulum\.io\.invalid/,
      reason: "Spoke's Crater template still names its terrain model on a retired reticulum.io host, made unresolvable (.invalid) by the upstream intake; the failed load is the expected result of that change"
    }
  ]);
}

// ---------- T6.7 ----------

/**
 * Page code for the bitECS based client (window.$B is bitecs, window.$C the client's components, both put
 * there by the client's own debug helpers): every networked media entity with its URL, network id, whether
 * it is pinned (created by "reticulum") and where it is; every media frame with what it holds
 */
const BIT_STATE = `
  const w = APP.world, B = window.$B, C = window.$C;
  window.__e2eBitQueries ??= { media: B.defineQuery([C.MediaLoader, C.Networked]), frames: B.defineQuery([C.MediaFrame]) };
  const q = window.__e2eBitQueries;
  const V = AFRAME.THREE.Vector3;
  const pos = eid => { const o = w.eid2obj.get(eid); if (!o) return null; o.updateMatrixWorld(true); const p = new V().setFromMatrixPosition(o.matrixWorld); return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]; };
  return {
    media: q.media(w).map(eid => ({ eid, src: APP.getString(C.MediaLoader.src[eid]), nid: APP.getString(C.Networked.id[eid]), pinned: C.Networked.creator[eid] === APP.getSid("reticulum"), loaded: !!C.MediaLoader.mediaRef[eid] && B.hasComponent(w, C.MediaLoaded, C.MediaLoader.mediaRef[eid]), pos: pos(eid) })),
    frames: q.frames(w).map(eid => ({ eid, captured: B.hasComponent(w, C.NetworkedMediaFrame, eid) ? APP.getString(C.NetworkedMediaFrame.capturedNid[eid]) || null : null, pos: pos(eid) }))
  };`;

type BitMedia = { eid: number; src: string; nid: string; pinned: boolean; loaded: boolean; pos: number[] | null };
type BitState = { media: BitMedia[]; frames: { eid: number; captured: string | null; pos: number[] | null }[] };

const bitState = (c: Client): Promise<BitState> => c.page.evaluate(code => new Function(code)(), BIT_STATE);
const bitMedia = async (c: Client, src: string) => (await bitState(c)).media.filter(m => m.src === src);

/** Where a three.js object of the page (found by page code returning it) is drawn on the screen */
async function screenOfObject(c: Client, finder: string, arg?: unknown) {
  return c.page.evaluate(
    ({ finder, arg }) => {
      const o = new Function("arg", finder)(arg);
      if (!o) return null;
      const scene = (window as any).AFRAME.scenes[0];
      o.updateMatrixWorld(true);
      const v = new (window as any).AFRAME.THREE.Vector3().setFromMatrixPosition(o.matrixWorld).project(scene.camera);
      const r = scene.canvas.getBoundingClientRect();
      let shown = true;
      for (let p = o; p; p = p.parent) if (!p.visible) shown = false;
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, onScreen: v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95, shown };
    },
    { finder, arg }
  );
}

const BIT_MEDIA_OBJECT = `const C = window.$C; const eid = (window.__e2eBitQueries?.media(APP.world) || []).find(e => APP.getString(C.MediaLoader.src[e]) === arg.src && (!arg.nid || APP.getString(C.Networked.id[e]) === arg.nid)); return eid ? APP.world.eid2obj.get(eid) : null;`;

/** Turns to face a point of the scene with Q and E, as input.faceTowards does for an element (bitECS media have none) */
async function facePoint(c: Client, point: number[], snapDegrees = 45) {
  const angleTo = () =>
    c.page.evaluate(p => {
      const THREE = (window as any).AFRAME.THREE;
      const camera = (window as any).AFRAME.scenes[0].camera;
      const at = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
      const yaw = (x: number, z: number) => Math.atan2(-x, -z);
      const delta = yaw(p[0] - at.x, p[2] - at.z) - yaw(ahead.x, ahead.z);
      return (Math.atan2(Math.sin(delta), Math.cos(delta)) * 180) / Math.PI;
    }, point);
  const angle = await angleTo();
  const turns = Math.round(Math.abs(angle) / snapDegrees);
  if (turns > 0) await input.snapTurn(c.page, angle > 0 ? "left" : "right", turns);
  await c.page.waitForTimeout(300);
}

/** The object menu of the bitECS client (while frozen and the object hovered): one of its buttons by name, clicked */
async function bitMenuButton(c: Client, src: string, nid: string, button: "Pin Button" | "Unpin Button" | "Remove Button") {
  const m = (await bitMedia(c, src)).find(x => x.nid === nid);
  if (!m?.pos) throw new Error(`${src} is not in ${c.name}'s room`);
  await facePoint(c, m.pos);
  await input.holdKey(c.page, "Tab", 120);
  try {
    await c.page.waitForFunction(() => (window as any).AFRAME.scenes[0].is("frozen"), undefined, { timeout: 5000 });
    const at = await screenOfObject(c, BIT_MEDIA_OBJECT, { src, nid });
    if (!at?.onScreen) throw new Error(`${src} is not on screen`);
    await c.page.mouse.move(at.x, at.y, { steps: 4 });
    const finder = `return APP.world.scene.getObjectByName(${JSON.stringify(button)}) || null;`;
    let b = null as Awaited<ReturnType<typeof screenOfObject>>;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      b = await screenOfObject(c, finder);
      if (b?.shown && b.onScreen) break;
      await c.page.mouse.move(at.x + (Date.now() % 2 ? 1 : -1), at.y);
      await c.page.waitForTimeout(250);
    }
    if (!b?.shown || !b.onScreen) throw new Error(`the object menu's ${button} did not show`);
    await c.page.mouse.move(b.x, b.y, { steps: 5 });
    await c.page.waitForTimeout(200);
    await c.page.mouse.down();
    await c.page.waitForTimeout(80);
    await c.page.mouse.up();
    await c.page.waitForTimeout(800);
  } finally {
    if (await c.page.evaluate(() => (window as any).AFRAME.scenes[0].is("frozen")).catch(() => false)) await input.holdKey(c.page, "Tab", 120);
  }
}

/** Grabs a bitECS media object with the mouse and drags it, optionally pushing it away with the wheel */
/**
 * Grabs a bitECS media object with the mouse and drags it by (dx, dy) pixels. With `toDistance`, the wheel then
 * pushes or pulls the held object until it is that far from the camera (the cursor's distance changes with
 * the wheel: down brings it nearer, up sends it away), before it is let go.
 */
async function bitDrag(c: Client, src: string, nid: string, dx: number, dy: number, toDistance?: number, toPoint?: number[]) {
  const m = (await bitMedia(c, src)).find(x => x.nid === nid);
  if (!m?.pos) throw new Error(`${src} is not in ${c.name}'s room`);
  // Facing the point between the object and where it goes, so both are on the screen
  await facePoint(c, toPoint ? m.pos.map((v, i) => (v + toPoint[i]) / 2) : m.pos);
  const at = await screenOfObject(c, BIT_MEDIA_OBJECT, { src, nid });
  if (!at?.onScreen) throw new Error(`${src} is not on screen`);
  if (toPoint) {
    const target = await c.page.evaluate(p => {
      const scene = (window as any).AFRAME.scenes[0];
      const v = new (window as any).AFRAME.THREE.Vector3(p[0], p[1], p[2]).project(scene.camera);
      const r = scene.canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    }, toPoint);
    [dx, dy] = [target.x - at.x, target.y - at.y];
  }
  await c.page.mouse.move(at.x, at.y, { steps: 4 });
  await c.page.waitForTimeout(200);
  await c.page.mouse.down();
  await c.page.waitForTimeout(300);
  for (let i = 1; i <= 10; i++) {
    await c.page.mouse.move(at.x + (dx * i) / 10, at.y + (dy * i) / 10);
    await c.page.waitForTimeout(30);
  }
  if (toDistance !== undefined) {
    const distanceNow = () =>
      c.page.evaluate(
        ({ finder, arg }) => {
          const o = new Function("arg", finder)(arg);
          if (!o) return null;
          const THREE = (window as any).AFRAME.THREE;
          const cam = new THREE.Vector3().setFromMatrixPosition((window as any).AFRAME.scenes[0].camera.matrixWorld);
          return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).distanceTo(cam);
        },
        { finder: BIT_MEDIA_OBJECT, arg: { src, nid } }
      );
    for (let i = 0; i < 40; i++) {
      const d = await distanceNow();
      if (d === null || Math.abs(d - toDistance) < 0.12) break;
      await c.page.mouse.wheel(0, d < toDistance ? -40 : 40);
      await c.page.waitForTimeout(80);
    }
  }
  await c.page.waitForTimeout(300);
  await c.page.mouse.up();
  await c.page.waitForTimeout(1000);
}

/**
 * ?ecsDebug puts the client's bitecs and its components on window ($B, $C), which the probe reads; it also adds
 * an ECS objects button to the toolbar. Used for T6.7 only.
 */
const ECS_DEBUG = "?ecsDebug=true";

const BITECS_ON = JSON.stringify({ hubs_use_bitecs_based_client: true, addons: { "hubs-behavior-graphs-addon": true } });

/** Clears what earlier runs pinned in the room; `userData` sets the room's flags (null: the bitECS based client off) */
function resetBitecsRoom(hubId: string, userData: string | null) {
  sql(`delete from ret0.room_objects where hub_id = (select hub_id from ret0.hubs where hub_sid = ${sqlText(hubId)})`);
  sql(`update ret0.hubs set user_data = ${userData === null ? "null" : `${sqlText(userData)}::jsonb`} where hub_sid = ${sqlText(hubId)}`);
}

async function bitecsRoom(evidence: Evidence) {
  const hub = room("bitecs");
  resetBitecsRoom(hub.hubId, null);
  const scene = readFixtures().scenes?.bitecs;
  evidence.note(
    `room bitecs ${hub.hubId} (Dialog), scene ${scene ? `${scene.name} ${scene.sceneId}` : "?"}; objects pinned by earlier runs removed and the bitECS based client turned off before the test (test data), so the owner turns it on; both clients open the room with ?ecsDebug=true, which puts the client's bitecs components on window for the probe and adds an ECS objects button`
  );
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a", name: "A-admin" },
    { identity: "member1", account: "member1", slot: "b", name: "B-member" }
  ]);
  const videoRequests = new Map<Client, number[]>([
    [a, []],
    [b, []]
  ]);
  const t0 = Date.now();
  for (const c of [a, b]) c.context.on("request", r => void (r.url().split("?")[0].endsWith("/media/clock.mp4") && videoRequests.get(c)!.push(Date.now() - t0)));
  const answered = await Promise.all([a, b].map(c => answerAssetUrls(c, ASSETS_URL)));
  await enterRoom(a, hub.hubId, { displayName: a.name, query: ECS_DEBUG });

  await evidence.check("Room Settings: Enable bitECS based Client and the Behavior Graphs add-on; the page reloads after about 5 s", "N1", async () => {
    const loadedAt = (await readSession(a.page)).pageLoadedAt;
    await input.choosePopoverItem(a.page, "More", "Room Info and Settings");
    await a.page.getByRole("button", { name: "Edit", exact: true }).click();
    // The toggles are styled check boxes; their labels are clicked, as a person does
    const toggle = async (label: string | RegExp) => {
      const box = a.page.getByLabel(label);
      if (await box.isChecked()) return;
      const text = a.page.getByText(label).first();
      await text.scrollIntoViewIfNeeded();
      await text.click();
      if (!(await box.isChecked())) throw new Error(`the toggle "${label}" did not turn on`);
    };
    await toggle("Enable bitECS based Client");
    await a.page.waitForTimeout(500);
    await toggle("Hubs Behavior Graphs Add-on");
    await evidence.screenshot(a, "room-settings-bitecs");
    const clickedAt = Date.now();
    await a.page.getByRole("button", { name: "Apply", exact: true }).click();
    const prompt = await a.page
      .getByText(/This page will be reloaded in five seconds/)
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    await a.page.waitForFunction(t => performance.timeOrigin !== t, loadedAt, { timeout: 30_000 }).catch(() => {});
    const reloadedAfter = Date.now() - clickedAt;
    const stored = sql(`select user_data from ret0.hubs where hub_sid = ${sqlText(hub.hubId)}`);
    await enterRoom(a, hub.hubId, { displayName: a.name, query: ECS_DEBUG });
    const newLoader = await a.page.evaluate(() => !!(window as any).$C && !!(window as any).APP.world);
    return {
      ok: prompt && /"hubs_use_bitecs_based_client": true/.test(stored) && /behavior-graphs[^"]*": true/.test(stored),
      summary: `reload prompt shown ${prompt}; page loaded again ${(reloadedAfter / 1000).toFixed(1)} s after Apply; stored user_data ${stored}; bitECS components on the page ${newLoader}`,
      data: { stored }
    };
  });
  await enterRoom(b, hub.hubId, { displayName: b.name, query: ECS_DEBUG });
  await reenterSilentSenders([a, b], evidence, "so the test sees the bitECS client rather than the joint join", c => enterRoom(c, hub.hubId, { displayName: c.name, query: ECS_DEBUG }));
  await connectedCheck(evidence, [a, b], "dialog", "N1");

  evidence.notApplicable(
    "The Behavior Graph scene runs and stays in step on both",
    "N2",
    "open: no Behavior Graph scene. The examples repository holds only .blend files, and running Blender with the downloaded add-ons to export one was not permitted in this session (assets/behavior-graph/README.md)"
  );

  let videoNid = "";
  await evidence.check("Place a video: both show it, and it is fetched once", "N3 review-fix-7 review-fix-8", async () => {
    await input.placeFromUrl(a.page, VIDEO_URL);
    const shown = await waitUntil(async () => {
      const [ma, mb] = [await bitMedia(a, VIDEO_URL), await bitMedia(b, VIDEO_URL)];
      return ma.some(m => m.loaded) && mb.some(m => m.loaded) ? { ma, mb } : null;
    }, 30_000);
    videoNid = shown.value?.ma[0]?.nid ?? "";
    const appearedAt = Date.now() - t0;
    await a.page.waitForTimeout(25_000);
    const counts = [a, b].map(c => {
      const all = videoRequests.get(c)!;
      return { client: c.name, total: all.length, later: all.filter(t => t > appearedAt + 5000).length };
    });
    await evidence.screenshot(a, "video");
    return {
      ok: !!shown.value && counts.every(c => c.total >= 1 && c.later === 0),
      summary: `${shown.value ? `loaded on both after ${shown.ms} ms` : "not loaded on both within 30 s"}; requests for the video: ${counts.map(c => `${c.client} ${c.total} in all, ${c.later} in the 20 s from 5 s after it appeared`).join("; ")} (judged: none after it loaded)`,
      data: counts
    };
  });

  let imageNid = "";
  let frameItemNid = "";
  let frameTries: string[] = [];
  let framed = false;
  await evidence.check("Pin the video and an image (object menu); try to put a second image into the media frame", "N4", async () => {
    await input.placeFromUrl(a.page, IMAGE_URL);
    const image = await waitUntil(async () => (await bitMedia(a, IMAGE_URL))[0] ?? null, 30_000);
    imageNid = image.value?.nid ?? "";
    await a.page.waitForTimeout(2000);
    // Moved aside first, so the next image does not land on it
    if (imageNid) await bitDrag(a, IMAGE_URL, imageNid, -250, 0).catch(e => evidence.note(`moving the image aside: ${(e as Error).message}`));
    await bitMenuButton(a, VIDEO_URL, videoNid, "Pin Button").catch(e => evidence.note(`pinning the video: ${(e as Error).message}`));
    if (imageNid) await bitMenuButton(a, IMAGE_URL, imageNid, "Pin Button").catch(e => evidence.note(`pinning the image: ${(e as Error).message}`));
    // The second image is placed while A faces the frame, so it appears between A and the frame
    const frame = (await bitState(a)).frames[0];
    if (frame?.pos) await facePoint(a, frame.pos);
    await input.placeFromUrl(a.page, IMAGE_URL);
    const second = await waitUntil(async () => (await bitMedia(a, IMAGE_URL)).find(m => m.nid !== imageNid && m.loaded) ?? null, 30_000);
    frameItemNid = second.value?.nid ?? "";
    await a.page.waitForTimeout(1500);
    const tries: string[] = [];
    if (frameItemNid && frame?.pos) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const item = (await bitMedia(a, IMAGE_URL)).find(m => m.nid === frameItemNid);
        const at = await screenOfObject(a, BIT_MEDIA_OBJECT, { src: IMAGE_URL, nid: frameItemNid });
        if (!item?.pos || !at) break;
        await facePoint(a, frame.pos);
        const target = await a.page.evaluate(p => {
          const scene = (window as any).AFRAME.scenes[0];
          const v = new (window as any).AFRAME.THREE.Vector3(p[0], p[1], p[2]).project(scene.camera);
          const r = scene.canvas.getBoundingClientRect();
          return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
        }, frame.pos);
        const camera = await a.page.evaluate(() => {
          const v = new (window as any).AFRAME.THREE.Vector3().setFromMatrixPosition((window as any).AFRAME.scenes[0].camera.matrixWorld);
          return [v.x, v.y, v.z];
        });
        const itemAt = await screenOfObject(a, BIT_MEDIA_OBJECT, { src: IMAGE_URL, nid: frameItemNid });
        const toDistance = dist(camera, frame.pos);
        if (itemAt) await bitDrag(a, IMAGE_URL, frameItemNid, 0, 0, toDistance, frame.pos).catch(e => tries.push(`attempt ${attempt}: ${(e as Error).message}`));
        const held = (await bitState(a)).frames[0]?.captured;
        const after = (await bitMedia(a, IMAGE_URL)).find(m => m.nid === frameItemNid)?.pos ?? null;
        tries.push(`attempt ${attempt}: let go ${dist(after, frame.pos)} m from the frame's centre, the frame holds ${held === frameItemNid ? "it" : held ?? "nothing"}`);
        if (held === frameItemNid) break;
      }
    }
    await a.page.waitForTimeout(2000);
    const [sa, sb] = [await bitState(a), await bitState(b)];
    await evidence.screenshot(a, "pinned-and-framed");
    const pinnedAt = (s: BitState, nid: string) => !!s.media.find(m => m.nid === nid)?.pinned;
    frameTries = tries;
    framed = sa.frames[0]?.captured === frameItemNid && sb.frames[0]?.captured === frameItemNid;
    const holds = (s: BitState) => (s.frames[0]?.captured === frameItemNid ? "the second image" : s.frames[0]?.captured ?? "nothing");
    return {
      ok: pinnedAt(sa, videoNid) && pinnedAt(sa, imageNid) && pinnedAt(sb, videoNid) && pinnedAt(sb, imageNid),
      summary: `video pinned on A ${pinnedAt(sa, videoNid)}, B ${pinnedAt(sb, videoNid)}; image pinned on A ${pinnedAt(sa, imageNid)}, B ${pinnedAt(sb, imageNid)}; the frame holds ${holds(sa)} on A, ${holds(sb)} on B; ${tries.join("; ")}`,
      data: { sa, sb, videoNid, imageNid, frameItemNid, tries }
    };
  });

  if (!framed) {
    evidence.notApplicable(
      "A media-frame item is captured and comes back after re-entry",
      "N4 review-fix-6",
      `open (harness): the test did not get the image into the scene's media frame by dragging it with the mouse (${frameTries.join("; ") || "no attempt"}), so the frame's restore was not checked`
    );
  }
  await evidence.check("Leave and enter again: the pinned items return (and the frame's item, when it held one)", "N4 review-fix-6", async () => {
    const before = await bitState(a);
    for (const c of [a, b]) {
      await input.leaveRoom(c.page).catch(() => {});
      await c.page.waitForTimeout(2000);
    }
    await enterRoom(a, hub.hubId, { displayName: a.name, query: ECS_DEBUG });
    await enterRoom(b, hub.hubId, { displayName: b.name, query: ECS_DEBUG });
    const has = (s: BitState, nid: string) => s.media.some(m => m.nid === nid);
    const back = await waitUntil(async () => {
      const [sa, sb] = [await bitState(a), await bitState(b)];
      return has(sa, videoNid) && has(sa, imageNid) && has(sb, videoNid) && has(sb, imageNid) ? { sa, sb } : null;
    }, 30_000);
    await a.page.waitForTimeout(3000);
    const [sa, sb] = [await bitState(a), await bitState(b)];
    await evidence.screenshot(a, "after-re-entry");
    const moved = (nid: string) => dist(before.media.find(m => m.nid === nid)?.pos ?? null, sa.media.find(m => m.nid === nid)?.pos ?? null);
    const frameBack = (s: BitState) => s.frames[0]?.captured === frameItemNid && has(s, frameItemNid);
    return {
      ok: !!back.value && moved(videoNid) < 0.05 && moved(imageNid) < 0.05 && (!framed || (frameBack(sa) && frameBack(sb))),
      summary:
        `pinned video and image back on both: ${!!back.value}${back.value ? ` after ${back.ms} ms` : ""}, ${moved(videoNid)} m and ${moved(imageNid)} m from where they were; ` +
        `the frame holds its item again on A ${frameBack(sa)}, on B ${frameBack(sb)}`,
      data: { before, sa, sb }
    };
  });

  await evidence.check("Grab: an unpinned object moves and B agrees, the pinned video does not move", "N5 review-fix-1", async () => {
    await input.placeFromUrl(a.page, MODEL_URL);
    const model = await waitUntil(async () => (await bitMedia(a, MODEL_URL))[0] ?? null, 30_000);
    await a.page.waitForTimeout(2000);
    const nid = model.value?.nid ?? "";
    const p0 = model.value?.pos ?? null;
    await bitDrag(a, MODEL_URL, nid, 200, -40);
    await a.page.waitForTimeout(1500);
    const p1 = (await bitMedia(a, MODEL_URL)).find(m => m.nid === nid)?.pos ?? null;
    const pb = (await bitMedia(b, MODEL_URL)).find(m => m.nid === nid)?.pos ?? null;
    const v0 = (await bitMedia(a, VIDEO_URL)).find(m => m.nid === videoNid)?.pos ?? null;
    await bitDrag(a, VIDEO_URL, videoNid, 200, 0).catch(() => {});
    const v1 = (await bitMedia(a, VIDEO_URL)).find(m => m.nid === videoNid)?.pos ?? null;
    return {
      ok: dist(p0, p1) > 0.2 && dist(p1, pb) < 0.05 && dist(v0, v1) < 0.02,
      summary: `the GLB moved ${dist(p0, p1)} m on A, A and B differ by ${dist(p1, pb)} m afterwards; the pinned video moved ${dist(v0, v1)} m (judged: under 2 cm)`
    };
  });

  await evidence.check('No "Failed to deserialize component data" on either client', "N4 review-fix-6", async () => {
    const hits = [a, b].flatMap(c => c.log.filter(e => /Failed to deserialize component data/.test(e.text)).map(e => `${c.name}: ${e.text.slice(0, 160)}`));
    return { ok: hits.length === 0, summary: hits.length ? `${hits.length}: ${hits.slice(0, 3).join(" | ")}` : "none", data: hits };
  });
  await closingChecks(evidence, [a, b], ALLOW);
  evidence.note(`the media resolution of the assets service's URLs answered by the harness as a deployed server would answer for a public URL (clients/local-stack.ts answerAssetUrls; reticulum answers 500 for hubs.local here): ${answered.map((x, k) => `${[a, b][k].name} ${x.length}`).join(", ")} answers`);
  resetBitecsRoom(hub.hubId, BITECS_ON);
  evidence.note("after the test: the objects it pinned removed from the room; the room left with the bitECS based client and the add-on on");
}
