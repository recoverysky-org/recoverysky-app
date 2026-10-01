#!/usr/bin/env bash
# Wipe every user on the DEV Auth0 tenant (bad-bitch-tenant) — for clean
# linking / wrong-account tests. Auth0 users only: the dev API's rows and the
# app's local data are untouched (the app's 🧨 DEV Purge button covers the latter).
#   auth0/scripts/wipe-dev-users.sh            # dry run: list users + identities
#   auth0/scripts/wipe-dev-users.sh --delete   # delete them all
# Credentials: AUTH_MGMT_* from ../api/.env next to this checkout (override with
# ENV_FILE=…); needs read:users + delete:users. Hard-refuses any tenant but dev.
set -euo pipefail
ENV_FILE="${ENV_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../../api/.env}"
set -a; source <(grep -E '^AUTH_MGMT_' "$ENV_FILE"); set +a

# Hard guard: never run against prod (meetingmaker / auth.recoverysky.app).
case "$AUTH_MGMT_DOMAIN" in
  *bad-bitch-tenant*) echo "Tenant: $AUTH_MGMT_DOMAIN (dev) ✅" ;;
  *) echo "REFUSING: AUTH_MGMT_DOMAIN=$AUTH_MGMT_DOMAIN is not the dev tenant" >&2; exit 1 ;;
esac

TOKEN=$(curl -sf "https://$AUTH_MGMT_DOMAIN/oauth/token" -H 'content-type: application/json' \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"$AUTH_MGMT_CLIENT_ID\",\"client_secret\":\"$AUTH_MGMT_CLIENT_SECRET\",\"audience\":\"https://$AUTH_MGMT_DOMAIN/api/v2/\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

echo "Scopes: $(python3 -c 'import sys,json,base64;t=sys.argv[1].split(".")[1];print(json.loads(base64.urlsafe_b64decode(t+"=="))["scope"])' "$TOKEN" | tr ' ' '\n' | grep -E 'users' | tr '\n' ' ')"

IDS=()
page=0
while :; do
  resp=$(curl -sf "https://$AUTH_MGMT_DOMAIN/api/v2/users?per_page=100&page=$page&fields=user_id,email,created_at,identities&include_fields=true" \
    -H "Authorization: Bearer $TOKEN")
  n=$(echo "$resp" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
  [ "$n" -eq 0 ] && break
  echo "$resp" | python3 -c 'import sys,json
for u in json.load(sys.stdin):
  print("  %-45s %-40s %s" % (u["user_id"], u.get("email") or "-", (u.get("created_at") or "")[:10]))
  for i in u.get("identities") or []: print("      identity: %s|%s" % (i.get("provider"), i.get("user_id")))'
  while read -r id; do IDS+=("$id"); done < <(echo "$resp" | python3 -c 'import sys,json;[print(u["user_id"]) for u in json.load(sys.stdin)]')
  page=$((page+1))
done
echo "Total users: ${#IDS[@]}"

if [ "${1:-}" != "--delete" ]; then echo "Dry run. Re-run with --delete to remove them."; exit 0; fi

fail=0
for id in "${IDS[@]}"; do
  enc=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$id")
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "https://$AUTH_MGMT_DOMAIN/api/v2/users/$enc" -H "Authorization: Bearer $TOKEN")
  echo "  $code  $id"
  [ "$code" = "204" ] || fail=$((fail+1))
  sleep 0.3   # stay under the dev tenant's mgmt rate limit
done
if [ "$fail" -gt 0 ]; then echo "$fail delete(s) FAILED (403 = token lacks delete:users)" >&2; exit 1; fi
echo "Done 💖"
