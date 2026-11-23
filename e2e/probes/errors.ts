// Errors probe (plan 3.2, T6.10): console errors, uncaught exceptions and failed requests of the
// clients, sorted into those an allow-list explains and the rest; and any request to a reticulum.io host
// (T6.8: the upstream intake must not reach Mozilla's servers).
import type { Client, LogEntry } from "../clients/launch";

export type AllowEntry = {
  /** Matched against the entry's text and URL */
  pattern: RegExp;
  /** Which entry types it applies to; all error types when left out */
  types?: LogEntry["type"][];
  /** Why this is accepted; shown in the report */
  reason: string;
};

export type ErrorEntry = LogEntry & { client: string; allowedBy?: string };

const ERROR_TYPES = new Set(["error", "pageerror", "requestfailed"]);

/** Every error-type entry of the clients, each marked with the allow-list reason that covers it */
export function collectErrors(clients: Client[], allowList: AllowEntry[]): { unexpected: ErrorEntry[]; allowed: ErrorEntry[] } {
  const unexpected: ErrorEntry[] = [];
  const allowed: ErrorEntry[] = [];
  for (const client of clients) {
    for (const entry of client.log) {
      if (!ERROR_TYPES.has(entry.type)) continue;
      const subject = `${entry.text} ${entry.url ?? ""}`;
      const rule = allowList.find(a => (!a.types || a.types.includes(entry.type)) && a.pattern.test(subject));
      (rule ? allowed : unexpected).push({ ...entry, client: client.name, allowedBy: rule?.reason });
    }
  }
  return { unexpected, allowed };
}

/** Counts per allow-list reason, for the report */
export function countByReason(entries: ErrorEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.allowedBy ?? "unexpected"] = (counts[e.allowedBy ?? "unexpected"] ?? 0) + 1;
  return counts;
}

/** Hosts under reticulum.io any client contacted */
export function reticulumIoHosts(clients: Client[]): string[] {
  return [...new Set(clients.flatMap(c => [...c.hosts]))].filter(h => /(^|\.)reticulum\.io(:|$)/.test(h));
}

/**
 * Init script: notes every send on a data channel that is not open yet, with the channel's label, as a
 * console warning. Chromium's InvalidStateError for such a send does not name the channel; this does.
 * The send itself is unchanged (it still throws).
 */
export const SEND_WATCH = `(() => {
  const send = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function (data) {
    if (this.readyState !== "open") console.warn("[e2e] data channel send while " + this.readyState + ": " + this.label);
    return send.call(this, data);
  };
})();`;

/** Labels of the sends SEND_WATCH saw before their channel was open, counted per client and label */
export function sendsBeforeOpen(clients: Client[]): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const client of clients) {
    const counts: Record<string, number> = {};
    for (const e of client.log) {
      const m = e.text.match(/^\[e2e\] data channel send while \w+: (.+)$/);
      if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
    }
    result[client.name] = counts;
  }
  return result;
}
