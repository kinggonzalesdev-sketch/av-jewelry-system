#!/usr/bin/env bash
# ============================================================================
# Create the 6 UAT auth accounts — STAGING / LOCAL ONLY
# ----------------------------------------------------------------------------
# Implements docs/UAT-SETUP-ACCOUNTS-DATA-DEVICES.md §1.
#
# ⚠️  NEVER point this at production.
#
# NO PASSWORD IS STORED IN THIS FILE. It is read from the environment, so the
# credential lives in your shell session and nowhere on disk:
#
#     export UAT_PASSWORD='<choose one>'
#     bash supabase/seed-uat-accounts.sh
#     psql "$(npx supabase status -o env | grep '^DB_URL' | cut -d'"' -f2)" \
#          -f supabase/seed-uat.sql
#
# Uses the local service-role key from `supabase status`. That key is the
# well-known local development key printed by the Supabase CLI for every local
# project — it is not a secret and it grants nothing outside this machine. A
# real staging project's key must NEVER be pasted into a file.
# ============================================================================
set -euo pipefail

if [[ -z "${UAT_PASSWORD:-}" ]]; then
  echo "ERROR: UAT_PASSWORD is not set." >&2
  echo "  export UAT_PASSWORD='<choose one>'   then re-run." >&2
  exit 1
fi

API_URL="${API_URL:-$(npx supabase status -o env | grep '^API_URL' | cut -d'"' -f2)}"
SERVICE_KEY="${SERVICE_ROLE_KEY:-$(npx supabase status -o env | grep '^SERVICE_ROLE_KEY' | cut -d'"' -f2)}"

if [[ "$API_URL" != *"127.0.0.1"* && "$API_URL" != *"localhost"* ]]; then
  echo "REFUSING: API_URL is not local ($API_URL)." >&2
  echo "This script is for local/staging only. Re-check before proceeding." >&2
  exit 1
fi

EMAILS=(
  "uat-owner@uat.local"
  "uat-admin@uat.local"
  "uat-staff-full@uat.local"
  "uat-staff-2@uat.local"
  "uat-staff-limited@uat.local"
  "uat-staff-noperm@uat.local"
)

for email in "${EMAILS[@]}"; do
  code=$(curl -s -o /tmp/uat-user.json -w '%{http_code}' \
    -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$UAT_PASSWORD\",\"email_confirm\":true}")

  case "$code" in
    200|201) echo "created  $email" ;;
    422)     echo "exists   $email (skipped)" ;;
    *)       echo "FAILED   $email (HTTP $code)"; cat /tmp/uat-user.json; exit 1 ;;
  esac
done

rm -f /tmp/uat-user.json
echo
echo "Done. Now load the dataset:"
echo "  psql \"\$DB_URL\" -f supabase/seed-uat.sql"
