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
import { ReportServer } from "./report-server";
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
      .filter(Boolean)
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
  console.log("  run_id     : " + runId);
  console.log("  label      : " + args.label);
  console.log("  room       : " + args.room);
  console.log("  duration   : " + args.duration_ms + " ms");
  console.log("  ws port    : " + args.port);
  console.log("  out_dir    : " + outDir);
  console.log("  dialog_url : " + (args.dialog_url || "(none)"));
  console.log("  host-stats : " + args.host_stats);
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

  const stopAll = () => {
    console.log("[runner] stopping…");
    server.stop();
    dialog?.stop();
    host.stop();
  };

  process.on("SIGTERM", () => {
    stopAll();
    finalize();
  });
  process.on("SIGINT", () => {
    stopAll();
    finalize();
  });

  setTimeout(() => {
    stopAll();
    finalize();
  }, args.duration_ms);

  const finalize = () => {
    const clients = server.clients();
    aggregator.finalize(clients);
    const manifest = {
      run_id: runId,
      label: args.label,
      started_utc: new Date().toISOString(),
      duration_ms: args.duration_ms,
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
      process.exit(cmd ? 1 : 0);
  }
}

main();
