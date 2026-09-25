#!/bin/sh
# Установка хаба Nebula на бесплатный хостинг serv00.com (FreeBSD).
#
# Зайди по SSH (логин и пароль из письма serv00) и выполни:
#   curl -fsSL https://raw.githubusercontent.com/s3lfcode1337-lang/nebula-launcher/main/hub/serv00.sh | sh
#
# Что делает: разрешает свои программы (binexec), берёт свободный порт,
# скачивает хаб в ~/nebula-hub, запускает его и ставит в cron перезапуск —
# после перезагрузки сервера и раз в 5 минут, если процесс упал.
# Повторный запуск обновляет хаб; порт и данные остаются.
set -e

REPO="https://raw.githubusercontent.com/s3lfcode1337-lang/nebula-launcher/main/hub"
DIR="$HOME/nebula-hub"
say() { echo "[nebula-hub] $*"; }

mkdir -p "$DIR/data"

# --- свои программы ---
devil binexec on >/dev/null 2>&1 || true

# --- Node.js ---
NODE=""
for n in node22 node24 node20 node18 node; do
  if [ -x "/usr/local/bin/$n" ]; then NODE="/usr/local/bin/$n"; break; fi
done
[ -n "$NODE" ] || { say "не нашёл Node.js на сервере"; exit 1; }
say "node: $($NODE -v)"

# --- порт (один раз) ---
if [ -s "$DIR/port" ]; then
  PORT=$(cat "$DIR/port")
else
  out=$(devil port add tcp random nebula-hub 2>&1 || true)
  PORT=$(echo "$out" | grep -Eo '[0-9]{4,5}' | head -1)
  if [ -z "$PORT" ]; then
    echo "$out"
    say "не получилось взять порт — смотри «devil port list»"
    exit 1
  fi
  echo "$PORT" > "$DIR/port"
fi
say "порт: $PORT"

# --- файлы ---
for f in server.mjs worker.js; do
  curl -fsSL "$REPO/$f" -o "$DIR/$f.new"
  mv "$DIR/$f.new" "$DIR/$f"
done

# --- запуск (им же пользуется cron) ---
cat > "$DIR/run.sh" <<EOF
#!/bin/sh
if ! pgrep -u "\$(id -u)" -f "$DIR/server.mjs" >/dev/null 2>&1; then
  cd "$DIR" && PORT=$PORT DATA_DIR="$DIR/data" nohup $NODE "$DIR/server.mjs" >> "$DIR/hub.log" 2>&1 &
fi
EOF
chmod +x "$DIR/run.sh"

# Перезапустить, чтобы подхватить новые файлы.
pkill -u "$(id -u)" -f "$DIR/server.mjs" >/dev/null 2>&1 || true
sleep 1
"$DIR/run.sh"

# --- cron: после перезагрузки и каждые 5 минут ---
tmp=$(mktemp)
crontab -l 2>/dev/null | grep -v "nebula-hub/run.sh" > "$tmp" || true
echo "@reboot $DIR/run.sh" >> "$tmp"
echo "*/5 * * * * $DIR/run.sh" >> "$tmp"
crontab "$tmp"
rm -f "$tmp"

sleep 3
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 || curl -fsS "http://$(hostname):$PORT/health" >/dev/null 2>&1; then
  say "готово! Пришли этот адрес: http://$(hostname):$PORT"
else
  say "хаб не отвечает. Последние строки лога:"
  tail -n 20 "$DIR/hub.log" 2>/dev/null || true
  say "если написано про права/permission — выйди из SSH, зайди снова и запусти команду ещё раз"
  exit 1
fi
