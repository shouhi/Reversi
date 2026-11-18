#!/usr/bin/env bash
# COLOR HIDE — SAFE production Worker deploy wrapper.
#
# The ONLY sanctioned way to deploy the production realtime Worker. It uses
# wrangler.production.toml (which pins the production non-secret vars) so a deploy
# can never push the dev vars from wrangler.toml. Secrets are NOT handled here;
# COLOR_HIDE_RT_SECRET is set once via `wrangler secret put` and persists.
#
# Usage:
#   ./deploy-production.sh            # DRY-RUN (default): bundle + show, upload nothing
#   ./deploy-production.sh --go       # actually deploy the new code (prod vars pinned)
#   ./deploy-production.sh --stop     # maintenance: deploy with REALTIME_ENABLED=0 (new WS -> 503)
#   ./deploy-production.sh --resume   # clean deploy (REALTIME_ENABLED omitted -> enabled)
#
# Safe-by-default: with no flag it only dry-runs. It refuses to run unless the
# expected account + Worker + secret are present.
set -euo pipefail

cd "$(dirname "$0")"
CONFIG="wrangler.production.toml"
EXPECT_WORKER="color-hide-realtime"
EXPECT_ACCOUNT_ID="6b759fbb864b86c1189a3fb6a5f2c11f"

mode="${1:-dry}"

echo "== preflight =="
# 1) correct Cloudflare account
acct="$(npx wrangler whoami 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1 || true)"
if [ "$acct" != "$EXPECT_ACCOUNT_ID" ]; then
  echo "ABORT: wrong/unknown Cloudflare account (got '${acct:-none}', expected $EXPECT_ACCOUNT_ID)"; exit 1
fi
# 2) config targets the expected production Worker
if ! grep -q "name = \"$EXPECT_WORKER\"" "$CONFIG"; then
  echo "ABORT: $CONFIG does not target $EXPECT_WORKER"; exit 1
fi
# 3) production secret already set (so the deploy preserves it; the DO fails closed otherwise)
if ! npx wrangler secret list --name "$EXPECT_WORKER" 2>/dev/null | grep -q COLOR_HIDE_RT_SECRET; then
  echo "ABORT: COLOR_HIDE_RT_SECRET not set on $EXPECT_WORKER (run 'wrangler secret put' first)"; exit 1
fi
echo "account=$acct worker=$EXPECT_WORKER secret=present config=$CONFIG"

case "$mode" in
  dry)
    echo "== DRY-RUN (no upload). Pass --go to deploy. =="
    npx wrangler deploy --config "$CONFIG" --dry-run
    ;;
  --go)
    echo "== DEPLOY (production vars pinned, secret preserved) =="
    npx wrangler deploy --config "$CONFIG"
    ;;
  --stop)
    echo "== MAINTENANCE STOP (new WS -> 503; existing connections continue) =="
    npx wrangler deploy --config "$CONFIG" --var COLOR_HIDE_REALTIME_ENABLED:0
    ;;
  --resume)
    echo "== RESUME (REALTIME_ENABLED omitted -> enabled) =="
    npx wrangler deploy --config "$CONFIG"
    ;;
  *)
    echo "usage: $0 [--go|--stop|--resume]  (no arg = dry-run)"; exit 2
    ;;
esac
