-- Runs once, when the postgres volume is initialised (docker-entrypoint-initdb.d).
-- The application database `tam` is created from POSTGRES_DB; the worker keeps its Telegram
-- session in a separate database that Prisma migrations never touch.
CREATE DATABASE tam_tg OWNER tam;
