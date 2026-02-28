#!/usr/bin/env bash
#
# deploy-neuron.sh — Automated deployment of CareAgent Neuron to VPS-NEURON via SSH.
#
# Required environment variables:
#   VPS_NEURON_IP      Public IP address of VPS-NEURON
#   VPS_SSH_KEY_PATH   Path to SSH private key
#   NEURON_DOMAIN      Domain name for the neuron service
#   AXON_DOMAIN        Domain name of the live Axon registry
#
# Optional:
#   SSH_USER           SSH user (default: root)
#   NEURON_PORT        Port for the neuron server (default: 3000)
#   ORG_NPI            Organization NPI (default: 1234567893)
#   ORG_NAME           Organization name (default: "CareAgent Practice")
#   ORG_TYPE           Organization type (default: practice)
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SSH_USER="${SSH_USER:-root}"
NEURON_PORT="${NEURON_PORT:-3000}"
ORG_NPI="${ORG_NPI:-1234567893}"
ORG_NAME="${ORG_NAME:-CareAgent Practice}"
ORG_TYPE="${ORG_TYPE:-practice}"

REMOTE_DIR="/opt/neuron"

# Validate required env vars
for var in VPS_NEURON_IP VPS_SSH_KEY_PATH NEURON_DOMAIN AXON_DOMAIN; do
  if [ -z "${!var:-}" ]; then
    echo "Error: ${var} is not set" >&2
    exit 1
  fi
done

if [ ! -f "${VPS_SSH_KEY_PATH}" ]; then
  echo "Error: SSH key not found: ${VPS_SSH_KEY_PATH}" >&2
  exit 1
fi

SSH_OPTS="-i ${VPS_SSH_KEY_PATH} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"

ssh_cmd() {
  ssh ${SSH_OPTS} "${SSH_USER}@${VPS_NEURON_IP}" "$@"
}

scp_cmd() {
  scp ${SSH_OPTS} "$@"
}

echo "=== CareAgent Neuron Deployment ==="
echo "Target: ${SSH_USER}@${VPS_NEURON_IP}"
echo "Domain: ${NEURON_DOMAIN}"
echo "Axon:   https://${AXON_DOMAIN}"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Build locally
# ---------------------------------------------------------------------------
echo "[1/7] Building neuron locally..."
cd "${REPO_DIR}"
pnpm install --frozen-lockfile
pnpm build
echo "  Build complete."

# ---------------------------------------------------------------------------
# Step 2: Set up remote environment
# ---------------------------------------------------------------------------
echo "[2/7] Setting up remote environment..."
ssh_cmd bash -s <<'SETUP_EOF'
set -euo pipefail

# Install Node.js 20.x if not present
if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  echo "  Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "  Node.js version: $(node -v)"

# Create neuron user if not exists
if ! id neuron &>/dev/null; then
  useradd --system --home /opt/neuron --shell /usr/sbin/nologin neuron
fi

# Create directories
mkdir -p /opt/neuron/data /opt/neuron/dist
chown -R neuron:neuron /opt/neuron
SETUP_EOF
echo "  Remote environment ready."

# ---------------------------------------------------------------------------
# Step 3: Transfer build artifacts
# ---------------------------------------------------------------------------
echo "[3/7] Transferring build artifacts..."

# Create a temporary tarball of required files
TARBALL=$(mktemp /tmp/neuron-deploy-XXXXXX.tar.gz)
tar czf "${TARBALL}" \
  -C "${REPO_DIR}" \
  dist/ \
  package.json \
  node_modules/ \
  deploy/neuron.service

scp_cmd "${TARBALL}" "${SSH_USER}@${VPS_NEURON_IP}:/tmp/neuron-deploy.tar.gz"
rm -f "${TARBALL}"

ssh_cmd bash -s <<'TRANSFER_EOF'
set -euo pipefail
cd /opt/neuron
tar xzf /tmp/neuron-deploy.tar.gz
rm -f /tmp/neuron-deploy.tar.gz
chown -R neuron:neuron /opt/neuron
TRANSFER_EOF
echo "  Artifacts transferred."

# ---------------------------------------------------------------------------
# Step 4: Generate configuration
# ---------------------------------------------------------------------------
echo "[4/7] Generating configuration..."

# shellcheck disable=SC2087
ssh_cmd bash -s <<CONF_EOF
set -euo pipefail
cat > /opt/neuron/neuron.config.json <<'JSON_EOF'
{
  "organization": {
    "npi": "${ORG_NPI}",
    "name": "${ORG_NAME}",
    "type": "${ORG_TYPE}"
  },
  "server": {
    "port": ${NEURON_PORT},
    "host": "0.0.0.0"
  },
  "storage": {
    "path": "/opt/neuron/data/neuron.db"
  },
  "audit": {
    "path": "/opt/neuron/data/audit.jsonl",
    "enabled": true
  },
  "localNetwork": {
    "enabled": false,
    "serviceType": "careagent-neuron",
    "protocolVersion": "v1.0"
  },
  "heartbeat": {
    "intervalMs": 60000
  },
  "axon": {
    "registryUrl": "https://${AXON_DOMAIN}",
    "endpointUrl": "https://${NEURON_DOMAIN}",
    "backoffCeilingMs": 300000
  },
  "api": {
    "rateLimit": {
      "maxRequests": 100,
      "windowMs": 60000
    },
    "cors": {
      "allowedOrigins": []
    }
  }
}
JSON_EOF
chown neuron:neuron /opt/neuron/neuron.config.json
chmod 600 /opt/neuron/neuron.config.json
CONF_EOF
echo "  Configuration written."

# ---------------------------------------------------------------------------
# Step 5: Install systemd service
# ---------------------------------------------------------------------------
echo "[5/7] Installing systemd service..."
ssh_cmd bash -s <<'SERVICE_EOF'
set -euo pipefail
cp /opt/neuron/deploy/neuron.service /etc/systemd/system/neuron.service
systemctl daemon-reload
systemctl enable neuron
SERVICE_EOF
echo "  Systemd service installed."

# ---------------------------------------------------------------------------
# Step 6: Start/restart the service
# ---------------------------------------------------------------------------
echo "[6/7] Starting neuron service..."
ssh_cmd bash -s <<'START_EOF'
set -euo pipefail
systemctl restart neuron
sleep 3

if systemctl is-active --quiet neuron; then
  echo "  Neuron service is running."
else
  echo "  Error: Neuron service failed to start." >&2
  journalctl -u neuron --no-pager -n 20 >&2
  exit 1
fi
START_EOF

# ---------------------------------------------------------------------------
# Step 7: Run verification
# ---------------------------------------------------------------------------
echo "[7/7] Running deployment verification..."
"${SCRIPT_DIR}/verify-deployment.sh"

echo ""
echo "=== Deployment Complete ==="
echo "Neuron is running at https://${NEURON_DOMAIN}"
echo "Registered with Axon at https://${AXON_DOMAIN}"
