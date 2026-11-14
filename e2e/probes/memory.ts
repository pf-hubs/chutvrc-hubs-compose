// Memory probe (plan 3.2): the page's JavaScript heap through the DevTools protocol, what the renderer
// holds (renderer.info.memory: geometries and textures; shader programs), DOM nodes and live connections.
// A series of samples gives a trend (T2.15: flat after warm-up).
import type { CDPSession } from "@playwright/test";
import type { Client } from "../clients/launch";
import { liveConnections } from "./connections";

export type MemorySample = {
  /** Seconds since the first sample of the series (set by the caller) or since the page loaded */
  t: number;
  heapUsedMb: number;
  heapTotalMb: number;
  domNodes: number;
  listeners: number;
  geometries: number;
  textures: number;
  programs: number;
  liveConnections: number;
};

const sessions = new WeakMap<object, Promise<CDPSession>>();

function cdpOf(client: Client): Promise<CDPSession> {
  let session = sessions.get(client.page);
  if (!session) {
    session = client.context.newCDPSession(client.page).then(async s => {
      await s.send("Performance.enable");
      return s;
    });
    sessions.set(client.page, session);
  }
  return session;
}

/**
 * One sample. With `collectGarbage` the heap is collected first, so the reading shows what is still
 * held rather than what the collector has not reached yet.
 */
export async function readMemory(client: Client, collectGarbage = true): Promise<MemorySample> {
  const cdp = await cdpOf(client);
  if (collectGarbage) await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
  const { metrics } = await cdp.send("Performance.getMetrics");
  const metric = (name: string) => metrics.find(m => m.name === name)?.value ?? 0;
  const renderer = await client.page.evaluate(() => {
    const info = (window as any).AFRAME?.scenes?.[0]?.renderer?.info;
    return {
      geometries: info?.memory?.geometries ?? -1,
      textures: info?.memory?.textures ?? -1,
      programs: info?.programs?.length ?? -1,
      t: performance.now() / 1000
    };
  });
  return {
    t: +renderer.t.toFixed(1),
    heapUsedMb: +(metric("JSHeapUsedSize") / 2 ** 20).toFixed(1),
    heapTotalMb: +(metric("JSHeapTotalSize") / 2 ** 20).toFixed(1),
    domNodes: metric("Nodes"),
    listeners: metric("JSEventListeners"),
    geometries: renderer.geometries,
    textures: renderer.textures,
    programs: renderer.programs,
    liveConnections: await liveConnections(client.page)
  };
}

export type Trend = {
  samples: number;
  /** Least-squares slope over the samples, per minute */
  heapMbPerMinute: number;
  first: MemorySample;
  last: MemorySample;
  heapGrowthMb: number;
  geometriesGrowth: number;
  texturesGrowth: number;
  connectionsMin: number;
  connectionsMax: number;
};

/** The trend of a series of samples (pass the ones after warm-up) */
export function trend(samples: MemorySample[]): Trend | null {
  if (samples.length < 2) return null;
  const xs = samples.map(s => s.t / 60);
  const ys = samples.map(s => s.heapUsedMb);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const connections = samples.map(s => s.liveConnections);
  return {
    samples: samples.length,
    heapMbPerMinute: den > 0 ? +(num / den).toFixed(2) : 0,
    first,
    last,
    heapGrowthMb: +(last.heapUsedMb - first.heapUsedMb).toFixed(1),
    geometriesGrowth: last.geometries - first.geometries,
    texturesGrowth: last.textures - first.textures,
    connectionsMin: Math.min(...connections),
    connectionsMax: Math.max(...connections)
  };
}
