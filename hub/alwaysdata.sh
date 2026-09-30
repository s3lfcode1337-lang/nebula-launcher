#!/bin/sh
# Установка хаба Nebula на бесплатный alwaysdata.com (Франция, свой дата-центр,
# не Cloudflare — провайдеры в России его не режут до 16 КБ).
#
# 1. Зарегистрируйся на alwaysdata.com: почта и пароль, тариф Free.
# 2. Зайди по SSH: ssh АККАУНТ@ssh-АККАУНТ.alwaysdata.net
#    (или прямо в браузере: https://ssh-АККАУНТ.alwaysdata.net)
# 3. Выполни:
#    curl -fsSL https://raw.githubusercontent.com/s3lfcode1337-lang/nebula-launcher/main/hub/alwaysdata.sh | sh
#
# С токеном API (Profile > Tokens) скрипт сам настроит сайт — панель не нужна:
#    curl -fsSL .../hub/alwaysdata.sh | TOKEN=токен sh
#
# Хаб кладётся в ~/nebula-hub. Повторный запуск обновляет его; команды и ники
# в ~/nebula-hub/data остаются.
set -e

REPO="https://raw.githubusercontent.com/s3lfcode1337-lang/nebula-launcher/main/hub"
DIR="$HOME/nebula-hub"
ACCOUNT="$(basename "$HOME")"
URL="https://$ACCOUNT.alwaysdata.net"
say() { echo "[nebula-hub] $*"; }

mkdir -p "$DIR/data"
for f in server.mjs worker.js; do
  curl -fsSL "$REPO/$f" -o "$DIR/$f.new"
  mv "$DIR/$f.new" "$DIR/$f"
done
say "файлы хаба: $DIR"
say "node: $(NODEJS_VERSION=22 node -v 2>/dev/null || echo 'не найден')"

healthy() { curl -fsS --max-time 15 "$URL/health" 2>/dev/null | grep -q '^ok'; }

if [ -n "$TOKEN" ]; then
  say "настраиваю сайт $ACCOUNT.alwaysdata.net через API"
  cat > "$DIR/.site.mjs" <<'EOF'
const { TOKEN, ACCOUNT, DIR } = process.env;
const auth = "Basic " + Buffer.from(`${TOKEN} account=${ACCOUNT}:`).toString("base64");
const API = "https://api.alwaysdata.com/v1";
async function call(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { authorization: auth, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 400)}`);
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}
const address = `${ACCOUNT}.alwaysdata.net`;
const nameOf = (a) => (typeof a === "string" ? a : a && (a.name || a.address || a.value)) || "";
const want = {
  type: "nodejs",
  command: `node ${DIR}/server.mjs`,
  working_directory: "nebula-hub",
  environment: `DATA_DIR=${DIR}/data NODEJS_VERSION=22`,
};
const sites = await call("GET", "/site/");
const list = Array.isArray(sites) ? sites : [];
let site = list.find((s) => (s.addresses || []).some((a) => nameOf(a) === address));
let id;
if (site) {
  id = site.id;
  await call("PATCH", `/site/${id}/`, want);
  console.log(`[nebula-hub] сайт #${id} переключён на Node.js`);
} else {
  await call("POST", "/site/", { name: "nebula-hub", addresses: [address], ...want });
  const again = await call("GET", "/site/");
  site = (Array.isArray(again) ? again : []).find((s) => (s.addresses || []).some((a) => nameOf(a) === address));
  id = site && site.id;
  console.log(`[nebula-hub] создан сайт${id ? " #" + id : ""} на ${address}`);
}
if (id) await call("POST", `/site/${id}/restart/`).catch(() => {});
EOF
  if ! TOKEN="$TOKEN" ACCOUNT="$ACCOUNT" DIR="$DIR" NODEJS_VERSION=22 node "$DIR/.site.mjs"; then
    rm -f "$DIR/.site.mjs"
    say "API не приняло настройку — пришли текст ошибки выше"
    exit 1
  fi
  rm -f "$DIR/.site.mjs"
fi

# Хаб с новыми файлами: платформа сама поднимет процесс на следующем запросе.
pkill -u "$(id -u)" -f "$DIR/server.mjs" >/dev/null 2>&1 || true

say "жду, пока сайт поднимется..."
i=0
while [ $i -lt 12 ]; do
  sleep 5
  if healthy; then
    say "готово! Хаб работает: $URL"
    say "пришли этот адрес — его пропишут в hub.txt, и игроки переедут сами"
    [ -n "$TOKEN" ] && say "токен больше не нужен — удали его в Profile > Tokens"
    exit 0
  fi
  i=$((i + 1))
done

cat <<EOF

[nebula-hub] Файлы на месте, но $URL/health пока не отвечает «ok».

  Сайт можно включить сам скрипт — с токеном API (Profile > Tokens):
    curl -fsSL $REPO/alwaysdata.sh | TOKEN=токен sh

  Или вручную в панели: Web > Sites > сайт $ACCOUNT.alwaysdata.net > карандаш
    Type ............. Node.js
    Command .......... node $DIR/server.mjs
    Working directory  nebula-hub
    Environment ...... DATA_DIR=$DIR/data NODEJS_VERSION=22

  Потом открой $URL/health — должно показать «ok 0».
EOF
