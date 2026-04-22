#!/usr/bin/env bash
# WindsurfAPI — curl example collection
#
# Set BASE to your WindsurfAPI address; if DASHBOARD_PASSWORD is enabled, export it as PW.
#
#   export BASE=http://localhost:3003
#   export PW=your-dashboard-password   # optional
#
# Then run:  ./curl.sh chat        (pick one)

set -e
BASE="${BASE:-http://localhost:3003}"
PW="${PW:-}"

cmd="${1:-help}"

case "$cmd" in

  # ─── OpenAI compatible: chat completion (non-streaming) ──────
  chat)
    curl -sS "$BASE/v1/chat/completions" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "Describe yourself in one sentence"}],
        "stream": false
      }' | head -100
    ;;

  # ─── OpenAI compatible: streaming completion (SSE) ────────────
  stream)
    curl -N -sS "$BASE/v1/chat/completions" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "claude-4.5-sonnet",
        "messages": [{"role": "user", "content": "Write a four-line poem"}],
        "stream": true
      }'
    ;;

  # ─── Anthropic compatible: /v1/messages (used by Claude Code) ──
  messages)
    curl -sS "$BASE/v1/messages" \
      -H "Content-Type: application/json" \
      -H "anthropic-version: 2023-06-01" \
      -d '{
        "model": "claude-4.5-sonnet",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "Hello!"}]
      }' | head -100
    ;;

  # ─── Model list ─────────────────────────────────────────────
  models)
    curl -sS "$BASE/v1/models" | python3 -m json.tool | head -40
    ;;

  # ─── Account management: add account (via token) ───────────────
  login-token)
    TOKEN="${2:-YOUR_WINDSURF_TOKEN_HERE}"
    curl -sS -X POST "$BASE/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"token\": \"$TOKEN\"}"
    ;;

  # ─── Account management: list all accounts ────────────────────────
  accounts)
    curl -sS "$BASE/auth/accounts" | python3 -m json.tool | head -40
    ;;

  # ─── Dashboard: usage stats snapshot ─────────────────────────
  usage)
    curl -sS -H "X-Dashboard-Password: $PW" \
      "$BASE/dashboard/api/usage" | python3 -m json.tool | head -60
    ;;

  # ─── Dashboard: export usage data ────────────────────────────
  export)
    curl -sS -H "X-Dashboard-Password: $PW" \
      "$BASE/dashboard/api/usage/export" -o usage-snapshot.json
    echo "saved → usage-snapshot.json ($(wc -c < usage-snapshot.json) bytes)"
    ;;

  # ─── Dashboard: import usage data (merge + deduplicate) ───────
  import)
    FILE="${2:-usage-snapshot.json}"
    curl -sS -X POST -H "X-Dashboard-Password: $PW" \
      -H "Content-Type: application/json" \
      --data-binary "@$FILE" \
      "$BASE/dashboard/api/usage/import"
    ;;

  *)
    cat <<EOF
Usage: ./curl.sh <command>

Available commands:
  chat          OpenAI compatible: non-streaming completion
  stream        OpenAI compatible: SSE streaming
  messages      Anthropic compatible: /v1/messages
  models        Model list
  login-token   Add account (pass token as 2nd argument)
  accounts      List added accounts
  usage         View usage stats
  export        Export usage data to usage-snapshot.json
  import [f]    Import usage data from JSON file (default: usage-snapshot.json)

Environment variables:
  BASE   WindsurfAPI address (default http://localhost:3003)
  PW     Dashboard password (only needed if enabled)
EOF
    ;;
esac
