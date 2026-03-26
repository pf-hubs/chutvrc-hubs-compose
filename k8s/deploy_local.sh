# This script redeploys the local HCCE instance with SSL certificates.

# --- Step 1: Generate SSL certificates if they don't exist ---
if [ ! -f "hubs.local+3.pem" ] || [ ! -f "hubs.local+3-key.pem" ]; then
    echo ">>> Generating local SSL certificates with mkcert..."
    mkcert hubs.local assets.hubs.local cors.hubs.local stream.hubs.local
    echo ">>> Certificates generated: hubs.local+3.pem, hubs.local+3-key.pem"
else
    echo ">>> SSL certificates already exist, skipping generation."
fi

# --- Step 2: Render the hcce.yaml template ---
echo ">>> Rendering hcce.yaml..."
bash render_hcce.sh local

# --- Step 3: Apply the configuration to Kubernetes ---
echo ">>> Applying hcce.yaml to cluster..."
kubectl apply -f hcce.yaml -n hcce

# --- Wait for all deployments to be ready ---
echo ">>> Waiting for all deployments to become available (max 5 minutes)..."
if ! kubectl wait --for=condition=Available deployment --all -n hcce --timeout=300s; then
    echo "!!! ERROR: Deployments did not become ready in time."
    echo "!!! Please check pod status with: kubectl get pods -n hcce"
    exit 1
fi
echo ">>> All deployments are ready!"

# --- Step 4: Delete the old certificate secret ---
echo ">>> Deleting old cert-hubs.local secret (if it exists)..."
kubectl delete secret tls cert-hubs.local -n hcce --ignore-not-found=true

# --- Step 5: Create the new secret from your .pem files ---
echo ">>> Creating new cert-hubs.local secret..."
kubectl create secret tls cert-hubs.local \
  --key="hubs.local+3-key.pem" \
  --cert="hubs.local+3.pem" \
  -n hcce

echo ">>> Local deployment complete!"