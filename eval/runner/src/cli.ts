#!/usr/bin/env node
// ChutVRC eval runner CLI.
//
// Usage:
//   runner start --label <slug> --room <url> [--duration 5m]
//                [--port 9099] [--out results/]
//                [--dialog-url https://dialog:7001]
//                [--host-stats docker|k8s|off]
//                [--container-filter dialog,reticulum,hubs-client]
//                [--public-url wss://eval.example.com]
//
// One run = one (hosting, SFU, label) tuple. Operator manually chooses the
// hosting+SFU; the runner just measures.

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { ReportServer, ClientRecord } from "./report-server";
import { DialogPoller } from "./dialog-poll";
import { HostStatsCollector, HostStatsMode } from "./host-stats";
import { Aggregator } from "./aggregator";

type Args = {
  label: string;
  room: string;
  duration_ms: number;
  port: number;
  out_dir: string;
  dialog_url: string | null;
  host_stats: HostStatsMode;
  container_filter: string[];
  public_url: string | null;
  k8s_nodes: string[];
  manual_start: boolean;
};

function parseDuration(s: string): number {
  const m = s.match(/^(\d+)(ms|s|m|h)?$/);
  if (!m) throw new Error("bad duration: " + s);
  const n = Number(m[1]);
  const unit = m[2] || "s";
  switch (unit) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
  }
  return n;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
      args[name] = val;
    }
  }
  if (!args.label) throw new Error("--label required");
  if (!args.room) throw new Error("--room required");
  return {
    label: args.label,
    room: args.room,
    duration_ms: parseDuration(args.duration || "300s"),
    port: Number(args.port || "9099"),
    out_dir: args.out || "results",
    dialog_url: args["dialog-url"] || process.env.EVAL_DIALOG_URL || null,
    host_stats: ((args["host-stats"] || "docker") as HostStatsMode),
    container_filter: (args["container-filter"] || "dialog,reticulum,hubs-client,coturn,db,postgrest")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
    public_url: args["public-url"] || process.env.EVAL_REPORT_PUBLIC_URL || null,
    k8s_nodes: (args["k8s-nodes"] || process.env.EVAL_K8S_NODES || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
    manual_start: "manual-start" in args
  };
}

function makeRunId(label: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
  const safe = label.replace(/[^a-zA-Z0-9_+\-]/g, "_");
  return stamp + "_" + safe;
}

function getGitRev(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), ".git", "HEAD"), "utf-8").trim();
  } catch (e) {
    return "unknown";
  }
}

function buildJoinUrl(room: string, publicUrl: string | null, port: number): string {
  // Construct an opinionated join URL for real-device participation.
  let report: string;
  if (publicUrl) {
    report = publicUrl;
  } else {
    // Default: assume devices reach the runner host on the same hostname.
    const host = process.env.EVAL_REPORT_HOST || "<runner-host>";
    report = "wss://" + host + ":" + port;
  }
  const sep = room.includes("?") ? "&" : "?";
  return (
    room +
    sep +
    "eval=1&mode=passive&label=<device>&report=" +
    encodeURIComponent(report)
  );
}

