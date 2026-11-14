// The poor-network client's link (plan 2.1 modifier): shaped with tc netem inside the netclient
// container. "offline" drops every packet both ways out of the container's interface, which is the
// one way to take a client off the network that also stops WebRTC (the browser's own offline
// emulation does not reach WebRTC).
import { composeE2e } from "../lib/stack";

export type LinkShape = "normal" | "offline" | { netem: string[] };

export function shapeLink(shape: LinkShape): string {
  if (shape === "normal") {
    try {
      composeE2e(["exec", "-T", "netclient", "tc", "qdisc", "del", "dev", "eth0", "root"]);
    } catch {
      // No qdisc set: already normal
    }
    return "normal";
  }
  const netem = shape === "offline" ? ["loss", "100%"] : shape.netem;
  composeE2e(["exec", "-T", "netclient", "tc", "qdisc", "replace", "dev", "eth0", "root", "netem", ...netem]);
  return netem.join(" ");
}

/** tc's own statistics of the link, for the evidence */
export function linkStatistics(): string {
  return composeE2e(["exec", "-T", "netclient", "tc", "-s", "qdisc", "show", "dev", "eth0"]).trim();
}
