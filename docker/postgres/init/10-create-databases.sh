#!/bin/sh
# Runs once, when the postgres volume is initialised (docker-entrypoint-initdb.d), as the
# superuser. The archive gets its own role, which is NOT a superuser: it owns the application
# database `tam` (Prisma migrations create tables, trusted extensions and triggers in it) and the
# worker's Telegram session database `tam_tg`, and nothing else.
# No `set -u`: the entrypoint sources this file when it is not executable.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=tam_password="$TAM_DB_PASSWORD" <<'SQL'
CREATE ROLE tam LOGIN PASSWORD :'tam_password';
CREATE DATABASE tam OWNER tam;
CREATE DATABASE tam_tg OWNER tam;
SQL
