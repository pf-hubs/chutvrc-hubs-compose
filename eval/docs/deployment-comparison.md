# Deployment comparison: docker-compose vs. Kubernetes

Reference document comparing the two deployment paths shipped by this repo
(`docker-compose.yml` vs. `k8s/templates/hcce-chutvrc.yam`), and the
implications for the cross-configuration performance evaluation
(see `eval/docs/evaluation-manual.html`).

## Side-by-side

| Dimension | `docker-compose` path | Kubernetes path |
|---|---|---|
| **Files involved** | `docker-compose.yml` (169 lines), `docker-compose.eval.yml` for the harness | `k8s/templates/hcce-chutvrc.yam` (1392 lines), `hcce-chutvrc-local.yam`, `k8s/overlays/*.env`, render scripts |
| **Bring-up command** | `docker compose up` (one host) | Helm / kubectl against an existing cluster + cluster-side prerequisites (ingress, LB, kubeconfig) |
| **Intended scenario** (per paper §4.4) | Minimal on-prem (laptop / single workstation), on-prem server | Institutional cloud, general-purpose public cloud |
| **Network plane** | Single host bridge network (`mozilla-hubs`); intra-service hops are localhost-equivalent | CNI overlay between pods; kube-proxy / iptables / IPVS for Service routing; potential cross-node hops |
| **Ingress / TLS** | Direct host ports; TLS terminated by an external reverse proxy (or none on LAN) | HAProxy Ingress controller terminates TLS at the edge; four Ingress resources route by host/path; L7 rules (e.g. `load-balance: url_param roomId` on dialog) |
| **Signaling path (reticulum/dialog)** | Client → host port → service container (1 hop) | Client → cloud LB → ingress (TLS termination, L7 routing) → service pod (+1 L7 hop) |
| **WebRTC media** | Dialog binds `MEDIASOUP_ANNOUNCED_IP=$PRIVATE_NETWORK_IP`; UDP `40000–40050` forwarded on the host. Direct UDP path. | Dialog pod runs with `hostNetwork: true`, binds to node NIC; `MEDIASOUP_ANNOUNCED_IP=$ANNOUNCED_IP` (static public IP), UDP `40000–49999`. **No Service / LoadBalancer exposes the media UDP range** — clients only reach it if the node's public IP matches `ANNOUNCED_IP`. See `k8s/docs/COTURN_WEBRTC_FIX_PLAN.md`. |
| **Database access** | reticulum → `db` (Postgres) directly | reticulum → `pgbouncer-t` (transaction mode, for locks) and `pgbouncer` (session mode, for pooling) → Postgres; +1 hop per query, pooling on |
| **Resource limits** | None (containers compete freely on host) | None defined in templates; `safe-to-evict: true` on most pods means kubelet may evict under node pressure |
| **Replication** | 1 instance per service | `replicas: 1` everywhere; no HPA; functionally single-instance, but rolling-update strategy defined |
| **Persistent storage** | Named Docker volumes (`pgdata`, `reticulum`, `retstorage` …) under `/var/lib/docker/volumes/` | `hostPath: /tmp/pgsql_data`, `/tmp/ret_storage_data`. **No PVCs.** `/tmp` is often wiped on node reboot — data-loss risk for accounts and room state. |
| **Health probes** | Uniform 30 s healthchecks on reticulum (`/health`), dialog (`/meta`), Postgres (`pg_isready`), hubs/spoke/storybook | Reticulum has lenient probes (`failureThreshold: 100` × 5 s = 500 s before restart); **dialog has no probes at all** — a wedged dialog isn't auto-restarted |
| **Pod placement** | N/A (one host) | No anti-affinity, no topology spread — dialog and reticulum may land on different nodes, adding cross-node latency on multi-node pools |
| **Observability hooks** | None beyond Docker's JSON log driver | HAProxy logs to stdout (kubelet captures); no extra sidecars / scrapers |
| **Operational expertise needed** | Compose familiarity + a Linux host | Cluster admin: ingress, RBAC, kubeconfig, networking, hostPath caveats, ICE/UDP exposure for the SFU |
| **Failure mode if misconfigured** | Usually obvious (container exits, healthcheck fails) | Often silent: media path fails because `ANNOUNCED_IP` doesn't match node IP → empty `chirp-pairs.csv`, looks like an SFU problem |

## Headline performance differences

