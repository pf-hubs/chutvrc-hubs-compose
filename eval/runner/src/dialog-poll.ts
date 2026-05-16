// Polls Dialog's /report HTTP admin endpoint at 1 Hz.
// Yields snapshots that the aggregator writes to dialog.csv.
//
// Endpoint shape (from services/dialog/index.js lines 191–212):
//   GET /meta   -> { cap }
//   GET /report -> Map(workerLoadMan) with _hostname, _capacity

const POLL_MS = 1000;

export type DialogSnapshot = {
  ts_ms: number;
  hostname: string | null;
  capacity: number | null;
  raw: unknown;
};

export type DialogPollSink = (snap: DialogSnapshot) => void;

export class DialogPoller {
  private _url: string;
  private _sink: DialogPollSink;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _consecutiveErrors = 0;

  constructor(url: string, sink: DialogPollSink) {
    this._url = url.replace(/\/+$/, "");
    this._sink = sink;
  }

  start() {
    this._timer = setInterval(() => this._poll(), POLL_MS);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _poll() {
    try {
      const res = await fetch(this._url + "/report", {
        // Allow self-signed certs commonly used in chutvrc dev.
        // @ts-ignore Node fetch undici extension
        dispatcher: undefined
      });
      if (!res.ok) {
        this._consecutiveErrors++;
        return;
      }
      const data = await res.json();
      this._consecutiveErrors = 0;
      let hostname: string | null = null;
      let capacity: number | null = null;
      if (data && typeof data === "object") {
        hostname = (data as any)._hostname || null;
        capacity = typeof (data as any)._capacity === "number" ? (data as any)._capacity : null;
      }
      this._sink({
        ts_ms: Date.now(),
        hostname,
        capacity,
        raw: data
      });
    } catch (e: any) {
      this._consecutiveErrors++;
      if (this._consecutiveErrors === 5) {
        console.warn("[runner] dialog-poll failing:", e?.message);
      }
    }
  }
}
