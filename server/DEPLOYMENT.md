# Going live: PostgreSQL and Redis

What changes on the live site when it moves from MongoDB to PostgreSQL, what Redis is needed for, and what to keep in mind. It
describes the setup and the points that matter; how and when to do the work is up to whoever deploys.

More detail: `prisma/README.md` (the Postgres design and the data copy), `repositories/README.md` (the repository layer and the
tests), `../.env.production.example` (every environment variable).

## 1. What this release changes on live

Two things change, and the second one is easy to miss:

1. **The database moves from MongoDB to PostgreSQL.** MongoDB is not changed or deleted: the data is copied, and one setting
   (`DB_PROVIDER`) decides which database the app uses. Setting it back to `mongo` returns to MongoDB.
2. **Redis becomes required.** The background queues (every email, and the AI screening of public applications) run on BullMQ,
   which keeps its jobs in Redis. This is already on `staging` but **not on `main`**: live still sends email through the old
   `emailjobs` collection in MongoDB. **With no Redis, the new code sends no email at all** (the page says the email was not queued) and
   public applications are saved but not screened until Redis is back.

The two moves can be released together or apart. Releasing the new code and Redis first, still on MongoDB (`DB_PROVIDER=mongo`),
and switching to PostgreSQL later keeps each change small and easy to check.

## 2. Requirements

- **Node 20** (`engines` in `package.json` says `20.x`).
- **PostgreSQL 13 or newer.** The token default used for public links (`gen_random_uuid()`) is built in from version 13. The database
  user must own the database (the first migration creates tables, enums and an index); no superuser rights or extensions are needed.
- **Redis**, a current version (6.2 or newer is what the queue library recommends), which must:
  - **keep its data** (persistence on), and
  - **not evict keys** when memory is full (`maxmemory-policy noeviction`).

  Without both, a Redis restart or a full memory loses emails that were still waiting to be sent. Memory needs are small (tens of
  megabytes). It should not be reachable from the internet, and should have a password. A hosted Redis that requires a secure
  connection gives an address starting with `rediss://` (two s).
- **Prisma** has two build-time needs: the `prisma` package is a *development* dependency of the server, so the step that builds the
  database tables needs it installed, and the generated Prisma client must exist before the server starts (nothing generates it
  automatically).

## 3. Environment variables

| Variable | Meaning |
|---|---|
| `DB_PROVIDER` | `mongo` (the default) or `postgres`. With `mongo` the app never connects to PostgreSQL. |
| `DATABASE_URL` | The PostgreSQL address, `postgresql://USER:PASSWORD@HOST:5432/DATABASE`. URL-encode special characters in the password. A hosted PostgreSQL that requires TLS needs `?sslmode=require`; `?connection_limit=10` limits how many connections the app opens. |
| `MONGODB_URI` | The MongoDB address (still used by the app in `mongo` mode, and read by the data copy). |
| `REDIS_URL` | The Redis address, `redis://:PASSWORD@HOST:6379` (or `rediss://...`). |
| `BULLMQ_PREFIX` | The prefix of every queue key in Redis (default `ownerstalent`). Two apps that share one Redis, for example staging and live, must use different prefixes. |

## 4. How the queues work

| Queue | Name | What it does |
|---|---|---|
| Emails | `emails` | Sends every email in the background, with 5 tries (after 30 s, 2 min, 10 min and 30 min). Sent jobs are kept 30 days, failed ones 90 days. |
| Application screening | `application-screening` | Finishes the AI screening of a public application. A job is removed when it completes. |

Both are run by the normal API process, so there is nothing extra to start. Keys look like `ownerstalent:emails:wait`.

**When Redis is down**
- The page that asked for an email answers that it was not queued (the connection gives up after about 3 seconds, the page does not
  hang), and nothing is sent. Emails already waiting in Redis are sent once it is back.
- A public application is saved and stays "pending"; a check that runs every minute queues it once Redis returns.
- The workers reconnect by themselves.

## 5. What is and is not moved

| | |
|---|---|
| Copied to PostgreSQL | users, departments, hiring templates, settings, candidates, job openings, scorecards, applications, interviews, login tokens, the audit log |
| Ids | every record gets a new UUID (always the same one for the same old id); every link between records is rewritten to match |
| Old shared links | still work: each job opening and interview keeps its old id in `legacyId`, and new links use a random `publicToken` |
| Not copied | the `emailjobs` collection (the old email queue; nothing in the app reads it) and anything in Redis |
| Not touched | uploaded files (S3 in production, Cloudinary elsewhere) and MongoDB itself |
| Changed on purpose | PostgreSQL cannot store the invisible NUL character, so the copy removes it and reports it; one such character was found in one interview transcript on the data tested so far |

The data copy only reads MongoDB and only fills empty PostgreSQL tables. A copy of about 1,300 records took about 5 seconds, and its
check (a verifier that compares every record, field and link) must report `PASS`; the copy also writes a report of anything it
skipped or changed (`server/logs/migration-report.json`).

## 6. Things to keep in mind

- **Writes during the copy are not carried over.** Whatever is entered in MongoDB after the copy is not in PostgreSQL, so the site
  should not be written to between the copy and the switch.
- **The old email queue.** Before the switch, no old-style email should still be waiting in `emailjobs`. At the last check the
  collection held 210 sent emails and 1 failed one (it had used up its attempts), nothing waiting. Redis should also have no waiting
  jobs from an earlier release, because they hold ids that no longer exist after the move.
- **Signed-in users stay signed in.** A session from before the switch is renewed through its refresh token, which was copied with its
  user. The log shows some "Authentication failed" lines at first; they are harmless.
- **Old links.** Old apply and availability links keep working through `legacyId`. A record's own id is not accepted in a public
  link; only a token or an old id is. Each use of an old link is logged (`[PublicLink] ... old shared link`).
- **Rolling back** means setting `DB_PROVIDER` back to `mongo`. MongoDB still has everything it had at the switch, but records created
  on PostgreSQL after the switch are not in it and their ids differ, so going back is clean only soon after the switch.
- **Backups.** PostgreSQL needs its own backups (and a tested restore) before MongoDB's are dropped.
- **Test before live.** A rehearsal on staging with a copy of the live data is worth doing, including the parts that need the real
  outside services: AI scoring, real email and Slack messages, file uploads and the captcha.

## 7. What to watch afterwards

- No `[Redis]` warnings; the queues stay close to empty, and `failed` jobs get a look.
- The log says it connected to PostgreSQL. Lines about `Prisma`, `Cast to UUID` or `operator does not exist` mean a problem.
- A "Cast to UUID" (HTTP 400) on a signed-in screen means something calls the API with an old-style id, for example an old bookmark.
- No emails arriving while the page says "not queued" means Redis is unreachable or `REDIS_URL` is not set.

## 8. Later

- When the log has shown no `[PublicLink] ... old shared link` lines for a good while (two to three months), the `legacyId` column and
  its fallback can be removed (one migration and a small code change).
- When PostgreSQL has been stable for a while and its backups are tested, MongoDB can be retired. The `emailjobs` history can be
  exported first if it is wanted.
