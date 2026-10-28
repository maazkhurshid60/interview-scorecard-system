-- Which fields were saved as an explicit null (MongoDB told "null" and "not set" apart; an empty column cannot).
ALTER TABLE "users" ADD COLUMN "nullFields" JSONB;
ALTER TABLE "refresh_tokens" ADD COLUMN "nullFields" JSONB;
ALTER TABLE "settings" ADD COLUMN "nullFields" JSONB;
ALTER TABLE "audit_logs" ADD COLUMN "nullFields" JSONB;
ALTER TABLE "departments" ADD COLUMN "nullFields" JSONB;
ALTER TABLE "pipeline_templates" ADD COLUMN "nullFields" JSONB;
ALTER TABLE "candidates" ADD COLUMN "nullFields" JSONB;
ALTER TABLE "requisitions" ADD COLUMN "nullFields" JSONB;
ALTER TABLE "scorecards" ADD COLUMN "nullFields" JSONB;
ALTER TABLE "applications" ADD COLUMN "nullFields" JSONB;
ALTER TABLE "interviews" ADD COLUMN "nullFields" JSONB;
