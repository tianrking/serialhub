#!/usr/bin/env bash
# Build React console then Rust hub (embeds web/dist).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web"
npm ci
npm run build
cd "$ROOT"
cargo build --release "$@"
echo ""
echo "OK: $ROOT/target/release/serialhub"
echo "Try: ./target/release/serialhub share mock:demo --ui"