function start() {
  const args = parseArgs(process.argv.slice(3));
  const runId = makeRunId(args.label);
  const outDir = path.resolve(args.out_dir, runId);
  fs.mkdirSync(outDir, { recursive: true });

  console.log("=========================================================");
  console.log("chutvrc eval runner");
  console.log("  run_id      : " + runId);
  console.log("  label       : " + args.label);
  console.log("  room        : " + args.room);
  console.log("  duration    : " + args.duration_ms + " ms");
  console.log("  ws port     : " + args.port);
  console.log("  out_dir     : " + outDir);
  console.log("  dialog_url  : " + (args.dialog_url || "(none)"));
  console.log("  host-stats  : " + args.host_stats);
  console.log("  manual-start: " + args.manual_start);
  console.log("---------------------------------------------------------");
  console.log("Real-device join URL (replace <device> with a unique tag):");
  console.log("  " + buildJoinUrl(args.room, args.public_url, args.port));
  console.log("=========================================================");

  const aggregator = new Aggregator(outDir);
  const server = new ReportServer(runId, args.port, ev => aggregator.ingestEvent(ev));
  server.start();

  let dialog: DialogPoller | null = null;
  if (args.dialog_url) {
    dialog = new DialogPoller(args.dialog_url, snap => aggregator.ingestDialog(snap));
    dialog.start();
  }

  const host = new HostStatsCollector({
    mode: args.host_stats,
    sink: s => aggregator.ingestHost(s),
    filter: args.container_filter,
    k8sNodes: args.k8s_nodes
  });
  host.start();

  // Track when the actual test window started/ended. In auto (bot) mode
  // test_start_ts is the same as the runner process start time. In
  // manual-start mode it's set when the operator presses Enter.
  let test_start_ts: number | null = null;
  let test_end_ts: number | null = null;
  let started_utc: string = new Date().toISOString();

  const stopAll = () => {
    console.log("[runner] stopping…");
    server.stop();
    dialog?.stop();
    host.stop();
  };

  const finalize = () => {
    // If the test was cut short — SIGINT/SIGTERM after `go` but before the
    // duration elapsed — close the window at the current instant so the
    // aggregator still has a valid [start, end] to filter by. If the test
    // never started (manual mode, Ctrl-C before Enter) test_start_ts stays
    // null and the aggregator skips windowing.
    if (test_start_ts !== null && test_end_ts === null) test_end_ts = Date.now();
    const clients = server.clients();
    aggregator.finalize(clients, test_start_ts, test_end_ts);
    const manifest = {
      run_id: runId,
      label: args.label,
      started_utc,
      duration_ms: args.duration_ms,
      test_start_ts,
      test_end_ts,
      manual_start: args.manual_start,
      room: args.room,
      dialog_url: args.dialog_url,
      host_stats: args.host_stats,
      git_rev: getGitRev(),
      clients: clients.map(c => ({
        client_id: c.client_id,
        label: c.label,
        mode: c.mode,
        user_agent: c.user_agent,
        sfu_kind: c.sfu_kind,
        hub_id: c.hub_id,
        sample_rate: c.sample_rate,
        connected_at_ms: c.connected_at,
        disconnected_at_ms: c.disconnected_at,
        clock_offset_samples: c.clock_offsets.length,
        clock_ci_ms: medianCi(c.clock_offsets.map(s => s.ci_ms)),
        warnings: c.warnings
      }))
    };
    fs.writeFileSync(path.join(outDir, "run.json"), JSON.stringify(manifest, null, 2));
    console.log("[runner] run.json written");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    stopAll();
    finalize();
  });
  process.on("SIGINT", () => {
    stopAll();
    finalize();
  });

  // beginTest: send `go` to all probes, start the duration timer, schedule
  // the stop+disconnect+finalize sequence when the duration elapses. Used
  // immediately (auto mode) or when Enter is pressed (manual mode).
  const beginTest = () => {
    test_start_ts = Date.now();
    started_utc = new Date().toISOString();
    server.broadcast({
      type: "go",
      t_server_ms: test_start_ts,
      test_duration_ms: args.duration_ms
    });
    console.log(
      "[runner] sent go; test running for " + Math.round(args.duration_ms / 1000) + "s"
    );

    setTimeout(() => {
      test_end_ts = Date.now();
      // Tell every probe to leave the room cleanly (Hubs will show
      // ExitedRoomScreen with the refresh button). Wait ~3 s so the SFU
      // disconnect and React unmount have time to land before we close
      // the WS server underneath the probes.
      server.broadcast({ type: "stop", disconnect: true });
      console.log("[runner] sent stop+disconnect to all probes; waiting 3 s for cleanup…");
      setTimeout(() => {
        stopAll();
        finalize();
      }, 3000);
    }, args.duration_ms);
  };

  if (args.manual_start) {
    // PHASE 1 — WAIT. Render a live list of connected clients and prompt
    // the operator to press Enter when ready. Re-render on any
    // connect/disconnect (debounced ~150 ms so a burst of joins doesn't
    // spam the terminal). Clock-sync and the hello handshake run in this
    // phase (probe side decides what to defer); chirp emit / detection /
    // rtc-stats are deferred until the go broadcast.
    console.log("");
    console.log("[runner] manual-start: waiting for clients…");
    console.log("[runner] open the join URL on each device, then press Enter to begin.");
    console.log("");

    let refreshScheduled = false;
    const render = () => {
      refreshScheduled = false;
      const clients = server.clients().filter(c => c.disconnected_at === null);
      const labels = clients.map(c => c.label + " (" + c.mode + ")").join(", ");
      console.log(
        "[runner] [" + clients.length + " connected] " + (labels || "(none yet)")
      );
    };
    const scheduleRender = () => {
      if (refreshScheduled) return;
      refreshScheduled = true;
      setTimeout(render, 150);
    };
    server.onConnect((rec: ClientRecord) => {
      console.log("[runner] + " + rec.label + " (" + rec.mode + ")");
      scheduleRender();
    });
    server.onDisconnect((cid: string) => {
      console.log("[runner] - client_id=" + cid);
      scheduleRender();
    });

    const rl = readline.createInterface({ input: process.stdin });
    rl.once("line", () => {
      rl.close();
      const clients = server.clients().filter(c => c.disconnected_at === null);
      if (clients.length < 2) {
        console.warn(
          "[runner] only " +
            clients.length +
            " client(s) connected — need at least 1 speaker + 1 listener. Aborting."
        );
        stopAll();
        process.exit(1);
        return;
      }
      const speakers = clients.filter(c => c.mode === "speaker");
      if (speakers.length === 0) {
        console.warn(
          "[runner] no mode=speaker client connected; chirp pairs will be empty. Aborting."
        );
        stopAll();
        process.exit(1);
        return;
      }
      // PHASE 2 — GO.
      beginTest();
    });
  } else {
    // Bot-mode / legacy behavior: probes auto-arm on ack-hello (via the
    // `eval_auto_start=1` query param appended by run-bot.js). We start the
    // duration timer immediately. We still send `go` to every connected
    // probe so any client started without the auto-start query param still
    // picks up the timing.
    beginTest();
  }
}

function medianCi(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case "start":
      start();
      break;
    case "version":
    case "--version":
      console.log("chutvrc-eval-runner 0.1.0");
      break;
    default:
      console.log("Usage:");
      console.log(
        "  runner start --label <slug> --room <url> [--duration 5m] [--port 9099]"
      );
      console.log("               [--out results/] [--dialog-url https://dialog:7001]");
      console.log(
        "               [--host-stats docker|k8s|off] [--container-filter ...]"
      );
      console.log(
        "               [--public-url wss://eval.example.com] [--k8s-nodes node1,node2]"
      );
      console.log("               [--manual-start]");
      console.log("  --manual-start  Wait for the operator to press Enter before");
      console.log("                  starting the duration timer; useful for real-device");
      console.log("                  runs where you bring up browsers manually.");
      process.exit(cmd ? 1 : 0);
  }
}

main();
