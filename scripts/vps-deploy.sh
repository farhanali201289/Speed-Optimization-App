#!/usr/bin/env bash
# Runs on the VPS (called by scripts/deploy.cmd after `git pull`).
# Builds and restarts the app on its own Node 22 in /opt/node22. The system Node
# and every other PM2 app on the server are left untouched.
set -euo pipefail

NODE_VERSION=v22.23.5
NODE_DIR=/opt/node22
APP_DIR=/var/www/Speed-Optimization-App
TARBALL="node-$NODE_VERSION-linux-x64.tar.xz"

if [ "$("$NODE_DIR/bin/node" -v 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  echo "Installing Node $NODE_VERSION into $NODE_DIR (system Node is not changed)..."
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$TARBALL" -o "$tmp/$TARBALL"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xJf "$tmp/$TARBALL" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
fi

cd "$APP_DIR"
export PATH="$NODE_DIR/bin:$PATH"
echo "Using node $(node -v), npm $(npm -v)"

npm install
npm run setup
npm run build

set -a
. ./.env
set +a

pm2 delete speed-optimizer >/dev/null 2>&1 || true
pm2 start node_modules/@react-router/serve/bin.js \
  --name speed-optimizer \
  --interpreter "$NODE_DIR/bin/node" \
  -- build/server/index.js
pm2 save
pm2 list
