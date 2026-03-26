#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REGISTRY=${1:-chutvrc.azurecr.io}
TAG=${2:-latest}

echo "Building production images..."
echo "Registry: $REGISTRY"
echo "Tag: $TAG"

# Dialog: uses k8s-specific Dockerfile with fixed run.sh
# Copy the fixed run.sh into the service source before building
# (the Dockerfile copies scripts/docker/run.sh from the build context)
echo "==> Building dialog..."
cp "$SCRIPT_DIR/dockerfiles/dialog/run.sh" "$REPO_ROOT/services/dialog/scripts/docker/run.sh"
docker build -t "$REGISTRY/dialog:$TAG" \
    -f "$SCRIPT_DIR/dockerfiles/dialog/Dockerfile" \
    "$REPO_ROOT/services/dialog/"

# Coturn: uses k8s-specific Dockerfile with fixed entrypoint.sh
echo "==> Building coturn..."
docker build -t "$REGISTRY/coturn:$TAG" \
    -f "$SCRIPT_DIR/dockerfiles/coturn/Dockerfile" \
    "$SCRIPT_DIR/dockerfiles/coturn/"

# Reticulum: uses TurkeyDockerfile from service source
echo "==> Building reticulum..."
docker build -t "$REGISTRY/reticulum:$TAG" \
    -f "$REPO_ROOT/services/reticulum/TurkeyDockerfile" \
    "$REPO_ROOT/services/reticulum/"

# Hubs: uses Dockerfile from service source
echo "==> Building hubs..."
docker build -t "$REGISTRY/hubs:$TAG" \
    -f "$REPO_ROOT/services/hubs/Dockerfile" \
    "$REPO_ROOT/services/hubs/"

# Spoke: uses Dockerfile from service source
echo "==> Building spoke..."
docker build -t "$REGISTRY/spoke:$TAG" \
    -f "$REPO_ROOT/services/spoke/Dockerfile" \
    "$REPO_ROOT/services/spoke/"

echo ""
echo "All images built. To push:"
echo "  az acr login --name chutvrc"
echo "  docker push $REGISTRY/dialog:$TAG"
echo "  docker push $REGISTRY/coturn:$TAG"
echo "  docker push $REGISTRY/reticulum:$TAG"
echo "  docker push $REGISTRY/hubs:$TAG"
echo "  docker push $REGISTRY/spoke:$TAG"
