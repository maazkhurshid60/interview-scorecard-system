-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'admin', 'hiring_manager', 'recruiter', 'interviewer');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('score_override', 'score_approve', 'question_edit', 'stage_toggle', 'weight_change', 'disposition_change', 'final_decision', 'provider_change', 'key_change', 'transcript_upload', 'consent_capture', 'retention_purge', 'requisition_status_change', 'candidate_update', 'requisition_duplicated', 'offer_letter_sent', 'requisition_deleted');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('full_time', 'part_time', 'contract', 'internship', 'temporary');

-- CreateEnum
CREATE TYPE "WorkplaceType" AS ENUM ('onsite', 'hybrid', 'remote');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('open', 'paused', 'closed', 'draft', 'on_hold');

-- CreateEnum
CREATE TYPE "ApplicationSource" AS ENUM ('public_link', 'manual');

-- CreateEnum
CREATE TYPE "ScreeningStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "Disposition" AS ENUM ('HIRE', 'MAYBE', 'NO_HIRE');

-- CreateEnum
CREATE TYPE "FinalDecision" AS ENUM ('hired', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent');

-- CreateEnum
CREATE TYPE "MeetingMode" AS ENUM ('online', 'in_person');

-- CreateEnum
CREATE TYPE "TranscriptProvider" AS ENUM ('google_meet', 'zoom', 'fathom', 'manual');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('none', 'pending', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('pending', 'scheduled', 'transcript_pending', 'scored', 'approved');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordResetTokenHash" TEXT,
    "passwordResetExpiresAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "role" "UserRole" NOT NULL DEFAULT 'recruiter',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nullFields" JSONB,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "familyStartedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nullFields" JSONB,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nullFields" JSONB,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "action" "AuditAction" NOT NULL,
    "userId" INTEGER,
    "requisitionId" INTEGER,
    "applicationId" INTEGER,
    "targetType" TEXT,
    "targetId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nullFields" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nullFields" JSONB,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_templates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "autoWeights" BOOLEAN NOT NULL DEFAULT true,
    "stages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nullFields" JSONB,

    CONSTRAINT "pipeline_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "resumeFileUrl" TEXT,
    "resumeFilePublicId" TEXT,
    "resumeFileName" TEXT,
    "resumeFileSize" DOUBLE PRECISION,
    "resumeFileMimeType" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nullFields" JSONB,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisitions" (
    "id" SERIAL NOT NULL,
    "legacyId" TEXT,
    "publicToken" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "title" TEXT NOT NULL,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'full_time',
    "fullTimeDetails" JSONB,
    "partTimeDetails" JSONB,
    "contractDetails" JSONB,
    "internshipDetails" JSONB,
    "temporaryDetails" JSONB,
    "location" TEXT NOT NULL DEFAULT 'Remote',
    "workplaceType" "WorkplaceType" NOT NULL DEFAULT 'remote',
    "officeLocation" TEXT NOT NULL DEFAULT '',
    "remoteRegion" TEXT NOT NULL DEFAULT '',
    "jobDescription" TEXT NOT NULL,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'open',
    "departmentId" INTEGER,
    "pipelineTemplateId" INTEGER,
    "pipelineTemplateName" TEXT,
    "stages" JSONB NOT NULL DEFAULT '[]',
    "scorecardId" INTEGER,
    "hireThreshold" DOUBLE PRECISION NOT NULL DEFAULT 3.5,
    "maybeThreshold" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "initialScreeningCriteria" JSONB NOT NULL DEFAULT '[]',
    "questionnaire" JSONB NOT NULL DEFAULT '[]',
    "interviewAvailability" JSONB,
    "applicationDeadline" TIMESTAMP(3),
    "aiScreeningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "closedAt" TIMESTAMP(3),
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nullFields" JSONB,

    CONSTRAINT "requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorecards" (
    "id" SERIAL NOT NULL,
    "requisitionId" INTEGER NOT NULL,
    "generatedByAI" BOOLEAN NOT NULL DEFAULT true,
    "stages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nullFields" JSONB,

    CONSTRAINT "scorecards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" SERIAL NOT NULL,
    "candidateId" INTEGER NOT NULL,
    "requisitionId" INTEGER NOT NULL,
    "currentStageKey" TEXT,
    "source" "ApplicationSource" NOT NULL DEFAULT 'manual',
    "opportunityDuration" TEXT,
    "questionnaireAnswers" JSONB,
    "candidateAvailability" JSONB,
    "screeningStatus" "ScreeningStatus",
    "screeningAttempts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "screeningLockedAt" TIMESTAMP(3),
    "screeningCompletedAt" TIMESTAMP(3),
    "screeningLastError" TEXT,
    "screeningConfirmationEmailSentAt" TIMESTAMP(3),
    "stageProgress" JSONB NOT NULL DEFAULT '[]',
    "initialScreening" JSONB,
    "weightedTotal" DOUBLE PRECISION,
    "allGatesPassed" BOOLEAN,
    "disposition" "Disposition",
    "rank" DOUBLE PRECISION,
    "finalDecision" "FinalDecision",
    "finalDecisionBy" INTEGER,
    "rejectionReason" TEXT,
    "offerLetterUrl" TEXT,
    "offerLetterPublicId" TEXT,
    "offerLetterFileName" TEXT,
    "offerLetterFileSize" DOUBLE PRECISION,
    "offerLetterFileMimeType" TEXT,
    "offerLetterUploadedAt" TIMESTAMP(3),
    "offerLetterTemplateKey" TEXT,
    "offerLetterFields" JSONB,
    "offerLetterDeliveryStatus" "DeliveryStatus",
    "offerLetterSentAt" TIMESTAMP(3),
    "onboardingFormDeliveryStatus" "DeliveryStatus",
    "onboardingFormSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nullFields" JSONB,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" SERIAL NOT NULL,
    "legacyId" TEXT,
    "publicToken" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "applicationId" INTEGER NOT NULL,
    "requisitionId" INTEGER NOT NULL,
    "stageKey" TEXT NOT NULL,
    "meetingMode" "MeetingMode" NOT NULL DEFAULT 'online',
    "provider" "TranscriptProvider" NOT NULL DEFAULT 'google_meet',
    "meetingUri" TEXT,
    "calendarEventId" TEXT,
    "meetingStart" TIMESTAMP(3),
    "meetingEnd" TIMESTAMP(3),
    "conferenceId" TEXT,
    "designatedScorerId" INTEGER,
    "candidateAvailability" JSONB,
    "consentObtained" BOOLEAN NOT NULL DEFAULT false,
    "transcriptText" TEXT,
    "transcriptStatus" "TranscriptStatus" NOT NULL DEFAULT 'none',
    "artifactFileUrl" TEXT,
    "artifactFilePublicId" TEXT,
    "artifactFileName" TEXT,
    "artifactFileSize" DOUBLE PRECISION,
    "artifactFileMimeType" TEXT,
    "scores" JSONB NOT NULL DEFAULT '[]',
    "stageAverage" DOUBLE PRECISION,
    "status" "InterviewStatus" NOT NULL DEFAULT 'pending',
    "aiInputTokens" DOUBLE PRECISION,
    "aiOutputTokens" DOUBLE PRECISION,
    "aiCostUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nullFields" JSONB,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_requisitionId_idx" ON "audit_logs"("requisitionId");

-- CreateIndex
CREATE INDEX "audit_logs_applicationId_idx" ON "audit_logs"("applicationId");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_templates_name_key" ON "pipeline_templates"("name");

-- CreateIndex
CREATE INDEX "pipeline_templates_isDefault_idx" ON "pipeline_templates"("isDefault");

-- CreateIndex
CREATE INDEX "candidates_name_idx" ON "candidates"("name");

-- CreateIndex
CREATE INDEX "candidates_email_idx" ON "candidates"("email");

-- CreateIndex
CREATE UNIQUE INDEX "requisitions_legacyId_key" ON "requisitions"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "requisitions_publicToken_key" ON "requisitions"("publicToken");

-- CreateIndex
CREATE INDEX "requisitions_title_idx" ON "requisitions"("title");

-- CreateIndex
CREATE INDEX "requisitions_workplaceType_idx" ON "requisitions"("workplaceType");

-- CreateIndex
CREATE INDEX "requisitions_status_idx" ON "requisitions"("status");

-- CreateIndex
CREATE INDEX "requisitions_departmentId_idx" ON "requisitions"("departmentId");

-- CreateIndex
CREATE INDEX "scorecards_requisitionId_idx" ON "scorecards"("requisitionId");

-- CreateIndex
CREATE INDEX "applications_candidateId_idx" ON "applications"("candidateId");

-- CreateIndex
CREATE INDEX "applications_requisitionId_idx" ON "applications"("requisitionId");

-- CreateIndex
CREATE INDEX "applications_requisitionId_weightedTotal_idx" ON "applications"("requisitionId", "weightedTotal" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "interviews_legacyId_key" ON "interviews"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "interviews_publicToken_key" ON "interviews"("publicToken");

-- CreateIndex
CREATE INDEX "interviews_applicationId_idx" ON "interviews"("applicationId");

-- CreateIndex
CREATE INDEX "interviews_requisitionId_idx" ON "interviews"("requisitionId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------------------------
-- Rules from the Mongoose models that a plain column cannot carry (see prisma/extra-constraints.sql for the reasons).
-- ---------------------------------------------------------------------------------------------------------------

-- Requisition.title: minlength 5
ALTER TABLE requisitions ADD CONSTRAINT requisitions_title_min_length CHECK (char_length(title) >= 5) NOT VALID;

-- Requisition.hireThreshold and maybeThreshold: min 1, max 5
ALTER TABLE requisitions ADD CONSTRAINT requisitions_hire_threshold_range CHECK ("hireThreshold" BETWEEN 1 AND 5) NOT VALID;
ALTER TABLE requisitions ADD CONSTRAINT requisitions_maybe_threshold_range CHECK ("maybeThreshold" BETWEEN 1 AND 5) NOT VALID;

-- Candidate.phone: empty, or exactly 11 digits (the Mongoose validator)
ALTER TABLE candidates ADD CONSTRAINT candidates_phone_format CHECK (phone IS NULL OR phone = '' OR phone ~ '^[0-9]{11}$') NOT VALID;

-- Department.name: MongoDB also kept a case-insensitive index on the name (collation en, strength 2)
CREATE INDEX departments_name_lower_idx ON departments (lower(name));

