// The poor-network client's link (plan 2.1 modifier): shaped with tc netem inside the netclient
// container. "offline" drops every packet out of the container's interface, which is the one way to take a
// client off the network that also stops WebRTC (the browser's own offline emulation does not reach WebRTC).
//
// The harness drives the container's browsers over that same interface (Playwright's browser server on port
// 3100), so the shaping goes into one band of a priority queue and the server's own replies (source port
// 3100) into another band without netem: the test keeps talking to the page at full speed while the page's
// traffic to the stack is shaped. Without that, a page call made during a blackout would wait for the link.
import { composeE2e } from "../lib/stack";

export type LinkShape = "normal" | "offline" | { netem: string[] };

const tc = (...args: string[]) => composeE2e(["exec", "-T", "netclient", "tc", ...args]);

export function shapeLink(shape: LinkShape): string {
  try {
    tc("qdisc", "del", "dev", "eth0", "root");
  } catch {
    // No qdisc set: already normal
  }
  if (shape === "normal") return "normal";
  const netem = shape === "offline" ? ["loss", "100%"] : shape.netem;
  // Band 1:1 for the browser server's replies, band 1:2 (netem) for everything else
  tc("qdisc", "add", "dev", "eth0", "root", "handle", "1:", "prio", "bands", "3", "priomap", ...Array(16).fill("1"));
  tc("qdisc", "add", "dev", "eth0", "parent", "1:2", "handle", "20:", "netem", ...netem);
  tc("filter", "add", "dev", "eth0", "parent", "1:0", "protocol", "ip", "prio", "1", "u32", "match", "ip", "sport", "3100", "0xffff", "flowid", "1:1");
  return netem.join(" ");
}

/** tc's own statistics of the link, for the evidence */
export function linkStatistics(): string {
  return composeE2e(["exec", "-T", "netclient", "tc", "-s", "qdisc", "show", "dev", "eth0"]).trim();
}
