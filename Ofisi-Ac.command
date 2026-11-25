#!/bin/zsh
# Çift tıkla: Agent Ofis sunucusunu başlatır ve tarayıcıda açar.
cd "$(dirname "$0")"
if ! curl -s -o /dev/null http://127.0.0.1:4777/api/state; then
  nohup node server.js > /tmp/agent-ofis.log 2>&1 &
  sleep 2
fi
open http://127.0.0.1:4777
