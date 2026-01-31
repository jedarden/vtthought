# VTThought Kubernetes Deployment

Deploy VTThought backend to your k3s cluster.

## Prerequisites

- k3s cluster running
- `kubectl` configured
- Container registry access (ghcr.io)

## Quick Deploy (Single-User Mode)

For testing without authentication:

```bash
# 1. Create namespace and deploy
kubectl apply -k k8s/

# 2. Enable single-user mode
kubectl set env deployment/vtthought-backend SINGLE_USER_MODE=true -n vtthought

# 3. Wait for pods to be ready
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=vtthought -n vtthought --timeout=300s

# 4. Port-forward to access locally
kubectl port-forward svc/vtthought-backend 8000:8000 -n vtthought

# 5. Test health endpoint
curl http://localhost:8000/api/health
```

## Full Deployment

### Step 1: Configure Secrets

```bash
# Generate JWT secret
JWT_SECRET=$(openssl rand -hex 32)

# Edit secret.yaml with your values
kubectl create secret generic vtthought-secrets \
  --from-literal=JWT_SECRET=$JWT_SECRET \
  --from-literal=GOOGLE_CLIENT_ID=your-client-id \
  --from-literal=GOOGLE_CLIENT_SECRET=your-client-secret \
  -n vtthought \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Step 2: Deploy

```bash
# Apply all manifests
kubectl apply -k k8s/

# Watch deployment
kubectl rollout status deployment/vtthought-backend -n vtthought
kubectl rollout status deployment/ollama -n vtthought
```

### Step 3: Verify

```bash
# Check pods
kubectl get pods -n vtthought

# Check logs
kubectl logs -f deployment/vtthought-backend -n vtthought

# Check Ollama is pulling model
kubectl logs -f deployment/ollama -n vtthought
```

## Access Methods

### Option 1: Port Forward (Development)

```bash
kubectl port-forward svc/vtthought-backend 8000:8000 -n vtthought
# Access at http://localhost:8000
```

### Option 2: NodePort

```bash
kubectl patch svc vtthought-backend -n vtthought -p '{"spec": {"type": "NodePort"}}'
kubectl get svc vtthought-backend -n vtthought
# Access at http://<node-ip>:<node-port>
```

### Option 3: Ingress

```bash
# Edit ingress.yaml with your domain
kubectl apply -f k8s/ingress.yaml

# Add to /etc/hosts (if using vtthought.local)
echo "$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[0].address}') vtthought.local" | sudo tee -a /etc/hosts
```

### Option 4: Tailscale (Recommended)

```bash
# Expose via Tailscale operator
kubectl apply -f - <<EOF
apiVersion: tailscale.com/v1alpha1
kind: Connector
metadata:
  name: vtthought
  namespace: vtthought
spec:
  hostname: vtthought
  subnetRouter:
    advertiseRoutes:
      - "10.43.0.0/16"  # k3s service CIDR
EOF
```

## VS Code Extension Configuration

After deploying, configure the extension:

1. Open VS Code Settings
2. Search for "vtthought"
3. Set `vtthought.backendUrl`:
   - Port-forward: `http://localhost:8000`
   - NodePort: `http://<node-ip>:<port>`
   - Ingress: `https://vtthought.example.com`
   - Tailscale: `http://vtthought:8000`

## GPU Support

For GPU-accelerated transcription:

```bash
# Use GPU image
kubectl set image deployment/vtthought-backend \
  backend=ghcr.io/jedarden/vtthought:latest-gpu \
  -n vtthought

# Update config for GPU
kubectl set env deployment/vtthought-backend \
  STT_DEVICE=cuda \
  STT_COMPUTE_TYPE=float16 \
  -n vtthought
```

Ensure your cluster has NVIDIA GPU operator installed.

## Resource Tuning

### Minimal (Testing)

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "512Mi"
  limits:
    cpu: "1000m"
    memory: "2Gi"
```

### Production (CPU)

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "2000m"
    memory: "4Gi"
```

### Production (GPU)

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "2Gi"
    nvidia.com/gpu: "1"
  limits:
    cpu: "2000m"
    memory: "8Gi"
    nvidia.com/gpu: "1"
```

## Troubleshooting

### Pod not starting

```bash
kubectl describe pod -l app.kubernetes.io/name=vtthought -n vtthought
kubectl logs -l app.kubernetes.io/name=vtthought -n vtthought --previous
```

### Database issues

```bash
# Check PVC is bound
kubectl get pvc -n vtthought

# Check data directory
kubectl exec -it deployment/vtthought-backend -n vtthought -- ls -la /data
```

### Ollama not responding

```bash
# Check Ollama logs
kubectl logs deployment/ollama -n vtthought

# Test Ollama directly
kubectl exec -it deployment/vtthought-backend -n vtthought -- \
  curl http://ollama:11434/api/tags
```

### WebSocket connection fails

Check if your ingress/load balancer supports WebSockets:

```bash
# Test WebSocket with wscat
kubectl port-forward svc/vtthought-backend 8000:8000 -n vtthought &
npx wscat -c ws://localhost:8000/api/ws/audio
```

## Cleanup

```bash
kubectl delete -k k8s/
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     vtthought namespace                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────┐     ┌──────────────────────┐     │
│  │  vtthought-backend   │────▶│       ollama         │     │
│  │  (FastAPI + Whisper) │     │   (LLM: llama3.1)    │     │
│  └──────────┬───────────┘     └──────────────────────┘     │
│             │                                                │
│             ▼                                                │
│  ┌──────────────────────┐     ┌──────────────────────┐     │
│  │   vtthought-data     │     │   ollama-data        │     │
│  │   (SQLite PVC)       │     │   (Models PVC)       │     │
│  └──────────────────────┘     └──────────────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │   Ingress / NodePort    │
              │   or Port Forward       │
              └─────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │   VS Code Extension     │
              │   (WebSocket client)    │
              └─────────────────────────┘
```
