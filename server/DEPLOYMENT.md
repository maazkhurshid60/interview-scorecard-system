# Going live: PostgreSQL and Redis

How to move the live site from MongoDB to PostgreSQL, and how to set up the Redis the background queues need. Read it through once
before the day; the steps are in order.

Where things are described in more detail: `prisma/README.md` (the Postgres design and the data copy), `repositories/README.md` (the
repository layer and the tests), `../.env.production.example` (every environment variable).

## 1. What this release changes on live

Two things change at once, and the second one is easy to miss:

1. **The database moves from MongoDB to PostgreSQL.** MongoDB is not changed or deleted: the data is copied, and a switch
   (`DB_PROVIDER`) decides which database the app uses.
2. **Redis becomes required.** The background queues (every email, and the AI screening of public applications) run on BullMQ,
   which keeps its jobs in Redis. This is already on `staging` but **not on `main`**: live still sends email through the old
   `emailjobs` collection in MongoDB. **With no Redis, the new code sends no email at all** (the page answers "not queued") and public
   applications are saved but not screened until Redis is back.

Because of that, the safest way is two releases, a few days apart:

- **Release 1: the new code and Redis, still on MongoDB** (`DB_PROVIDER=mongo`). This proves the Redis queues on live.
- **Release 2: the switch to PostgreSQL** (sections 4 and 5).

Doing both in one go also works; the steps are the same, only the risk is bigger.

## 2. Before you start

- **Node 20** on the server (`engines` in `package.json` says `20.x`); test on Node 20, not a newer one.
- **PostgreSQL 13 or newer.** (The public-link token default uses `gen_random_uuid()`, which is built in from version 13.)
- **A current Redis** (6.2 or newer is what BullMQ, the queue library, recommends), set up as in section 3.
- A **recent backup** of MongoDB, and a place for PostgreSQL backups (section 4).
- A **dry run** done first: the same steps on staging, with a copy of the live data (section 6).
- A quiet time of day, and people told that the site will be briefly unavailable.
- The server needs the **Prisma tools** to build the tables. `prisma` is a *devDependency* of the server, so use a full install
  (`npm ci`, not `npm ci --omit=dev`) for the migration step, or move `prisma` to the normal dependencies.
- The **Prisma client must be generated** (`prisma generate`) before the server starts. Nothing does it automatically: add it to
  the deploy.

## 3. Redis setup

### What uses it

| Queue | Name | What it does |
|---|---|---|
| Emails | `emails` | Sends every email in the background with retries (5 tries: after 30 s, 2 min, 10 min, 30 min). Sent jobs are kept 30 days, failed ones 90 days. |
| Application screening | `application-screening` | Finishes the AI screening of a public application. A job is removed when it completes. |

Both run inside the normal API process (`index.js` starts the workers), so there is nothing extra to run. All keys sit under one
prefix (`BULLMQ_PREFIX`, default `ownerstalent`), for example `ownerstalent:emails:wait`.

### Install and configure (a Redis on the same server)

```
sudo apt install redis-server
sudo nano /etc/redis/redis.conf
```

Set these lines, then `sudo systemctl restart redis-server`:

```
bind 127.0.0.1 -::1             # only this machine can connect
requirepass CHANGE_ME_LONG_RANDOM_PASSWORD
appendonly yes                  # keep the jobs on disk
appendfsync everysec
maxmemory-policy noeviction     # never throw a waiting job away to save memory
supervised systemd
```

- `appendonly yes` and `maxmemory-policy noeviction` are **required**: with them off, a Redis restart (or a full memory) loses
  emails that were still waiting to be sent.
- Redis memory needs here are small (tens of megabytes). Do not open port 6379 to the internet.
- A **hosted Redis** (a managed service) works as well: use its address as `REDIS_URL`, make sure it keeps its data and does not
  evict keys, and note that one that requires a secure connection gives an address starting with `rediss://` (two s).

### Environment variables

```
REDIS_URL=redis://:CHANGE_ME_LONG_RANDOM_PASSWORD@127.0.0.1:6379
BULLMQ_PREFIX=ownerstalent
```

URL-encode special characters in the password. Use a different `BULLMQ_PREFIX` if two apps (for example staging and live) ever share
one Redis; they must never share the same prefix.

### Check it

```
redis-cli -u "$REDIS_URL" ping                       # PONG
redis-cli -u "$REDIS_URL" config get appendonly      # yes
redis-cli -u "$REDIS_URL" config get maxmemory-policy # noeviction
```

