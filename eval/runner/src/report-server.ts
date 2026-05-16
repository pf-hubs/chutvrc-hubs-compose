import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import {
  ClockOffsetMsg,
  ClockPingMsg,
  EVAL_PROTOCOL_VERSION,
  EventBatchMsg,
  HelloMsg,
  ProbeEvent,
  ProbeToRunnerMsg,
  RunnerToProbeMsg
} from "./types";

export type ClientId = string;

export type ClockOffsetSample = {
  at_t_client_ms: number;
  offset_ms: number;
  ci_ms: number;
};

export type ClientRecord = {
  ws_id: number;
  client_id: ClientId;
  label: string;
  mode: "speaker" | "passive";
  user_agent: string;
  sfu_kind: string | null;
  hub_id: string | null;
  sample_rate: number;
  connected_at: number;
  disconnected_at: number | null;
  clock_offsets: ClockOffsetSample[];
  warnings: string[];
};

export type EventRow = ProbeEvent & {
  client_id: ClientId;
  label: string;
};

export class ReportServer {
  private _wss: WebSocketServer;
  private _runId: string;
  private _clients = new Map<ClientId, ClientRecord>();
  private _wsToClient = new Map<WebSocket, ClientId | null>();
  private _nextWsId = 0;
  private _onEvent: (event: EventRow) => void;
  private _speakerCount = 0;
  private _labelToClient = new Map<string, ClientId>();
  private _started = false;

  constructor(runId: string, port: number, onEvent: (event: EventRow) => void) {
    this._runId = runId;
    this._onEvent = onEvent;
    this._wss = new WebSocketServer({ port });
    this._wss.on("connection", (ws, req) => this._onConnection(ws, req));
  }

  start() {
    this._started = true;
  }

  stop() {
    for (const ws of this._wsToClient.keys()) {
      try {
        ws.send(JSON.stringify({ type: "stop" } as RunnerToProbeMsg));
      } catch (e) {
        // ignore
      }
    }
    this._wss.close();
  }

  clients(): ClientRecord[] {
    return Array.from(this._clients.values());
  }

  private _onConnection(ws: WebSocket, req: IncomingMessage) {
    const wsId = this._nextWsId++;
    this._wsToClient.set(ws, null);
    const remote = req.socket.remoteAddress + ":" + req.socket.remotePort;
    console.log("[runner] WS connect ws_id=" + wsId + " from=" + remote);

    ws.on("message", raw => {
      let msg: ProbeToRunnerMsg | null = null;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        console.warn("[runner] bad JSON from ws_id=" + wsId);
        return;
      }
      if (!msg) return;
      this._dispatch(ws, wsId, msg);
    });

    ws.on("close", () => {
      const clientId = this._wsToClient.get(ws);
      if (clientId) {
        const rec = this._clients.get(clientId);
        if (rec) rec.disconnected_at = Date.now();
        console.log("[runner] WS close client_id=" + clientId);
      } else {
        console.log("[runner] WS close (no hello received) ws_id=" + wsId);
      }
      this._wsToClient.delete(ws);
    });

    ws.on("error", err => {
      console.warn("[runner] WS error ws_id=" + wsId + ":", err.message);
    });
  }

  private _dispatch(ws: WebSocket, wsId: number, msg: ProbeToRunnerMsg) {
    switch (msg.type) {
      case "hello":
        this._handleHello(ws, wsId, msg as HelloMsg);
        break;
      case "clock-ping":
        this._handleClockPing(ws, msg as ClockPingMsg);
        break;
      case "clock-offset":
        this._handleClockOffset(ws, msg as ClockOffsetMsg);
        break;
      case "event-batch":
        this._handleEventBatch(ws, msg as EventBatchMsg);
        break;
      case "bye":
        try {
          ws.close();
        } catch (e) {
          // ignore
        }
        break;
    }
  }

  private _handleHello(ws: WebSocket, wsId: number, msg: HelloMsg) {
    const warnings: string[] = [];
    if (msg.protocol !== EVAL_PROTOCOL_VERSION) {
      warnings.push(
        "protocol mismatch: probe=" + msg.protocol + " runner=" + EVAL_PROTOCOL_VERSION
      );
    }
    const clientId = msg.client_id || "anon-ws-" + wsId;
    if (this._labelToClient.has(msg.label) && this._labelToClient.get(msg.label) !== clientId) {
      warnings.push("label collision: '" + msg.label + "' already in use");
    }
    this._labelToClient.set(msg.label, clientId);

    if (msg.mode === "speaker") {
      this._speakerCount++;
      if (this._speakerCount > 1) {
        warnings.push(
          "more than one mode=speaker connected; chirp detection cannot disambiguate sources"
        );
      }
    }

    const record: ClientRecord = {
      ws_id: wsId,
      client_id: clientId,
      label: msg.label,
      mode: msg.mode,
      user_agent: msg.user_agent,
      sfu_kind: msg.sfu_kind,
      hub_id: msg.hub_id,
      sample_rate: msg.sample_rate,
      connected_at: Date.now(),
      disconnected_at: null,
      clock_offsets: [],
      warnings
    };
    this._clients.set(clientId, record);
    this._wsToClient.set(ws, clientId);

    const ack: RunnerToProbeMsg = {
      type: "ack-hello",
      run_id: this._runId,
      warnings
    };
    try {
      ws.send(JSON.stringify(ack));
    } catch (e) {
      // ignore
    }
    console.log(
      "[runner] hello client_id=" +
        clientId +
        " label=" +
        msg.label +
        " mode=" +
        msg.mode +
        " sfu=" +
        msg.sfu_kind
    );
    if (warnings.length > 0) for (const w of warnings) console.warn("[runner]  warn:", w);
  }

  private _handleClockPing(ws: WebSocket, msg: ClockPingMsg) {
    const reply: RunnerToProbeMsg = {
      type: "clock-pong",
      seq: msg.seq,
      t_client_ms: msg.t_client_ms,
      t_server_ms: Date.now()
    };
    try {
      ws.send(JSON.stringify(reply));
    } catch (e) {
      // ignore
    }
  }

  private _handleClockOffset(ws: WebSocket, msg: ClockOffsetMsg) {
    const clientId = this._wsToClient.get(ws);
    if (!clientId) return;
    const rec = this._clients.get(clientId);
    if (!rec) return;
    rec.clock_offsets.push({
      at_t_client_ms: msg.at_t_client_ms,
      offset_ms: msg.offset_ms,
      ci_ms: msg.ci_ms
    });
  }

  private _handleEventBatch(ws: WebSocket, msg: EventBatchMsg) {
    const clientId = this._wsToClient.get(ws);
    if (!clientId) return;
    const rec = this._clients.get(clientId);
    if (!rec) return;
    for (const e of msg.events) {
      this._onEvent({ ...e, client_id: clientId, label: rec.label });
    }
  }
}
