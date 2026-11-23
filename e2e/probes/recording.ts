// Recording probe (plan 3.2 packet log, B5, T6.9): reads a file the recording button downloaded
// ("chutvrc-recording-<room>-<time>", JSON) and counts its entries per channel label and direction.
// Entries are { l: label, m: decoded message, t: time, s: 1 sent / 0 received }. On the adapter build
// (develop) poses travel as #avatar-RIG (and HEAD, LEFT, RIGHT), and its Dialog adapter also writes every
// raw message it sends or receives without "s"; those are counted as unmarked.

export type RecordingSummary = {
  valid: boolean;
  error?: string;
  entries: number;
  /** The label counted as poses */
  poseLabel: string;
  /** label -> { sent, received, unmarked (no direction) } */
  byLabel: Record<string, { sent: number; received: number; unmarked: number }>;
  poseSent: number;
  poseReceived: number;
  /** Client ids found in received pose entries, with how many each */
  poseSenders: string[];
  poseReceivedBySender: Record<string, number>;
  /** Time covered by the entries, in seconds */
  spanSeconds: number;
};

export function summariseRecording(text: string, poseLabel = "#avatar-pose"): RecordingSummary {
  let entries: any[];
  try {
    entries = JSON.parse(text);
    if (!Array.isArray(entries)) throw new Error("not an array");
  } catch (e) {
    return { valid: false, error: (e as Error).message, entries: 0, poseLabel, byLabel: {}, poseSent: 0, poseReceived: 0, poseSenders: [], poseReceivedBySender: {}, spanSeconds: 0 };
  }
  const byLabel: RecordingSummary["byLabel"] = {};
  const senders: Record<string, number> = {};
  for (const e of entries) {
    const counts = (byLabel[e.l] ??= { sent: 0, received: 0, unmarked: 0 });
    if (e.s === 1) counts.sent++;
    else if (e.s === 0) counts.received++;
    else counts.unmarked++;
    if (e.l === poseLabel && e.s === 0 && e.m?.c) senders[e.m.c] = (senders[e.m.c] ?? 0) + 1;
  }
  const times = entries.map(e => e.t).filter((t): t is number => typeof t === "number");
  return {
    valid: true,
    entries: entries.length,
    poseLabel,
    byLabel,
    poseSent: byLabel[poseLabel]?.sent ?? 0,
    poseReceived: byLabel[poseLabel]?.received ?? 0,
    poseSenders: Object.keys(senders),
    poseReceivedBySender: senders,
    spanSeconds: times.length ? +((Math.max(...times) - Math.min(...times)) / 1000).toFixed(1) : 0
  };
}
