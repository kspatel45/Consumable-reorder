#!/usr/bin/env bash
# Turns a Lubuntu / Ubuntu PC (the NUC) into the badge kiosk.
# Usage:  sudo bash setup-kiosk.sh https://<your-github-username>.github.io/<repo-name>/kiosk.html
set -euo pipefail

URL="${1:-}"
[ -n "$URL" ] || { echo "Usage: sudo bash setup-kiosk.sh https://<user>.github.io/<repo>/kiosk.html"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
RUN_USER="${SUDO_USER:-$(logname)}"
RUN_HOME=$(getent passwd "$RUN_USER" | cut -d: -f6)

echo "==> Installing Chromium (if needed)"
apt-get update -y && apt-get install -y x11-xserver-utils curl
if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null && [ ! -x /snap/bin/chromium ]; then
  snap install chromium || apt-get install -y chromium-browser
fi

echo "==> Writing kiosk start script"
cat > /usr/local/bin/parts-kiosk <<EOF
#!/usr/bin/env bash
# Keep the screen on
xset s off 2>/dev/null; xset -dpms 2>/dev/null; xset s noblank 2>/dev/null
# Wait for internet (max ~2 min)
for i in \$(seq 1 60); do curl -fs -o /dev/null https://www.gstatic.com && break; sleep 2; done
BROWSER=\$(command -v chromium || command -v chromium-browser || echo /snap/bin/chromium)
exec "\$BROWSER" --kiosk --noerrdialogs --disable-infobars --no-first-run \\
  --disable-translate --disable-features=Translate \\
  --autoplay-policy=no-user-gesture-required \\
  --check-for-update-interval=31536000 "$URL"
EOF
chmod +x /usr/local/bin/parts-kiosk

echo "==> Auto-start at login for $RUN_USER"
mkdir -p "$RUN_HOME/.config/autostart"
cat > "$RUN_HOME/.config/autostart/parts-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Parts Reorder Kiosk
Exec=/usr/local/bin/parts-kiosk
X-GNOME-Autostart-enabled=true
EOF
chown -R "$RUN_USER":"$RUN_USER" "$RUN_HOME/.config/autostart"

echo
echo "Done. Reboot (or run 'parts-kiosk' now)."
echo "First time only: the kiosk asks to sign in - use the Kiosk user you created in Admin > Users."
echo "Exit kiosk: Alt+F4.   Start again: parts-kiosk"
