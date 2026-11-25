#!/bin/bash
# Otomatik başlatmayı kaldırır.
LABEL="com.agent-ofis.server"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Otomatik başlatma kaldırıldı."
