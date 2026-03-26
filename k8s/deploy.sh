#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

ENV=${1:-local}

if [ "$ENV" != "local" ] && [ "$ENV" != "production" ]; then
    echo "Usage: $0 [local|production]"
    exit 1
fi

# Render the template
bash render_hcce.sh "$ENV"

# Source env to get namespace
source "overlays/${ENV}.env"

echo "Deploying to k8s ($ENV environment, namespace: $Namespace)..."

# Apply certbot RBAC if it exists
if [ -f "cbb.yaml" ]; then
    kubectl apply -f cbb.yaml
fi

# Apply the main manifest
kubectl apply -f hcce.yaml

echo ""
echo "Deployment applied. Monitor with:"
echo "  kubectl get pods -n $Namespace -w"
