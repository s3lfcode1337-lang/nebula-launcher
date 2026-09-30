# Хаб Nebula в контейнере — для бесплатных площадок, которые собирают
# образ из GitHub (Back4app Containers и подобные).
#
# Корень сборки — папка hub/. Хаб слушает PORT (8080), данные — во временной
# папке: на бесплатных контейнерах диск всё равно чистится при перезапуске,
# а команды и ники игроки восстановят сами.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs worker.js ./
ENV PORT=8080 DATA_DIR=/tmp/nebula-hub
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "server.mjs"]
