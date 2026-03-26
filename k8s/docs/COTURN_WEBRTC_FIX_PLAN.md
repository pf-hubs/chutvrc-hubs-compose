# Fix Coturn and WebRTC Configuration for Corporate WiFi Networks

## Problem Summary

WebRTC connections fail on corporate/enterprise WiFi networks with the following symptoms:

- Users can join rooms (signaling works)
- No audio/video (media streams fail)
- DataChannel doesn't connect

**Root Cause:** The `hcce-chutvrc-local.yam` configuration has critical IP announcement issues that prevent WebRTC media connections from establishing.

## Key Understanding: Local vs Production Deployment

**Your Deployment Context:**

- **Environment:** Local development using docker-desktop on Mac
- **Testing from:** Same Mac (browser on localhost)
- **Current Issue:** `MEDIASOUP_ANNOUNCED_IP` set to `127.0.0.1`

**Why 127.0.0.1 Doesn't Work:**
When `hostNetwork: false` (current local config):

1. The dialog pod runs in isolated Kubernetes networking
2. `127.0.0.1` inside the pod refers to the pod's localhost, not your Mac's
3. MediaSoup announces `127.0.0.1` in ICE candidates
4. Clients receive these candidates and try to connect to their own `127.0.0.1`
5. Result: Connection attempts never reach the MediaSoup server

**The Solution for Local Development:**

- Enable `hostNetwork: true` (like production does)
- Use your Mac's LAN IP (e.g., `192.168.1.x`) as `MEDIASOUP_ANNOUNCED_IP`
- This IP is reachable from browsers on your Mac and other devices on your network
- Even when accessing via localhost, the browser can connect to the LAN IP for media streams

## Quick Reference: What to Change

**Step 1:** Find your Mac's IP address:

```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
# Example output: inet 192.168.11.2 netmask...
# Use 192.168.11.2 in the steps below
```

**Step 2:** Edit `hcce-chutvrc-local.yam` with these changes:

| Line(s)    | Current Value                     | Change To                                                        | Why                             |
| ---------- | --------------------------------- | ---------------------------------------------------------------- | ------------------------------- |
| 1093       | `spec:` followed by `containers:` | Add `hostNetwork: true` and `dnsPolicy: ClusterFirstWithHostNet` | Makes pod use host network      |
| 1104       | `value: "127.0.0.1"`              | `value: "192.168.11.2"` (your IP)                                | Announces correct IP to clients |
| After 1104 | (missing)                         | Add `MEDIASOUP_MIN_PORT: "40000"`                                | Defines media port range        |
| After 1104 | (missing)                         | Add `MEDIASOUP_MAX_PORT: "49999"`                                | Defines media port range        |
| After 1157 | (missing)                         | Add `EXTERNAL_IP: "192.168.11.2"`                                | Coturn announces correct IP     |

## Critical Issues Identified

### 1. **FATAL: Mediasoup Announcing Localhost IP**

**Location:** `hcce-chutvrc-local.yam:1103-1104`

Current configuration:

```yaml
- name: MEDIASOUP_ANNOUNCED_IP
  value: "127.0.0.1"
```

**Impact:** Clients receive ICE candidates pointing to `127.0.0.1`, which resolves to their own machine instead of your server. This completely breaks WebRTC media connections.

### 2. **Missing Mediasoup Port Range Configuration**

**Location:** `hcce-chutvrc-local.yam` dialog deployment (lines 1071-1126)

The local config is missing:

- `MEDIASOUP_MIN_PORT` environment variable
- `MEDIASOUP_MAX_PORT` environment variable

These are present in production config (`hcce-chutvrc.yam:1105-1108`) but missing in local.

### 3. **Missing Coturn External IP Configuration**

**Location:** `hcce-chutvrc-local.yam` coturn deployment (lines 1131-1177)

The local config doesn't set `EXTERNAL_IP` environment variable, relying on dynamic detection via ipinfo.io (from `entrypoint.sh:12`). This can be unreliable and slow.

