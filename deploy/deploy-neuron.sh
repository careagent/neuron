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

# Determine protocol — if AXON_DOMAIN/NEURON_DOMAIN already contain a protocol,
# use it. Otherwise default to https:// for domain names, http:// for raw IPs.
detect_url() {
  local input="$1"
  if [[ "$input" == http://* ]] || [[ "$input" == https://* ]]; then
    echo "$input"
  elif [[ "$input" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    echo "http://$input"
  else
    echo "https://$input"
  fi
}

AXON_URL="$(detect_url "$AXON_DOMAIN")"
NEURON_URL="$(detect_url "$NEURON_DOMAIN")"

echo "=== CareAgent Neuron Deployment ==="
echo "Target: ${SSH_USER}@${VPS_NEURON_IP}"
echo "Neuron: ${NEURON_URL}"
echo "Axon:   ${AXON_URL}"
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

# Open firewall for neuron port (idempotent)
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 3000/tcp >/dev/null 2>&1 || true
  echo "  Firewall: port 3000 open"
fi
SETUP_EOF
echo "  Remote environment ready."

# ---------------------------------------------------------------------------
# Step 3: Transfer build artifacts
# ---------------------------------------------------------------------------
echo "[3/7] Transferring build artifacts..."

# Create a temporary tarball of required files (excluding node_modules —
# native addons like better-sqlite3 must be built on the target platform)
TARBALL=$(mktemp /tmp/neuron-deploy-XXXXXX.tar.gz)
tar czf "${TARBALL}" \
  -C "${REPO_DIR}" \
  dist/ \
  package.json \
  pnpm-lock.yaml \
  deploy/neuron.service

scp_cmd "${TARBALL}" "${SSH_USER}@${VPS_NEURON_IP}:/tmp/neuron-deploy.tar.gz"
rm -f "${TARBALL}"

ssh_cmd bash -s <<'TRANSFER_EOF'
set -euo pipefail
cd /opt/neuron
tar xzf /tmp/neuron-deploy.tar.gz
rm -f /tmp/neuron-deploy.tar.gz

# Install dependencies on the target (rebuilds native addons for this platform)
export CI=true
if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm
fi
pnpm install --frozen-lockfile --prod

chown -R neuron:neuron /opt/neuron
TRANSFER_EOF
echo "  Artifacts transferred and dependencies installed."

# ---------------------------------------------------------------------------
# Step 4: Generate configuration
# ---------------------------------------------------------------------------
echo "[4/7] Generating configuration..."

# Generate the config JSON locally and upload via scp (avoids heredoc
# variable-expansion pitfalls with nested heredocs over SSH).
CONF_TMP=$(mktemp /tmp/neuron-config-XXXXXX.json)
cat > "${CONF_TMP}" <<EOF
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
    "registryUrl": "${AXON_URL}",
    "endpointUrl": "${NEURON_URL}",
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
EOF
scp_cmd "${CONF_TMP}" "${SSH_USER}@${VPS_NEURON_IP}:/opt/neuron/neuron.config.json"
rm -f "${CONF_TMP}"
ssh_cmd "chown neuron:neuron /opt/neuron/neuron.config.json && chmod 600 /opt/neuron/neuron.config.json"
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
echo "Neuron is running at ${NEURON_URL}"
echo "Registered with Axon at ${AXON_URL}"
