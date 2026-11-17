#!/usr/bin/env bash
# Runs on the VPS. Reads KEY=value lines from stdin and updates (or adds) only
# SHOPIFY_API_KEY and SHOPIFY_API_SECRET in .env, so secrets never appear on a command line.
set -euo pipefail

ENV_FILE=/var/www/Speed-Optimization-App/.env
updated=0

while IFS= read -r line || [ -n "$line" ]; do
  line=${line%$'\r'}
  key=${line%%=*}
  value=${line#*=}
  case "$key" in
    SHOPIFY_API_KEY|SHOPIFY_API_SECRET) ;;
    *) continue ;;
  esac
  [ -n "$value" ] || continue
  if grep -q "^$key=" "$ENV_FILE"; then
    tmp=$(mktemp)
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
  updated=$((updated + 1))
done

echo "Updated $updated Shopify credential(s) in $ENV_FILE"
