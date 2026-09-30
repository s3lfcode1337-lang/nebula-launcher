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
# Скрипт кладёт хаб в ~/nebula-hub и печатает, что вписать в сайт в панели.
# Повторный запуск обновляет хаб; команды и ники в ~/nebula-hub/data остаются.
set -e

REPO="https://raw.githubusercontent.com/s3lfcode1337-lang/nebula-launcher/main/hub"
DIR="$HOME/nebula-hub"
ACCOUNT="$(basename "$HOME")"
say() { echo "[nebula-hub] $*"; }

mkdir -p "$DIR/data"
for f in server.mjs worker.js; do
  curl -fsSL "$REPO/$f" -o "$DIR/$f.new"
  mv "$DIR/$f.new" "$DIR/$f"
done
say "файлы хаба: $DIR"
say "node: $(NODEJS_VERSION=22 node -v 2>/dev/null || echo 'не найден')"

# Если сайт уже настроен — перезапустить хаб с новыми файлами: платформа сама
# поднимет процесс на следующем запросе.
pkill -u "$(id -u)" -f "$DIR/server.mjs" >/dev/null 2>&1 || true
sleep 2

URL="https://$ACCOUNT.alwaysdata.net"
if curl -fsS --max-time 20 "$URL/health" 2>/dev/null | grep -q '^ok'; then
  say "готово! Хаб работает: $URL"
  say "пришли этот адрес — его пропишут в hub.txt, и игроки переедут сами"
  exit 0
fi

cat <<EOF

[nebula-hub] Файлы на месте. Осталось включить сайт в панели alwaysdata:

  Web > Sites > сайт $ACCOUNT.alwaysdata.net > карандаш (Modify)

    Type ............. Node.js
    Command .......... node $DIR/server.mjs
    Working directory  $DIR
    Environment ...... DATA_DIR=$DIR/data
                       NODEJS_VERSION=22

  Сохрани, подожди полминуты и открой $URL/health
  Должно показать «ok 0». Если да — этот адрес и есть адрес хаба:

    $URL

  Если не открывается — запусти этот скрипт ещё раз, он проверит снова.
EOF