After the server starts, its log must show no `[Redis]` warnings. To confirm that the queues are **empty** (needed before the
switch, section 5), every one of these must print `0` (replace the prefix if you changed it):

```
for q in emails application-screening; do
  redis-cli -u "$REDIS_URL" llen ownerstalent:$q:wait
  redis-cli -u "$REDIS_URL" llen ownerstalent:$q:active
  redis-cli -u "$REDIS_URL" zcard ownerstalent:$q:delayed
done
```

### What the app does when Redis is down

- **Emails:** the page that asked for one answers that it was not queued (it does not hang: the connection fails in about 3
  seconds), and nothing is sent. Waiting emails already in Redis are sent when it is back.
- **Public applications:** the application is saved and stays "pending"; the check that runs every minute queues it once Redis
  returns.
- The workers reconnect by themselves; nothing needs restarting.

## 4. PostgreSQL setup

### Create the database and a user

In `psql` as an administrator (change the names and the password):

```
CREATE USER ownerstalent WITH PASSWORD 'CHANGE_ME_LONG_RANDOM_PASSWORD';
CREATE DATABASE ownerstalent OWNER ownerstalent;
```

The user must own the database (the migration creates tables, enums and an index). It needs no superuser rights and no extensions.

### Environment variables

```
DATABASE_URL=postgresql://ownerstalent:CHANGE_ME_PASSWORD@localhost:5432/ownerstalent
DB_PROVIDER=mongo          # change to postgres only at the switch (section 5)
```

- URL-encode special characters in the password.
- A hosted PostgreSQL that requires TLS needs `?sslmode=require` at the end of `DATABASE_URL`.
- Keep `DB_PROVIDER=mongo` until the switch: with it set to `mongo` the app never connects to PostgreSQL.
- If the server is small, you can limit the connections the app opens with `?connection_limit=10` at the end of `DATABASE_URL`.

### Backups

Set up a daily dump before the switch, and test that it restores:

```
pg_dump -Fc -U ownerstalent ownerstalent > ownerstalent-$(date +%F).dump
```

Keep several days, off the server. A managed PostgreSQL usually has this built in (check its retention).

## 5. The release steps

### A. Before the day (nothing changes for users)

1. Set up PostgreSQL (section 4) and Redis (section 3). Add `DATABASE_URL`, `REDIS_URL`, `BULLMQ_PREFIX` to the production environment,
   with `DB_PROVIDER=mongo`.
2. Deploy the new code (Release 1), with `DB_PROVIDER=mongo`. In `server/`:
   ```
   npm ci
   npm run prisma -- generate      # build the Prisma client (or: npx prisma generate, with DATABASE_URL exported)
   ```
   Restart the backend the way you normally do (PM2 or systemd). Check:
   - the log shows no `[Redis]` warnings and no Postgres connection at all (that is correct while `DB_PROVIDER=mongo`);
   - send one real test email from the site (for example a password reset for your own account) and see it arrive;
   - `GET /api/health` answers `{"status":"ok"}`.
3. Build the empty tables:
   ```
   npm run prisma -- migrate deploy
   ```
   It must end with "All migrations have been successfully applied." (`npm run prisma` reads the repository-root `.env`; if the
   settings come from PM2 or systemd instead, export `DATABASE_URL` and run `npx prisma migrate deploy`.) Run this only against a
   **new, empty** database.
4. Check in MongoDB that no old-style email is still waiting (the old queue is not copied):
   ```
   db.emailjobs.countDocuments({ status: { $nin: ['sent', 'failed'] } })   // must be 0
   ```
   (`failed` ones are history: they have used up their attempts.) After Release 1 nothing new is written there.

### B. The switch (a quiet window; about 30 minutes, of which the copy itself is seconds: about 1,300 records took 5 seconds)

1. **Stop the backend** so nobody writes to MongoDB during the copy (`pm2 stop ...` or `sudo systemctl stop ...`), or show a
   maintenance page in Nginx.
2. **Check the queues are empty** (section 3). If an email is still waiting, start the backend, wait, stop it, and check again.
3. **Copy the data** (from `server/`). It reads MongoDB (read only) and writes PostgreSQL; it never changes MongoDB:
   ```
   npm run migrate:postgres
   ```
   - The first line must name the live MongoDB and the live PostgreSQL.
   - Do **not** use `--reset` (it is refused on a non-local database anyway). The tables must be empty; if the copy says a table
     already has rows, stop and find out why.
   - Read the end of the output. `0 skipped` is the normal result. A "SKIPPED ROWS" list or a note such as "1 NUL character removed" is
     reported in `server/logs/migration-report.json`: read it, and decide whether it is acceptable. (PostgreSQL cannot store the
     invisible NUL character, so the copy takes it out and says so.)
   - Exit code 2 only means some records were skipped.
