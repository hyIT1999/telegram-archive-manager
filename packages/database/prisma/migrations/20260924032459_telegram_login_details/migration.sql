-- AlterTable
ALTER TABLE "telegram_accounts" ADD COLUMN     "code_resend_at" TIMESTAMPTZ(3),
ADD COLUMN     "code_type" TEXT,
ADD COLUMN     "dialogs_refreshed_at" TIMESTAMPTZ(3);
