-- AlterEnum
-- Alone in its migration: PostgreSQL cannot use a new enum value in the transaction that adds it.
ALTER TYPE "StorageKind" ADD VALUE 'TELEGRAM';
