// Periodically scrapes container/host resource metrics.
//
// Two modes:
//   - docker: reads /containers/<id>/stats?stream=0 from the Docker Engine
//             socket over plain HTTP. No SDK dep.
//   - k8s:    reads https://<node>:10250/metrics/cadvisor with the SA bearer
//             token; parses Prometheus text format.
//   - off:    skip; rely on probe-side pc.getStats() only.

import * as http from "http";
import * as https from "https";
import * as fs from "fs";

const POLL_MS = 1000;

export type HostStatSample = {
  ts_ms: number;
  source: "docker" | "k8s";
  container: string;
  cpu_pct: number | null;
  mem_bytes: number | null;
  net_rx_bytes: number | null;
  net_tx_bytes: number | null;
};

export type HostStatsSink = (sample: HostStatSample) => void;

export type HostStatsMode = "docker" | "k8s" | "off";

export class HostStatsCollector {
  private _mode: HostStatsMode;
  private _sink: HostStatsSink;
  private _filter: string[];
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _dockerSocket: string;
  private _k8sNodes: string[];
  private _k8sToken: string | null = null;

  constructor(opts: {
    mode: HostStatsMode;
    sink: HostStatsSink;
    filter: string[];
    dockerSocket?: string;
    k8sNodes?: string[];
  }) {
    this._mode = opts.mode;
    this._sink = opts.sink;
    this._filter = opts.filter;
    this._dockerSocket = opts.dockerSocket || "/var/run/docker.sock";
    this._k8sNodes = opts.k8sNodes || [];
    if (opts.mode === "k8s") {
      try {
        this._k8sToken = fs
          .readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf-8")
          .trim();
      } catch (e) {
        console.warn("[runner] host-stats k8s mode: no SA token found");
      }
    }
  }

  start() {
    if (this._mode === "off") return;
    this._timer = setInterval(() => this._poll().catch(() => {}), POLL_MS);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _poll() {
    if (this._mode === "docker") await this._pollDocker();
    if (this._mode === "k8s") await this._pollK8s();
  }

  private _httpUnix(method: string, socketPath: string, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath,
          path,
          method,
          headers: { Host: "localhost" }
        },
        res => {
          let body = "";
          res.on("data", chunk => (body += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(body);
            } else {
              reject(new Error("HTTP " + res.statusCode + ": " + body.slice(0, 200)));
            }
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  private async _pollDocker() {
    try {
      const list = JSON.parse(await this._httpUnix("GET", this._dockerSocket, "/containers/json"));
      for (const c of list) {
        const name: string = (c.Names && c.Names[0]) ? c.Names[0].replace(/^\//, "") : c.Id.slice(0, 12);
        if (this._filter.length > 0 && !this._filter.some(f => name.includes(f))) continue;
        try {
          const stats = JSON.parse(
            await this._httpUnix("GET", this._dockerSocket, "/containers/" + c.Id + "/stats?stream=0")
          );
          const sample = parseDockerStats(name, stats);
          if (sample) this._sink(sample);
        } catch (e) {
          // Skip this container's snapshot.
        }
      }
    } catch (e: any) {
      console.warn("[runner] host-stats docker poll error:", e?.message);
    }
  }

  private _httpsGet(url: string, token: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https.request(
        {
          host: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: "GET",
          headers: { Authorization: "Bearer " + token, Accept: "text/plain" },
          rejectUnauthorized: false
        },
        res => {
          let body = "";
          res.on("data", chunk => (body += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode < 400) resolve(body);
            else reject(new Error("HTTP " + res.statusCode));
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  private async _pollK8s() {
    if (!this._k8sToken) return;
    for (const node of this._k8sNodes) {
      try {
        const text = await this._httpsGet(
          "https://" + node + ":10250/metrics/cadvisor",
          this._k8sToken
        );
        for (const sample of parseCadvisor(text, this._filter)) {
          this._sink(sample);
        }
      } catch (e: any) {
        // Skip this node.
      }
    }
  }
}

// Compute Docker stats: docker stats JSON has cpu_stats / precpu_stats with
// totals; cpu pct = (cpu_delta / sys_delta) * online_cpus * 100.
function parseDockerStats(name: string, s: any): HostStatSample | null {
  if (!s || !s.cpu_stats) return null;
  const cpuDelta =
    (s.cpu_stats.cpu_usage?.total_usage || 0) - (s.precpu_stats?.cpu_usage?.total_usage || 0);
  const sysDelta = (s.cpu_stats.system_cpu_usage || 0) - (s.precpu_stats?.system_cpu_usage || 0);
  const onlineCpus = s.cpu_stats.online_cpus || 1;
  const cpu_pct = sysDelta > 0 ? (cpuDelta / sysDelta) * onlineCpus * 100 : null;
  const mem_bytes = s.memory_stats?.usage ?? null;
  let net_rx = 0;
  let net_tx = 0;
  if (s.networks) {
    for (const iface of Object.values(s.networks) as any[]) {
      net_rx += iface.rx_bytes || 0;
      net_tx += iface.tx_bytes || 0;
    }
  }
  return {
    ts_ms: Date.now(),
    source: "docker",
    container: name,
    cpu_pct,
    mem_bytes,
    net_rx_bytes: net_rx,
    net_tx_bytes: net_tx
  };
}

// Minimal Prometheus text-format parser for cAdvisor lines we care about.
// We only need totals; aggregator can diff across time to compute rates.
function parseCadvisor(text: string, filter: string[]): HostStatSample[] {
  const out: HostStatSample[] = [];
  const ts = Date.now();
  // Aggregate by container name.
  type Agg = { cpu_seconds_total: number | null; memory_bytes: number | null; rx: number | null; tx: number | null };
  const agg = new Map<string, Agg>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+(\S+)/);
    if (!m) continue;
    const metric = m[1];
    const labels = m[2];
    const valStr = m[3];
    const val = Number(valStr);
    if (!isFinite(val)) continue;
    const nm = labels.match(/container=\"([^"]+)\"/);
    const container = nm ? nm[1] : null;
    if (!container) continue;
    if (filter.length > 0 && !filter.some(f => container.includes(f))) continue;
    let entry = agg.get(container);
    if (!entry) {
      entry = { cpu_seconds_total: null, memory_bytes: null, rx: null, tx: null };
      agg.set(container, entry);
    }
    if (metric === "container_cpu_usage_seconds_total") entry.cpu_seconds_total = val;
    if (metric === "container_memory_usage_bytes") entry.memory_bytes = val;
    if (metric === "container_network_receive_bytes_total") entry.rx = (entry.rx ?? 0) + val;
    if (metric === "container_network_transmit_bytes_total") entry.tx = (entry.tx ?? 0) + val;
  }
  for (const [name, a] of agg.entries()) {
    out.push({
      ts_ms: ts,
      source: "k8s",
      container: name,
      cpu_pct: null, // cAdvisor here gives cumulative seconds; aggregator diffs.
      mem_bytes: a.memory_bytes,
      net_rx_bytes: a.rx,
      net_tx_bytes: a.tx
    });
  }
  return out;
}
