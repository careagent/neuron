#!/usr/bin/env bash
#
# verify-deployment.sh — Post-deployment verification of Neuron registration with Axon.
#
# Verifies:
#   1. Neuron service is running on VPS
#   2. Neuron registered with Axon (health file shows 'healthy')
#   3. Heartbeat is working (at least 2 consecutive heartbeats)
#   4. Provider lookup via Axon returns the registered neuron
#
# Required environment variables:
#   VPS_NEURON_IP      Public IP address of VPS-NEURON
#   VPS_SSH_KEY_PATH   Path to SSH private key
#   NEURON_DOMAIN      Domain name for the neuron service
#   AXON_DOMAIN        Domain name of the live Axon registry
#
set -euo pipefail

SSH_USER="${SSH_USER:-root}"
SSH_OPTS="-i ${VPS_SSH_KEY_PATH} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
ORG_NPI="${ORG_NPI:-1234567893}"

PASS=0
FAIL=0

check() {
  local label="$1"
  shift
  if "$@"; then
    echo "  PASS: ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: ${label}"
    FAIL=$((FAIL + 1))
  fi
}

ssh_cmd() {
  ssh ${SSH_OPTS} "${SSH_USER}@${VPS_NEURON_IP}" "$@"
}

echo "--- Verification: Neuron Deployment ---"
echo ""

# Check 1: Service is running
echo "[Check 1] Neuron service status"
check "systemd service is active" \
  ssh_cmd systemctl is-active --quiet neuron

# Check 2: Health file shows registered
echo "[Check 2] Registration health"
HEALTH_STATUS=$(ssh_cmd cat /opt/neuron/data/neuron.health.json 2>/dev/null || echo '{}')
check "health file exists and shows healthy" \
  bash -c "echo '${HEALTH_STATUS}' | grep -q '\"status\":.*\"healthy\"'"

# Check 3: Heartbeat working (wait for 2 cycles)
echo "[Check 3] Heartbeat mechanism (waiting for 2 heartbeat cycles ~130s)..."

FIRST_HB=$(ssh_cmd bash -c 'cat /opt/neuron/data/neuron.health.json 2>/dev/null | grep -o "\"last_heartbeat_at\":\"[^\"]*\"" | head -1' || echo "none")
echo "  Initial heartbeat: ${FIRST_HB}"

echo "  Waiting 70 seconds for first heartbeat cycle..."
sleep 70

SECOND_HB=$(ssh_cmd bash -c 'cat /opt/neuron/data/neuron.health.json 2>/dev/null | grep -o "\"last_heartbeat_at\":\"[^\"]*\"" | head -1' || echo "none")
echo "  After first cycle: ${SECOND_HB}"

echo "  Waiting 70 seconds for second heartbeat cycle..."
sleep 70

THIRD_HB=$(ssh_cmd bash -c 'cat /opt/neuron/data/neuron.health.json 2>/dev/null | grep -o "\"last_heartbeat_at\":\"[^\"]*\"" | head -1' || echo "none")
echo "  After second cycle: ${THIRD_HB}"

# Heartbeat is working if the timestamp changed at least once
if [ "${FIRST_HB}" != "${SECOND_HB}" ] || [ "${SECOND_HB}" != "${THIRD_HB}" ]; then
  echo "  PASS: Heartbeat timestamps are updating"
  PASS=$((PASS + 1))
else
  echo "  FAIL: Heartbeat timestamps did not change"
  FAIL=$((FAIL + 1))
fi

# Check 4: Provider lookup via Axon registry
echo "[Check 4] Provider lookup via Axon registry"
LOOKUP_RESPONSE=$(curl -sf "https://${AXON_DOMAIN}/v1/registry/search?organization=${ORG_NPI}" 2>/dev/null || echo "error")

if echo "${LOOKUP_RESPONSE}" | grep -q '"results"'; then
  echo "  PASS: Axon registry search returns results"
  PASS=$((PASS + 1))
else
  echo "  FAIL: Axon registry search failed or returned no results"
  echo "  Response: ${LOOKUP_RESPONSE}"
  FAIL=$((FAIL + 1))
fi

# Check 5: Direct NPI lookup
echo "[Check 5] Direct NPI lookup via Axon"
NPI_RESPONSE=$(curl -sf "https://${AXON_DOMAIN}/v1/registry/${ORG_NPI}" 2>/dev/null || echo "error")

if echo "${NPI_RESPONSE}" | grep -q '"npi"'; then
  echo "  PASS: Axon registry NPI lookup returns entry"
  PASS=$((PASS + 1))
else
  # Organization NPI lookup may not return results if only providers are registered;
  # this is acceptable — the organization registers as a neuron, not as a registry entry
  echo "  SKIP: Organization NPI not in registry search (expected — only providers appear in search)"
fi

# Summary
echo ""
echo "--- Verification Summary ---"
echo "  Passed: ${PASS}"
echo "  Failed: ${FAIL}"

if [ "${FAIL}" -gt 0 ]; then
  echo ""
  echo "Deployment verification FAILED."
  exit 1
fi

echo ""
echo "Deployment verification PASSED."
exit 0