### 4. **Network Architecture Differences**

- Production uses `hostNetwork: true` for dialog pod (allows direct host networking)
- Local doesn't use `hostNetwork: true`, relying on Kubernetes networking
- This affects how mediasoup binds and announces addresses

## Comparison: Production vs Local Config

| Configuration          | Production (hcce-chutvrc.yam) | Local (hcce-chutvrc-local.yam) | Issue         |
| ---------------------- | ----------------------------- | ------------------------------ | ------------- |
| MEDIASOUP_ANNOUNCED_IP | 20.18.158.128 (static)        | **127.0.0.1**                  | ❌ FATAL      |
| MEDIASOUP_MIN_PORT     | 40000                         | **Not set**                    | ❌ Missing    |
| MEDIASOUP_MAX_PORT     | 49999                         | **Not set**                    | ❌ Missing    |
| MEDIASOUP_LISTEN_IP    | Not set                       | 0.0.0.0                        | ✅ OK         |
| COTURN EXTERNAL_IP     | 20.18.158.128 (static)        | **Not set**                    | ⚠️ Unreliable |
| Dialog hostNetwork     | true                          | **false**                      | ⚠️ Different  |
| Coturn Service Type    | Regular                       | LoadBalancer                   | ℹ️ Different  |

## Required Ports for Corporate WiFi

Based on the configuration, these ports must be accessible:

| Protocol | Ports       | Purpose                 | Blockage Likelihood             |
| -------- | ----------- | ----------------------- | ------------------------------- |
| TCP      | 443         | HTTPS (signaling)       | Low - Usually allowed           |
| TCP      | 4443        | Dialog/WebRTC signaling | Medium - Non-standard port      |
| TCP      | 5349        | TURN over TLS           | High - Often blocked/throttled  |
| UDP      | 40000-49999 | Mediasoup media         | **Very High - Usually blocked** |
| UDP      | 49152-51609 | TURN relay              | **Very High - Usually blocked** |

Corporate firewalls typically block large UDP port ranges, which is why connections fail.

## Implementation Plan

### Step 1: Fix Critical IP Configuration Issues

**File:** `community-edition/hcce-chutvrc-local.yam`

#### 1.1 Fix Mediasoup Announced IP (CRITICAL)

**The Problem with 127.0.0.1:**

- Current config sets `MEDIASOUP_ANNOUNCED_IP` to `127.0.0.1`
- With `hostNetwork: false`, this is the container's localhost, not the host's
- Clients receive ICE candidates with `127.0.0.1`, which points to their own machine
- Result: WebRTC media connection fails

**For Local Testing on Same Mac:**

**Option A: Enable hostNetwork (RECOMMENDED for local dev):**

First, enable host networking for the dialog pod (lines 1093-1094):

```yaml
spec:
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet
  containers:
```

Then find your Mac's network IP by running:

```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

You'll see output like:

```
inet 192.168.11.2 netmask 0xffffff00 broadcast 192.168.1.255
```

Use that IP (e.g., `192.168.11.2`) as the MEDIASOUP_ANNOUNCED_IP:

```yaml
env:
  - name: MEDIASOUP_LISTEN_IP
    value: "0.0.0.0"
  - name: MEDIASOUP_ANNOUNCED_IP
    value: "192.168.11.2" # Your Mac's local network IP
```

**Why this works:**

- `hostNetwork: true` makes the pod use the host's network directly
- MediaSoup binds to the Mac's network interfaces
- Your Mac's LAN IP (192.168.x.x) is reachable from browsers on the same machine
- Even when accessing via `localhost`, the browser can connect to the LAN IP for media

**Option B: Keep hostNetwork: false (more complex):**

If you need to keep `hostNetwork: false`, you must:

1. Expose the media port range (40000-49999) through the LoadBalancer service
2. Use the LoadBalancer's external IP (typically `localhost` for docker-desktop)
3. This is more complex and not recommended for local development

#### 1.2 Add Missing Mediasoup Port Range Configuration

**Lines 1100-1109** - Add port range environment variables:

```yaml
env:
  - name: MEDIASOUP_LISTEN_IP
    value: "0.0.0.0"
  - name: MEDIASOUP_ANNOUNCED_IP
    value: "$YOUR_MAC_LAN_IP"
  - name: MEDIASOUP_MIN_PORT
    value: "40000"
  - name: MEDIASOUP_MAX_PORT
    value: "49999"
  - name: perms_key
    valueFrom:
      secretKeyRef:
        name: configs
        key: PERMS_KEY