4. **Check the copy:**
   ```
   npm run verify:postgres
   ```
   The last line **must** say `PASS: every record, every field and every link in Postgres is identical to MongoDB.` If it
   says anything else, do not continue: set nothing, start the backend as it was, and send the output to the developers.
5. **Switch:** set `DB_PROVIDER=postgres` in the production environment and **start the backend**.
6. **Check right away:**
   - the log says `Connected to PostgreSQL` (and does not mention connecting to MongoDB);
   - sign in with a real account (the old passwords work: the password hashes were copied);
   - open the job openings, a candidate, an interview and the audit log;
   - open a public apply link from before the move (an old link of the form `/apply/<24 characters>`): it must show the job;
   - open a new "Copy apply link" link (it carries a long token) and an old availability link;
   - send one real test email.

### C. After the switch

- **Watch the log for a few days.** Expected, harmless lines right after the switch: `Authentication failed` (sessions from before
  the move are renewed through their refresh token, so people stay signed in) and `[PublicLink] ... old shared link` (each use of an
  old link). Anything about `Prisma`, `Cast to UUID` or `operator does not exist` is a problem: send it to the developers.
- **Keep MongoDB running and untouched** for a while: it is the way back.
- Redis: the queues should stay near empty; `failed` jobs deserve a look.
- Keep MongoDB's backups going until PostgreSQL's backups are running and have been tested with a restore.

### D. Going back

Set `DB_PROVIDER=mongo` and restart. MongoDB still has everything it had at the switch. **Records created on PostgreSQL after the
switch are not in MongoDB** and their ids are different, so go back only soon after the switch, or accept losing what was entered since.
Redis is not affected.

## 6. The dry run (do this first, on staging)

Run sections 3 to 5 on staging with a copy of the live data, as a rehearsal:

- Take the copy into staging's PostgreSQL by setting `MONGODB_URI` to the live (or a restored) MongoDB for the copy only and
  `DATABASE_URL` to staging's PostgreSQL. Reading live is safe: the copy and the check only read.
- Then click through the whole app, with a test candidate that has your own email. Test the parts only a real environment can: AI
  scoring, real emails and Slack messages, file uploads (S3 in production, Cloudinary elsewhere) and the captcha.
- Write down how long each step took.

Staging and live must use different `BULLMQ_PREFIX` values if they share a Redis (better: separate Redis servers).

## 7. What is and is not moved

| | |
|---|---|
| Copied to PostgreSQL | users, departments, hiring templates, settings, candidates, job openings, scorecards, applications, interviews, login tokens, audit log |
| Ids | every record gets a new UUID (the same one every time for the same old id); links between records are rewritten to match |
| Old shared links | still work: each job opening and interview keeps its old id in `legacyId`; new links use a random `publicToken` |
| Not copied | the `emailjobs` collection (the old email queue: sent history, 1 failed email; nothing in the app reads it), and anything in Redis |
| Not touched | uploaded files (S3 / Cloudinary), MongoDB itself |
| Changed on purpose | one invisible NUL character removed from one interview transcript on the data tested so far (if more turn up, the report lists them) |

## 8. If something goes wrong

| What you see | What it means |
|---|---|
| `type "UserRole" already exists` on `migrate deploy` | the database was not empty (or the migration ran before). Use a new, empty database. |
| The copy says a table already has rows | same: the copy only fills empty tables. Do not use `--reset` on live. |
| `Cast to UUID failed` / HTTP 400 on a page | something is calling the API with an id that is not a UUID (for example an old bookmark of a screen with an old id). Signed-in screens need the new ids; only the two public links accept old ones. |
| No emails arrive, the page says "not queued" | Redis is unreachable or `REDIS_URL` is not set. Check `redis-cli ping` and the environment. |
| A public application stays "pending" | Redis was down when it came in; it is picked up within a minute of Redis returning. |
| `P1001` / "Can't reach database server" | `DATABASE_URL` is wrong, PostgreSQL is not running, or a firewall is in the way. |
| The verifier says `DIFFERENCES` | do not switch. Send the output to the developers. |

## 9. Later

- When the log shows no more `[PublicLink] ... old shared link` lines for a good while (two to three months), the `legacyId` column
  and its fallback can be removed (one migration and a small code change).
- When PostgreSQL has been stable for a while and its backups are tested, MongoDB can be retired. The `emailjobs` history can be
  exported first if it is wanted.
