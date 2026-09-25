#!/bin/bash
# Установка хаба Nebula на свой сервер (Ubuntu / Oracle Linux, x86_64 или ARM).
#
#   curl -fsSL https://raw.githubusercontent.com/s3lfcode1337-lang/nebula-launcher/main/hub/install.sh | sudo bash
#
# Ставит Node.js (если нет или старый), кладёт хаб в /opt/nebula-hub, запускает
# его службой systemd на порту 8080 и открывает порт в файрволе самой машины.
# Повторный запуск обновляет хаб, данные (команды, ники) остаются.
set -euo pipefail

PORT="${PORT:-8080}"
REPO="https://raw.githubusercontent.com/s3lfcode1337-lang/nebula-launcher/main/hub"
DIR=/opt/nebula-hub
NODE_VERSION=v22.12.0

if [ "$(id -u)" -ne 0 ]; then echo "Запусти через sudo"; exit 1; fi
log() { echo "[nebula-hub] $*"; }

# --- Node.js 18+ ---
need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "$major" -ge 18 ] && need_node=0
fi
if [ -x /opt/node/bin/node ]; then need_node=0; fi
if [ "$need_node" -eq 1 ]; then
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "Неизвестная архитектура $(uname -m)"; exit 1 ;;
  esac
  log "ставлю Node.js $NODE_VERSION ($arch)"
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$arch.tar.xz" -o "$tmp/node.tar.xz"
  mkdir -p /opt/node
  tar -xJf "$tmp/node.tar.xz" -C /opt/node --strip-components=1
  rm -rf "$tmp"
fi
NODE=$(command -v node || true)
[ -x /opt/node/bin/node ] && NODE=/opt/node/bin/node
log "node: $($NODE -v)"

# --- файлы хаба ---
id nebula >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin nebula
mkdir -p "$DIR/data"
for f in server.mjs worker.js; do
  curl -fsSL "$REPO/$f" -o "$DIR/$f.new"
  mv "$DIR/$f.new" "$DIR/$f"
done
chown -R nebula:nebula "$DIR"

# --- служба ---
cat > /etc/systemd/system/nebula-hub.service <<EOF
[Unit]
Description=Nebula hub
After=network-online.target
Wants=network-online.target

[Service]
User=nebula
WorkingDirectory=$DIR
Environment=PORT=$PORT
Environment=DATA_DIR=$DIR/data
ExecStart=$NODE $DIR/server.mjs
Restart=always
RestartSec=2
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable nebula-hub >/dev/null
systemctl restart nebula-hub

# --- файрвол самой машины (у образов Oracle он закрыт всё, кроме SSH) ---
if command -v iptables >/dev/null 2>&1; then
  if ! iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
    iptables -I INPUT 1 -p tcp --dport "$PORT" -j ACCEPT
    if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save >/dev/null 2>&1 || true; fi
    if [ -d /etc/iptables ]; then iptables-save > /etc/iptables/rules.v4 || true; fi
  fi
fi
if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="$PORT/tcp" >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then ufw allow "$PORT/tcp" >/dev/null || true; fi

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then
  ip=$(curl -fsS https://api.ipify.org 2>/dev/null || echo "<IP сервера>")
  log "готово: хаб работает. Адрес для hub.txt: http://$ip:$PORT"
else
  log "служба не отвечает — смотри: journalctl -u nebula-hub -n 50"
  exit 1
fi