```

#### 1.3 Add Coturn External IP Configuration

**Lines 1156-1162** - Add the EXTERNAL_IP environment variable:

**For local development:**

```yaml
env:
  - name: REALM
    value: turkey
  - name: EXTERNAL_IP
    value: "192.168.11.2" # Same as your Mac's LAN IP used for mediasoup
  - name: PSQL
    valueFrom:
      secretKeyRef:
        name: configs
        key: PSQL
```

**Why:** Without this, coturn's `entrypoint.sh` tries to fetch the external IP from ipinfo.io, which:

- Returns your public internet IP (not useful for local testing)
- Can be slow or fail
- Won't work for local network testing

### Step 2: Enable Host Networking (REQUIRED for local development)

As explained in Step 1.1, you must enable `hostNetwork: true` for the dialog pod.

**Lines 1093-1094** - Add after `spec:`:

```yaml
spec:
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet
  containers:
```

**Why this is necessary for local development:**

- Without `hostNetwork`, the pod is isolated in Kubernetes networking
- MediaSoup needs to bind to ports that clients can directly reach
- The media port range (40000-49999) would need complex LoadBalancer configuration
- With `hostNetwork`, the pod uses your Mac's network directly, making setup much simpler

**Note:** Production uses `hostNetwork: true` (see hcce-chutvrc.yam:1094), so this aligns local with production.

### Step 3: Verify Port Accessibility

After making configuration changes, verify that required ports are accessible from client networks:

#### Test TURN connectivity:

```bash
# From a client machine on the corporate WiFi
openssl s_client -connect your-domain.com:5349
```

#### Test UDP port accessibility:

```bash
# Install a UDP test tool
nc -u -v your-server-ip 45000
```

For corporate WiFi, UDP ports are often blocked. If UDP is completely blocked, you may need to:

- Enable TCP fallback for mediasoup (requires code changes)
- Use a TURN server that supports TCP relay
- Consider using a tunneling solution

### Step 4: Update Deployment

After editing the configuration file:

```bash
cd /Users/yonghao/hubs/hubs-cloud/community-edition
./render_hcce.sh  # If this script processes the template
kubectl apply -f hcce-chutvrc-local.yam
```

Monitor pod restarts:

```bash
kubectl get pods -n $Namespace -w
```

### Step 5: Verify Configuration

Check that the dialog pod has correct environment variables:

```bash
kubectl exec -n $Namespace -it deployment/dialog -- env | grep MEDIASOUP
```

Expected output:

```
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=<your-lan-ip>
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
```

Check coturn configuration:

```bash
kubectl exec -n $Namespace -it deployment/coturn -- cat /etc/turnserver.conf
```

Verify that `external-ip` is set to your LAN IP (not 127.0.0.1).

## Additional Recommendations for Corporate WiFi

### 1. TURN Server Configuration Review

The current coturn configuration in `entrypoint.sh` has:

- `no-udp=true` - UDP disabled
- `no-tcp=true` - Raw TCP disabled
- `no-tls=false` - TLS enabled ✅
- `no-dtls=false` - DTLS enabled ✅

This means coturn ONLY operates over TLS/DTLS on port 5349. For corporate networks that block this port:

**Option A:** Add TCP fallback by modifying `entrypoint.sh:15-16`:

```bash
echo "no-udp=false" >> /etc/turnserver.conf  # Enable UDP
echo "no-tcp=false" >> /etc/turnserver.conf  # Enable TCP
```

Then expose additional ports in the service configuration.

**Option B:** Add TURN TCP on port 443 (HTTPS port, rarely blocked):

```bash
echo "tls-listening-port=443" >> /etc/turnserver.conf
```

### 2. ICE Configuration on Client Side

Ensure Hubs client is configured to:

- Use TURN servers as fallback when direct connection fails
- Try multiple transport protocols (UDP, TCP, TLS)
- Set appropriate ICE timeouts for corporate networks

### 3. Monitoring and Debugging

Enable detailed logging:

**Coturn:**

```bash
# Add to entrypoint.sh before turnserver command
echo "verbose=true" >> /etc/turnserver.conf
```

**Mediasoup:** Check dialog pod logs:

```bash
kubectl logs -n $Namespace deployment/dialog -f
```

Look for:

- ICE candidate generation
- DTLS handshake failures
- Transport creation errors

### 4. Network Requirements Documentation

For users on corporate WiFi, document required firewall rules:

- Outbound TCP 443 (HTTPS)
- Outbound TCP 4443 (Dialog signaling)
- Outbound TCP 5349 (TURN TLS)
- Outbound UDP 40000-49999 (Mediasoup RTP - if allowed)
- Outbound UDP 49152-51609 (TURN relay - if allowed)

## Files to Modify

1. **Primary Fix (CRITICAL):**

   - `/Users/yonghao/hubs/hubs-cloud/community-edition/hcce-chutvrc-local.yam`
     - Line 1093: Add `hostNetwork: true` and `dnsPolicy`
     - Line 1104: Change `MEDIASOUP_ANNOUNCED_IP` from `127.0.0.1` to your LAN IP
     - Lines 1100-1109: Add `MEDIASOUP_MIN_PORT` and `MEDIASOUP_MAX_PORT`
     - Lines 1156-1162: Add `EXTERNAL_IP` for coturn

2. **Optional Enhancements:**
   - `/Users/yonghao/hubs/hubs-cloud/community-edition/services/coturn/entrypoint.sh`
     - Modify protocol settings if TCP fallback needed

## Expected Outcomes

After implementing these fixes:

✅ **Immediate Improvements:**

- WebRTC media connections will establish from all networks (assuming port accessibility)
- Audio/video streams will function correctly
- DataChannel connections will succeed

⚠️ **If Corporate WiFi Still Blocks UDP:**

- TURN relay will activate automatically
- Connections will work but with higher latency
- May need additional TCP fallback configuration

❌ **If Port 5349 is Blocked:**

- Need to implement TURN on port 443 (Option B above)
- Or use external TURN service that operates on standard ports

## Testing Plan

1. **Deploy changes** to local environment
2. **Test from working WiFi first** to verify no regression
3. **Test from corporate WiFi** to verify fix
4. **Check browser console** for ICE candidates - should see your LAN IP, not 127.0.0.1
5. **Monitor coturn logs** to see if TURN relay is being used

## Summary

**For Local Development (Your Current Scenario):**

The primary issue is that `hcce-chutvrc-local.yam` announces mediasoup on `127.0.0.1`, which:

1. Refers to the pod's localhost (not your Mac's) when `hostNetwork: false`
2. Gets sent to clients as an ICE candidate
3. Clients try to connect to their own localhost instead of your server

**The Fix:**

1. Enable `hostNetwork: true` for dialog pod (line 1093)
2. Find your Mac's LAN IP: `ifconfig | grep "inet " | grep -v 127.0.0.1`
3. Set `MEDIASOUP_ANNOUNCED_IP` to that IP (e.g., `192.168.11.2`)
4. Set `EXTERNAL_IP` for coturn to the same IP
5. Add missing port ranges (`MEDIASOUP_MIN_PORT`, `MEDIASOUP_MAX_PORT`)

This will fix WebRTC for local testing. For corporate WiFi access, the additional port accessibility and TURN configuration recommendations apply.
