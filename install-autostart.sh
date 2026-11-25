#!/bin/bash
# Agent Ofis'i oturum açılınca kendiliğinden başlatır (macOS LaunchAgent).
# Kaldırmak için: ./uninstall-autostart.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"
[ -z "$NODE" ] && { echo "Node.js bulunamadı (https://nodejs.org, sürüm 18+)"; exit 1; }
LABEL="com.agent-ofis.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <!-- Background seçilirse macOS işlemciyi kısıyor ve ilk tarama bitmiyor -->
  <key>ProcessType</key><string>Standard</string>
  <key>StandardOutPath</key><string>/tmp/agent-ofis.log</string>
  <key>StandardErrorPath</key><string>/tmp/agent-ofis.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Kuruldu → http://127.0.0.1:4777 (günlük: /tmp/agent-ofis.log)"
