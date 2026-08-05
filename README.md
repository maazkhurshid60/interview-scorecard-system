# Interview Scorecard System

An internal, AI-powered hiring tool built for **Red Star Technologies** that replaces manual Excel-based interview tracking with a structured, stage-gated scoring pipeline. The system uses **Claude AI (Anthropic)** to analyze interview transcripts and propose candidate scores, while enforcing strict workflow rules that prevent human bias and process shortcuts.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [Seeding the Database](#seeding-the-database)
- [API Endpoints](#api-endpoints)
- [Architecture](#architecture)
- [AI Models & Cost Management](#ai-models--cost-management)
- [Scoring Engine Rules](#scoring-engine-rules)
- [Transcript Providers](#transcript-providers)
- [Security](#security)
- [Known Gaps & Future Improvements](#known-gaps--future-improvements)

---

## Overview

### The Problem
HR teams using Excel spreadsheets to track interview scores face two critical issues:
1. **Data integrity** — Column misalignment can blend candidate scores together.
2. **Process enforcement** — Nothing prevents HR from skipping interview stages or hiring candidates who failed critical evaluations.

### The Solution
This system enforces a strict, stage-gated interview pipeline where:
- **AI proposes scores** — Claude AI reads interview transcripts and suggests 1–5 ratings with evidence-based justifications.
- **Humans approve scores** — AI scores never count until a human reviewer approves or overrides them.
- **Gates block advancement** — Candidates cannot proceed to the next stage until the current stage meets the minimum threshold.
- **Final decisions are computed, not guessed** — The system calculates weighted totals and dispositions (HIRE / MAYBE / NO_HIRE) based on strict mathematical rules.

---

## Key Features

- **AI-Powered Scorecard Generation** — Paste a Job Description, and Claude generates role-specific interview questions with detailed rubric anchors (what a 5/5 and 1/5 answer looks like).
- **Stage-Gated Pipeline** — A default 4-stage pipeline (HR Screen → Sales Simulation → Technical/Ops → Final/CEO) with configurable weights and pass thresholds.
- **Automatic Transcript Fetching** — Integrates with Google Meet REST API to pull interview transcripts automatically after calls end.
- **Manual Transcript Upload** — Fallback option for teams without paid Google Workspace; upload `.txt` files directly.
- **AI Scoring with Human Override** — Claude scores each attribute, but humans have final say. Every override is logged in an immutable audit trail.
- **Candidate Ranking** — Automatically ranks all candidates for a requisition by weighted total score.
- **Configurable Pipeline Templates** — Create, clone, and customize interview pipelines per role.
- **Spend Cap Management** — Tracks Claude API usage and blocks calls when the monthly spend cap is reached.
- **Slack Notifications** — Sends alerts when AI scoring completes, final decisions are made, or spend thresholds are crossed.
- **Data Retention** — Automatically purges transcript text from closed requisitions after a configurable number of days (default: 90), while preserving numeric scores and audit history.
- **Full Audit Log** — Every score override, weight change, stage toggle, and final decision is permanently recorded with timestamps and user attribution.

---

## How It Works

```
1. HR creates a Requisition (job opening) and pastes the Job Description.
2. Claude AI generates interview questions + rubric (5–8 per stage).
3. HR reviews and approves the scorecard (can edit/add/delete questions).
4. Candidates are manually added to the system.
5. For each pipeline stage:
   a. HR creates/pastes a Google Meet link.
   b. HR confirms candidate consent for AI analysis.
   c. Interview happens on Google Meet.
   d. Transcript is fetched automatically or uploaded manually.
   e. Claude AI reads the transcript and proposes 1–5 scores per attribute.
   f. Human reviewer approves or overrides each score.
   g. System checks the stage gate (minimum pass threshold).
   h. If passed → candidate advances. If failed → candidate is blocked.
6. After all stages are complete, the Scoring Engine computes:
   - Weighted total across all stages.
   - Whether all gates passed.
   - Final disposition: HIRE / MAYBE / NO_HIRE.
7. HR records the final decision (hired / rejected / withdrawn).
```

---

## Tech Stack

### Backend
| Technology | Purpose |
|---|---|
| Node.js + Express.js | REST API server |
| MongoDB + Mongoose | Database and ODM |
| Anthropic Claude API | AI scoring and question generation |
| Google Meet REST API | Meeting creation and transcript fetching |
| JSON Web Tokens (JWT) | Authentication |
| Multer | File uploads (resumes, transcripts) |
| Helmet | HTTP security headers |
| Day.js | Date manipulation and formatting |
| Winston/Custom Logger | Daily rotating log files |

### Frontend
| Technology | Purpose |
|---|---|
| React 18 + Vite | UI framework and build tool |
| React Router v6 | Client-side routing |
| Tailwind CSS | Utility-first styling |
| Shadcn/ui Components | Pre-built accessible UI components |
| @tanstack/react-table | Data tables with sorting, filtering, pagination |
| Lucide React | Icon library |
| React Hot Toast | Notification toasts |
| Recharts | Data visualization charts |
| Axios | HTTP client |

---

## Project Structure

```
interview-scorecard-system/
├── server/
│   ├── config/
│   │   └── db.js                    # MongoDB connection
│   ├── controllers/
│   │   ├── authController.js        # Login, get current user
│   │   ├── requisitionController.js # Job CRUD, scorecard generation
│   │   ├── pipelineController.js    # Pipeline template CRUD
│   │   ├── candidateController.js   # Candidate CRUD
│   │   ├── interviewController.js   # Meeting, transcript, AI scoring
│   │   ├── scoringController.js     # Approve, override, recompute, decide
│   │   ├── settingsController.js    # App config, API key management
│   │   └── auditController.js       # Audit log queries
│   ├── middleware/
│   │   ├── auth.js                  # JWT verification + role guard
│   │   ├── errorHandler.js          # Global error handler
│   │   └── upload.js                # Multer file upload config
│   ├── models/
│   │   ├── User.js                  # HR staff accounts
│   │   ├── PipelineTemplate.js      # Reusable interview stage templates
│   │   ├── Requisition.js           # Job openings with snapshotted stages
│   │   ├── Candidate.js             # Candidate profiles
│   │   ├── Application.js           # Candidate ↔ Requisition link
│   │   ├── Scorecard.js             # AI-generated questions + rubric
│   │   ├── Interview.js             # Per-stage instance with scores
│   │   ├── AuditLog.js              # Immutable change history
│   │   └── Setting.js               # Key-value app configuration
│   ├── routes/
│   │   ├── auth.js
│   │   ├── requisitions.js
│   │   ├── pipelines.js
│   │   ├── candidates.js
│   │   ├── interviews.js
│   │   ├── scoring.js
│   │   ├── settings.js
│   │   └── audit.js
│   ├── services/
│   │   ├── claudeClient.js          # Anthropic API gateway with spend tracking
│   │   ├── questionGenerator.js     # AI question/rubric generation
│   │   ├── transcriptProvider.js    # Provider dispatcher (Google/Zoom/Fathom)
│   │   ├── googleMeet.js            # Google Meet API integration
│   │   ├── aiScorer.js              # AI transcript scoring
│   │   ├── scoringEngine.js         # Pure math: averages, gates, disposition
│   │   ├── retentionService.js      # Scheduled transcript purge
│   │   └── slackNotifier.js         # Slack webhook notifications
│   ├── seeds/
│   │   └── seedDefaults.js          # Default admin, pipeline, settings
│   ├── utils/
│   │   ├── constants.js             # All enums, defaults, cost rates
│   │   ├── errors.js                # Custom error classes
│   │   ├── helpers.js               # Shared utility functions
│   │   ├── logger.js                # Console + file logger
│   │   └── retry.js                 # Exponential backoff retry wrapper
│   ├── uploads/                     # Uploaded files (resumes, transcripts)
│   ├── logs/                        # Daily log files
│   └── index.js                     # Express app entry point
│
├── client/
│   └── src/
│       ├── components/              # Reusable UI components
│       ├── context/                 # React Context (auth)
│       ├── hooks/                   # Custom hooks (useApi)
│       ├── pages/                   # Route pages
│       │   ├── Dashboard.jsx
│       │   ├── Login.jsx
│       │   ├── Requisitions.jsx
│       │   ├── RequisitionDetail.jsx
│       │   ├── Candidates.jsx
│       │   ├── InterviewRoom.jsx
│       │   ├── Pipelines.jsx
│       │   ├── Settings.jsx
│       │   └── AuditLog.jsx
│       ├── utils/                   # Formatters and helpers
│       ├── App.jsx                  # Router and layout
│       └── main.jsx                 # Vite entry point
│
├── .env                             # Environment variables (not committed)
├── .env.example                     # Template for environment variables
├── INSTRUCTIONS.md                  # Full system specification
├── HANDOVER.md                      # Setup and deployment guide
├── GAPS.md                          # Documented edge cases and gaps
└── package.json                     # Root package with dev scripts
```

---

## Prerequisites

- **Node.js** v18+
- **MongoDB** v6+ (running locally or via MongoDB Atlas)
- **Anthropic API Key** — Required for AI scoring ([console.anthropic.com](https://console.anthropic.com))
- **Google Cloud Project** (optional) — Required only for automatic Google Meet transcript fetching
  - Google Meet REST API enabled
  - OAuth 2.0 credentials (Client ID, Client Secret, Refresh Token)
  - Paid Google Workspace account (Business Standard or higher)
- **Slack Webhook URL** (optional) — For team notifications

---

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd interview-scorecard-system

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

---

## Environment Variables

Copy `.env.example` to `.env` in the project root and fill in your values:

```env
# Server
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/interview-scorecard
JWT_SECRET=your_long_random_secret_string

# Anthropic Claude API
ANTHROPIC_API_KEY=sk-ant-your-key-here
CLAUDE_MODEL_DEFAULT=claude-sonnet-4-20250514
CLAUDE_MODEL_CHEAP=claude-haiku-4-5-20251001
CLAUDE_MODEL_DEEP=claude-opus-4-20250514

# Google Meet (Optional — leave blank for manual transcript upload)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/api/interviews/google/callback
GOOGLE_REFRESH_TOKEN=your_google_refresh_token
ACTIVE_TRANSCRIPT_PROVIDER=google_meet

# Slack (Optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/your/webhook/url

# Frontend URL
CLIENT_URL=http://localhost:5173

# Scoring Defaults
DEFAULT_HIRE_THRESHOLD=3.5
DEFAULT_MAYBE_THRESHOLD=3.0
TRANSCRIPT_RETENTION_DAYS=90
MONTHLY_AI_SPEND_CAP_USD=200
AI_SPEND_WARN_PERCENT=80

# Seed Admin User
SEED_ADMIN_NAME=Admin
SEED_ADMIN_EMAIL=admin@yourcompany.com
SEED_ADMIN_PASSWORD=change_this_password
```

---

## Running the Application

```bash
# From the project root:

# Start the backend server (with auto-reload)
cd server
npx nodemon

# In a separate terminal, start the frontend
cd client
npm run dev
```

- **Backend**: http://localhost:5000
- **Frontend**: http://localhost:5173
- **Health Check**: http://localhost:5000/api/health

---

## Seeding the Database

Run the seed script once to create the default admin user, pipeline template, and app settings:

```bash
cd server
node seeds/seedDefaults.js
```

This creates:
- **Admin user** with the email/password from your `.env`
- **Default pipeline template**: HR Screen (10%) → Simulation (35%) → Technical (35%) → Final/CEO (20%)
- **Default settings**: Thresholds, retention days, spend cap, cost rate table

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Server health check |
| POST | `/api/auth/login` | Authenticate and receive JWT |
| GET | `/api/auth/me` | Get current user profile |
| GET/POST | `/api/requisitions` | List/create job openings |
| GET/PATCH/DELETE | `/api/requisitions/:id` | Get/update/delete a requisition |
| POST | `/api/requisitions/:id/generate-scorecard` | AI-generate interview questions |
| POST | `/api/requisitions/:id/clone-scorecard` | Clone scorecard from another job |
| PATCH | `/api/requisitions/:id/scorecard` | Manually edit scorecard |
| GET | `/api/requisitions/:id/ranking` | Get candidate rankings |
| GET/POST | `/api/candidates` | List/create candidates |
| POST | `/api/candidates/:id/apply` | Attach candidate to a requisition |
| GET/POST | `/api/interviews` | List/create interview instances |
| POST | `/api/interviews/:id/meeting` | Create/set meeting link |
| POST | `/api/interviews/:id/consent` | Record candidate consent |
| POST | `/api/interviews/:id/fetch-transcript` | Fetch transcript from provider |
| POST | `/api/interviews/:id/upload-transcript` | Manual transcript upload |
| POST | `/api/interviews/:id/upload-artifact` | Upload artifact (resume, task) |
| POST | `/api/interviews/:id/score` | Run AI scoring |
| POST | `/api/scoring/interview/:id/approve` | Approve AI scores |
| POST | `/api/scoring/interview/:id/override` | Override a score (audited) |
| POST | `/api/scoring/application/:id/recompute` | Recompute weighted total |
| POST | `/api/scoring/application/:id/decision` | Record final hire/reject |
| GET/POST | `/api/pipelines` | List/create pipeline templates |
| GET/PATCH/DELETE | `/api/pipelines/:id` | Get/update/delete a template |
| GET/PUT | `/api/settings` | Read/write app configuration |
| GET | `/api/settings/ai-usage` | AI spend tracking |
| GET | `/api/audit` | Query audit log |

---

## Architecture

```
Browser (React + Vite)
    ↓ HTTP / JWT
Express.js API Server
    ├── Middleware (Auth → CORS → Helmet → Morgan → Error Handler)
    ├── Routes → Controllers → Services
    │       ├── claudeClient.js ←→ Anthropic API
    │       ├── googleMeet.js ←→ Google Meet REST API
    │       ├── scoringEngine.js (pure math, no external calls)
    │       ├── retentionService.js (background cron)
    │       └── slackNotifier.js ←→ Slack Webhook
    └── Mongoose Models → MongoDB
```

---

## AI Models & Cost Management

The system uses three tiers of Claude models, matched to stage complexity:

| Tier | Model | Used For | Cost (per 1M tokens) |
|---|---|---|---|
| Cheap | Claude Haiku | Resume screen, reference check, background check | $0.80 input / $4.00 output |
| Default | Claude Sonnet | HR screen, final, client, culture interviews | $3.00 input / $15.00 output |
| Deep | Claude Opus | Technical, simulation, task performance | $15.00 input / $75.00 output |

**Spend Cap**: Every Claude API call checks the monthly spend against `MONTHLY_AI_SPEND_CAP_USD` (default: $200). When 80% is reached, a Slack warning is sent. At 100%, all AI calls are blocked until the next month.

---

## Scoring Engine Rules

1. **Stage Average** = mean of all approved attribute scores for that stage.
2. **Stage Gate** = stage average must be ≥ the stage's `passThreshold` to pass.
3. **Weighted Total** = Σ (stageAverage × stageWeight) across all enabled stages.
4. **All Gates Passed** = every single enabled stage must pass its gate.
5. **Disposition**:
   - `HIRE` = allGatesPassed AND weightedTotal ≥ hireThreshold
   - `MAYBE` = allGatesPassed AND weightedTotal ≥ maybeThreshold
   - `NO_HIRE` = any gate failed OR weightedTotal < maybeThreshold
6. **Rank** = candidates sorted by weightedTotal (descending) within a requisition.

**Critical Rule**: A candidate with a 4.9/5 weighted total who failed even one stage gate will receive **NO_HIRE**. Gates are absolute.

---

## Transcript Providers

| Provider | Status | How It Works |
|---|---|---|
| `google_meet` | ✅ Phase 1 | Auto-fetches from Google Meet REST API (requires paid Workspace) |
| `manual` | ✅ Phase 1 | HR uploads a `.txt` file via the UI |
| `zoom` | 🔲 Phase 2 | Stub — throws "not enabled" |
| `fathom` | 🔲 Phase 2 | Stub — throws "not enabled" |

---

## Security

- **JWT Authentication** on all routes except `/api/health` and `/api/auth/login`.
- **Role-Based Access Control** (admin, hiring_manager, recruiter, interviewer).
- **API keys stored in MongoDB** at runtime, never exposed to the frontend (masked to last 4 characters).
- **Helmet.js** for HTTP security headers.
- **CORS** restricted to the frontend origin only.
- **Immutable Audit Log** — every score override, weight change, and decision is permanently recorded.
- **HTTPS required** in production (AWS deployment) to encrypt API key transmission.

---

## Known Gaps & Future Improvements

See [GAPS.md](./GAPS.md) for documented edge cases and unaddressed issues, including:

1. **Language Barrier** — No AI prompt guidance for Urdu/Minglish transcripts.
2. **Free Account Automation** — No zero-touch transcript fetching without paid Google Workspace.
3. **Transcription Button** — Google Meet requires manual activation of transcription per meeting.
4. **Calendar Scheduling** — Google Calendar API integration for scheduled interviews (potential Phase 2).
5. **Unit Tests** — No test framework (Jest) is included in the current dependencies.

---

## License

Internal use only — Red Star Technologies © 2026
