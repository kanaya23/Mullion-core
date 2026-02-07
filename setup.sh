#!/usr/bin/env bash
set -euo pipefail

STEP=""
fail() {
  echo "✗ Failed at step: $STEP" >&2
  exit 1
}
trap fail ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/mullion.config.json"

STEP="Check Ubuntu version"
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID}" != "ubuntu" ]]; then
    echo "Unsupported Ubuntu distribution: ${ID}. Expected ubuntu." >&2
    exit 1
  fi
  if [[ "${VERSION_ID}" != "22.04" && "${VERSION_ID}" != "24.04" ]]; then
    echo "Unsupported Ubuntu version: ${VERSION_ID}. Expected 22.04 or 24.04." >&2
    exit 1
  fi
else
  echo "Cannot determine OS version." >&2
  exit 1
fi
echo "✓ Ubuntu version OK"

STEP="Update packages and install base dependencies"
apt-get update
apt-get install -y curl unzip git ca-certificates gnupg
echo "✓ Base dependencies installed"

STEP="Create mullion user"
if ! id -u mullion >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin mullion
fi
echo "✓ User ensured"

STEP="Ensure swap"
if ! swapon --noheadings --raw | grep -q '^/'; then
  fallocate -l 512M /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo "✓ Swap ensured"

STEP="Install Node.js LTS"
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs
echo "✓ Node.js installed"

STEP="Install npm dependencies"
cd "$SCRIPT_DIR"
npm install
echo "✓ npm install complete"

STEP="Install Playwright Chromium and deps"
npx playwright install --with-deps chromium
echo "✓ Playwright installed"

STEP="Install Caddy"
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
apt-get update
apt-get install -y caddy
echo "✓ Caddy installed"

STEP="Generate Caddyfile"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing mullion.config.json at $CONFIG_FILE" >&2
  exit 1
fi
DOMAIN=$(node -e "const c=require('$CONFIG_FILE'); console.log(c.domain || '')")
PORT=$(node -e "const c=require('$CONFIG_FILE'); console.log(c.port || '')")
if [[ -z "$DOMAIN" || -z "$PORT" ]]; then
  echo "domain/port missing in mullion.config.json" >&2
  exit 1
fi
sed -e "s/{{domain}}/$DOMAIN/g" -e "s/{{port}}/$PORT/g" "$SCRIPT_DIR/caddy/Caddyfile.template" > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy
echo "✓ Caddy configured"

STEP="Create runtime directories"
mkdir -p "$SCRIPT_DIR/profiles" "$SCRIPT_DIR/stacks" "$SCRIPT_DIR/logs" "$SCRIPT_DIR/storage"
chown -R mullion:mullion "$SCRIPT_DIR"
echo "✓ Runtime directories ready"

STEP="Install Mullion systemd service"
cat <<SERVICE_EOF >/etc/systemd/system/mullion.service
[Unit]
Description=Mullion Core Listener
After=network.target

[Service]
Type=simple
User=mullion
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/node $SCRIPT_DIR/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE_EOF
systemctl daemon-reload
systemctl enable mullion
systemctl restart mullion
echo "✓ Mullion service started"

STEP="Self-test"
curl -fsS "https://$DOMAIN/health" > /dev/null
echo "✓ Mullion Core is running"
echo "✓ HTTPS is live at https://$DOMAIN"
echo "✓ Health check passed"
echo "Next steps:"
echo "  1. Add a stack to /stacks/"
echo "  2. Create a profile with: node cli/create-profile.js stack-name"
echo "  3. Deploy the Netlify frontend"
