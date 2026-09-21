#!/bin/bash
set -u
cd "$(dirname "$0")/.."
GATEWAY_TOKEN=qa-token bun src/cli.ts serve --host 127.0.0.1 --port 18473 >/tmp/everyone-gateway-qa.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; echo "CLEANUP_SERVER_PID=$pid"' EXIT
until curl -fsS http://127.0.0.1:18473/health >/dev/null; do sleep 1; done
echo "MODELS_RESPONSE"
curl -i -sS http://127.0.0.1:18473/v1/models -H "Authorization: Bearer qa-token"
echo "CHAT_RESPONSE"
curl -i -sS http://127.0.0.1:18473/v1/chat/completions \
  -H "Authorization: Bearer qa-token" \
  -H "Content-Type: application/json" \
  --data '{"model":"deepseek","messages":[{"role":"user","content":"Reply with OK"}],"max_tokens":8}'
echo "SERVER_LOG"
cat /tmp/everyone-gateway-qa.log
