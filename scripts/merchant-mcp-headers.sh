#!/usr/bin/env bash
# headersHelper for the Google Merchant API MCP server (.mcp.json → google-merchant).
# Mints an OAuth access token from a service account key and prints the HTTP headers as JSON.
# Key source: $MERCHANT_SA_KEY — the service account JSON file contents (raw or base64).
set -euo pipefail

SCOPE="https://www.googleapis.com/auth/content"
TOKEN_URL="https://oauth2.googleapis.com/token"
CACHE="${TMPDIR:-/tmp}/merchant-mcp-token.json"

die() { echo "merchant-mcp-headers: $*" >&2; exit 1; }

[ -n "${MERCHANT_SA_KEY:-}" ] || die "MERCHANT_SA_KEY is not set (add the service account JSON as an environment secret)"
command -v jq >/dev/null || die "jq is required"
command -v openssl >/dev/null || die "openssl is required"

key_json="$MERCHANT_SA_KEY"
case "$key_json" in
  \{*) ;;
  *) key_json="$(printf '%s' "$key_json" | base64 -d 2>/dev/null)" || die "MERCHANT_SA_KEY is neither JSON nor base64 JSON" ;;
esac

client_email="$(jq -er .client_email <<<"$key_json")" || die "client_email missing from key"
project_id="$(jq -er .project_id <<<"$key_json")" || die "project_id missing from key"

emit() { jq -cn --arg t "$1" --arg p "$project_id" '{"Authorization": ("Bearer " + $t), "x-goog-user-project": $p}'; }

now="$(date +%s)"
if [ -f "$CACHE" ]; then
  cached_exp="$(jq -r '.exp // 0' "$CACHE" 2>/dev/null || echo 0)"
  cached_email="$(jq -r '.email // ""' "$CACHE" 2>/dev/null || echo)"
  if [ "$cached_email" = "$client_email" ] && [ "$cached_exp" -gt $((now + 300)) ]; then
    emit "$(jq -r .token "$CACHE")"
    exit 0
  fi
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

keyfile="$(mktemp)"
trap 'rm -f "$keyfile"' EXIT
chmod 600 "$keyfile"
jq -r .private_key <<<"$key_json" >"$keyfile"

header="$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)"
claims="$(jq -cn --arg iss "$client_email" --arg scope "$SCOPE" --arg aud "$TOKEN_URL" --argjson iat "$now" \
  '{iss: $iss, scope: $scope, aud: $aud, iat: $iat, exp: ($iat + 3600)}' | b64url)"
signature="$(printf '%s.%s' "$header" "$claims" | openssl dgst -sha256 -sign "$keyfile" | b64url)" || die "failed to sign JWT"

response="$(curl -sS -X POST "$TOKEN_URL" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
  --data-urlencode "assertion=$header.$claims.$signature")" || die "token request failed"

token="$(jq -er .access_token <<<"$response" 2>/dev/null)" || die "token exchange failed: $response"
expires_in="$(jq -r '.expires_in // 3600' <<<"$response")"

(umask 077; jq -cn --arg t "$token" --arg e "$client_email" --argjson exp $((now + expires_in)) \
  '{token: $t, email: $e, exp: $exp}' >"$CACHE")

emit "$token"
