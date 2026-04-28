# SSL Certificate Setup for Local Development

This guide sets up trusted local SSL certificates using `mkcert` to resolve `ERR_CERT_AUTHORITY_INVALID` errors.

> **Most users won't need to follow this directly.** The double-click setup
> scripts (`local-setup-mac.command` / `local-setup-windows.bat` — see
> [`README.md`](README.md)) and the manual flow in
> [`MANUAL_SETUP.md`](MANUAL_SETUP.md) already handle the steps below. This
> file is kept as a focused, standalone reference for cases where you only
> need to (re)generate the certificates.

## Prerequisites

- macOS with Homebrew installed
- hubs-compose services cloned

## Step 1: Install mkcert

```bash
brew install mkcert
mkcert -install
```

This installs mkcert and adds its root CA to your system trust store.

## Step 2: Generate certificates for all hostnames

Run from the repository root:

```bash
mkcert -key-file shared-key.pem -cert-file shared-cert.pem \
  localhost 127.0.0.1 ::1 \
  hubs.local hubs-proxy.local hubs-client hubs-admin spoke \
  reticulum dialog postgrest
```

## Step 3: Copy certificates to each service

```bash
cp shared-key.pem services/reticulum/priv/dev-ssl.key
cp shared-cert.pem services/reticulum/priv/dev-ssl.cert

mkdir -p services/hubs/certs
cp shared-key.pem services/hubs/certs/key.pem
cp shared-cert.pem services/hubs/certs/cert.pem

mkdir -p services/hubs/admin/certs
cp shared-key.pem services/hubs/admin/certs/key.pem
cp shared-cert.pem services/hubs/admin/certs/cert.pem

mkdir -p services/spoke/certs
cp shared-key.pem services/spoke/certs/key.pem
cp shared-cert.pem services/spoke/certs/cert.pem

mkdir -p services/dialog/certs
cp shared-key.pem services/dialog/certs/privkey.pem
cp shared-cert.pem services/dialog/certs/fullchain.pem
```

## Step 4: Restart the containers

```bash
# Stop all services
bin/down

# Start again
bin/up
```

## Step 5: Verify

Open these URLs - they should all load without certificate warnings:

| Service     | URL                     |
| ----------- | ----------------------- |
| Reticulum   | https://hubs.local:4000 |
| Hubs Client | https://hubs.local:8080 |
| Hubs Admin  | https://hubs.local:8989 |
| Spoke       | https://hubs.local:9090 |
| Dialog      | https://hubs.local:4443 |

## Troubleshooting

### Hostnames not resolving

If you get `ERR_NAME_NOT_RESOLVED`, add the Docker hostnames to `/etc/hosts`:

```bash
sudo sh -c 'echo "127.0.0.1 hubs-client hubs-admin spoke hubs.local dialog" >> /etc/hosts'
```

### Certificate still not trusted

1. Ensure `mkcert -install` completed successfully
2. Restart your browser completely
3. Check that the certificate files were copied correctly:
   ```bash
   ls -la services/reticulum/priv/dev-ssl.*
   ls -la services/hubs/certs/
   ls -la services/hubs/admin/certs/
   ls -la services/spoke/certs/
   ls -la services/dialog/certs/
   ```

### Regenerating certificates

If you need to regenerate, run from the repository root:

```bash
rm -f shared-key.pem shared-cert.pem
# Then repeat Steps 2-4
```