1. **Signaling adds one L7 hop in k8s** (HAProxy Ingress). A few ms of added RTT on every reticulum/dialog WebSocket message, directly visible in pose latency.
2. **Media path bypasses the CNI in k8s** (`hostNetwork: true` on dialog). Once it works, audio latency is comparable to compose. The risk is "works at all," not "works slower."
3. **Database adds a PgBouncer hop in k8s** — small per-query overhead, only matters under load (presence updates, room joins).
4. **Cross-node placement** — on a single-node cluster, no difference; on multi-node, dialog and reticulum may sit across the node boundary, adding tens of µs to a couple of ms depending on the cloud network.

## Where each path fits (paper §4.4 / Table 2)

- **docker-compose**: when a single host has enough CPU / memory for the expected N, and operational simplicity matters more than scaling or observability. Covers the laptop and on-prem-server tiers cleanly. Also the right choice for any cell that needs to attribute results to hardware / network rather than orchestration.
- **k8s**: when the institution already standardizes on a cluster (tenancy, RBAC, monitoring, secrets, ingress all provided) and the cost of running that cluster has been paid by something else. Not a good starting point for a fresh "we should put chutvrc somewhere" decision — the WebRTC media plumbing and `/tmp` storage caveats are real and undocumented for new operators.

## Recommended evaluation design

Two-part evaluation, reported as one main matrix plus a supplementary deployment-realism block:

**Main matrix — docker-compose throughout** (anchors §7.3 / §7.4(a) of the paper):

```
{laptop, server, cloud-VM(compose)} × {dialog, livekit, sora, cloudflare} × {5, 10, 20, 40, 80}
```

Same compose deployment on every host. Cleanest within-cell measurements and cleanest cross-cell inference for the hosting axis.

**Supplementary cells — Kubernetes on the cloud VM** (reported as a sub-table / sidebar, not in the main matrix):

```
cloud-VM(k8s) × {dialog, livekit, sora, cloudflare} × {10, 20, 40}
```

Drop N=5 (too small to be interesting for the realism point) and N=80 (cluster + SFU networking gets gnarly; pick it up only if the smaller cells indicate the cluster handles it). 12 supplementary cells vs. ~60 in the main matrix.

Pair each k8s cell with a compose counterpart on the same cloud VM so the "k8s delta" is interpretable per (SFU, N).

### What this design lets you claim

| Cell set | Claim |
|---|---|
| Compose × {laptop, server, cloud VM} | Controlled cross-hosting comparison. Differences are attributable to hardware + location only, because the orchestration stack is constant. Maps to RQ1 cleanly. |
| K8s × cloud VM | Deployment-realism measurement. What an institution adopting the architecture for the institutional-cloud tier will actually see. Maps to §4.4's decision framework and §7.4(a)'s configuration-to-scenario mapping. |
| Both together | Decomposition. `cloud-compose – laptop-compose` = hardware / location delta; `cloud-k8s – cloud-compose` = orchestrator delta. |

### Cost and fallback

The supplementary k8s set costs roughly **+15–25 %** on top of the all-compose plan, mostly one-time cluster setup. If time is tight, fall back to **2 k8s cells only** — one mid-range (e.g. `cloud+sora+N20+k8s`) and one stress (e.g. `cloud+sora+N40+k8s`) — reported as a sidebar showing the magnitude of the k8s overhead. Enough to defend against the "what about k8s?" reviewer question without committing to a full supplementary subtable.

### Set up the k8s media path first

A misconfigured k8s media path produces empty `chirp-pairs.csv` cells that look indistinguishable from "SFU is broken" rather than "k8s is misconfigured." Before any measured k8s cell, verify with two ordinary browsers connecting through the k8s deployment (the same sanity test §2.3 of the eval manual requires for non-Dialog SFUs). If `ANNOUNCED_IP` / `hostNetwork` need tuning, discover that on day one.

## How to write it up in the paper

- **§7.2 Methodology**: name two protocols. *"Main matrix uses docker-compose on every host. Supplementary cells additionally measure the institutional-cloud tier under Kubernetes, matching the deployment configuration §5.4 ships for that tier."*
- **§7.3 Results**: main matrix as the central table; k8s-vs-compose decomposition as a small follow-up table or paired-bar chart.
- **§7.4 Discussion**:
  - *(a)* configuration-to-scenario mapping — cite the k8s row for the institutional-cloud scenario, cite the compose rows for the smaller-tier scenarios.
  - *(d)* decision framework — empirically grounded by the cells that match each tier's actual deployment.
- **§10 Limitations**: one sentence noting the bundling — *"the cloud-VM hosting cell is reported under both deployment paths; the k8s cells reflect the deployment shape institutions would adopt for that tier, while the compose cells provide a controlled comparison against the smaller-tier hosts."*
