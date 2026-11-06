-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('requirements_not_met', 'needs_review', 'reviewed');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('advance', 'reject');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'screening_review';

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "requirements" JSONB,
ADD COLUMN     "reviewAiRecommendation" "ReviewDecision",
ADD COLUMN     "reviewAiScore" DOUBLE PRECISION,
ADD COLUMN     "reviewDecision" "ReviewDecision",
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "reviewStatus" "ReviewStatus",
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" UUID;

-- CreateIndex
CREATE INDEX "applications_requisitionId_reviewStatus_idx" ON "applications"("requisitionId", "reviewStatus");
