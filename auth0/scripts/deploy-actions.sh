#!/usr/bin/env bash
# Deploy a tenant's Actions from auth0/actions/<tenant>/ — idempotent, dry run by default.
#   auth0/scripts/deploy-actions.sh bad-bitch-tenant            # report what would change
#   auth0/scripts/deploy-actions.sh bad-bitch-tenant --apply    # make the tenant match the folder
#   auth0/scripts/deploy-actions.sh meetingmaker --apply --prod # prod needs --prod as well
# The logic lives in deploy-actions.mjs (JSON-heavy; Node's fetch beats curl+jq). See its header.
set -euo pipefail
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-actions.mjs" "$@"
