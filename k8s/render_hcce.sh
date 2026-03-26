#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

ENV=${1:-local}

if [ "$ENV" != "local" ] && [ "$ENV" != "production" ]; then
    echo "Usage: $0 [local|production]"
    exit 1
fi

# Check prerequisites
bins=("bash" "openssl" "npm")
for cmd in "${bins[@]}"; do
    if ! command -v $cmd &> /dev/null; then
        echo "missing required binary: $cmd"
        exit 1
    fi
done

if ! npm list -g pem-jwk | grep -q pem-jwk; then
    echo "missing required npm pkg: pem-jwk, try (sudo) npm install pem-jwk -g to install it"
    exit 1
fi

# Source environment values
if [ ! -f "overlays/${ENV}.env" ]; then
    echo "Error: overlays/${ENV}.env not found"
    exit 1
fi
source "overlays/${ENV}.env"

# Source secrets (not committed to git)
if [ ! -f "overlays/secrets.env" ]; then
    echo "Error: overlays/secrets.env not found. Copy overlays/secrets.env.example and fill in values."
    exit 1
fi
source "overlays/secrets.env"

# Derived values
export PGRST_DB_URI="postgres://$DB_USER:$DB_PASS@$DB_HOST/$DB_NAME"
export PSQL="postgres://$DB_USER:$DB_PASS@$DB_HOST/$DB_NAME"

# Generate keys
openssl genpkey -algorithm RSA -out private_key.pem -pkeyopt rsa_keygen_bits:2048
export PERMS_KEY="$(echo -n "$(awk '{printf "%s\\\\n", $0}' private_key.pem)")"
openssl rsa -pubout -in private_key.pem -out public_key.pem
export PGRST_JWT_SECRET=$(pem-jwk public_key.pem)

# Generate initial certificate
openssl req -x509 -newkey rsa:2048 -sha256 -days 36500 -nodes -keyout key.pem -out cert.pem -subj "/CN=$HUB_DOMAIN"
export initCert=$(base64 -i cert.pem | tr -d '\n')
export initKey=$(base64 -i key.pem | tr -d '\n')

# Select template based on environment
if [ "$ENV" = "production" ]; then
    TEMPLATE="templates/hcce-chutvrc.yam"
else
    TEMPLATE="templates/hcce-chutvrc-local.yam"
fi

echo "Rendering $TEMPLATE with $ENV environment..."
envsubst < "$TEMPLATE" > "hcce.yaml"

# Cleanup generated key files
rm -f private_key.pem public_key.pem key.pem cert.pem

echo "Generated hcce.yaml for $ENV environment"
echo "Deploy with: kubectl apply -f k8s/hcce.yaml"
