# SSL Certificate Setup for Local Development

This guide sets up trusted local SSL certificates using `mkcert` to resolve `ERR_CERT_AUTHORITY_INVALID` errors.

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

```bash
cd /Users/yonghao/hubs/hubs-compose

mkcert -key-file shared-key.pem -cert-file shared-cert.pem \
  localhost 127.0.0.1 ::1 \
  hubs.local hubs-proxy.local hubs-client hubs-admin spoke \
  reticulum dialog postgrest
```

## Step 3: Copy certificates to each service

```bash
cd /Users/yonghao/hubs/hubs-compose

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

| Service     | URL                      |
| ----------- | ------------------------ |
| Reticulum   | https://localhost:4000   |
| Hubs Client | https://hubs-client:8080 |
| Hubs Admin  | https://hubs-admin:8989  |
| Spoke       | https://spoke:9090       |
| Dialog      | https://localhost:4443   |

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

If you need to regenerate:

```bash
cd /Users/yonghao/hubs/hubs-compose
rm -f shared-key.pem shared-cert.pem
# Then repeat Steps 2-4
```
