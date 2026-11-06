# Postgres + Prisma

`schema.prisma` is the PostgreSQL design for the 11 models in `server/models/`. The app uses it when `DB_PROVIDER=postgres`
is set in `.env`; MongoDB stays the default until production is switched. Changes to the schema go through
`npm run prisma -- migrate dev` (a new folder in `migrations/`), never by editing an applied migration. After any change to
`schema.prisma`, run `npm run prisma -- generate`: the Prisma client is generated code and keeps the old shape until you do
(a deployment must run it too, before the server starts).

## Why the move is mostly in one place

All queries live in `server/repositories/`. The Prisma version is a rewrite of those files with the **same function
names**, so controllers and services change very little. `npm run check:architecture` keeps it that way.

## Is the schema an exact match for MongoDB?

When the schema was first written it was compared with the Mongoose models by an automatic script (every field's type,
required flag, default, enum list and index): 347 checks, no mismatch, and 14 deliberate mistakes in copies of the schema were
all caught. That script is not kept in the repository, and it predates the UUID ids, so ids, `legacyId`, `publicToken` and
`nullFields` differ from the models by design. What keeps the two sides in step now is run on every change:

- `npm run verify:postgres` compares every field of every record between MongoDB and Postgres after a copy;
- `npm run parity` runs each repository's scenarios on both databases and compares results, errors and data left behind.

## Decisions

- **Ids are UUIDs** (`String @id @default(uuid(7)) @db.Uuid`), on all 11 tables. Every column that holds the id of another record is
  a UUID too. They are version 7 UUIDs: the first 48 bits are the creation time in milliseconds, then a 12-bit counter, then
  random bits, so ids sort in creation order (`ORDER BY id` means "oldest first", as it did with MongoDB's ObjectIds, and the
  repositories rely on that for ties). The app makes them (`newId` in `repositories/postgres/helpers.js`: strictly increasing
  inside one server process, even within one millisecond or when the clock steps back) and passes the id in with every insert,
  because most inserts are raw SQL, which bypasses a Prisma client-side default. `uuid(7)` in the schema is the same kind of id
  and only matters for an insert through Prisma's own `create` that gives none; the database has no default, so an insert that
  forgets the id fails loudly instead of writing a different kind of id. The repositories hand ids to the rest of the app as lower-case
  text, as ids have always been text to the controllers, the services and the client; an id read from a URL is accepted in any
  letter case. A UUID is 16 bytes (the column type is `uuid`).
- **Old links keep working.** Job openings and interviews have two extra columns, because they are the only records with public
  links (`/apply/<job opening>` and `/interview/<interview>/availability`):
  - `legacyId` holds the old MongoDB id (24 characters), filled in by the data copy, so links shared before the move still find
    their record;
  - `publicToken` is a random UUID made by the database (`(gen_random_uuid())::text`, Postgres 13 or newer), used in every new
    public link. A record's own id is not used there: a version 7 UUID shows when the record was made, and the token is made to
    be shared.
  A public link is accepted as a token or as an old id, never as a record's own id (`parsePublicRef`, `isValidPublicRef`,
  `findByPublicRef`). Each use of an old id is logged (`[PublicLink] ... old shared link`), so the log shows when none are used
  any more and `legacyId` can be removed (one migration, and the fallback in `findDocByPublicRef`).
- **Ids inside JSON lists are not table ids.** An item of a list kept as JSON (a stage progress entry) has its own 24-character
  `_id` (`newSubdocId`); a user id kept inside JSON (`overriddenBy` in a score) is a UUID like any other link.
- **Why UUIDs, and why version 7?** Ids that cannot be guessed and do not depend on a counter. Version 4 (random) ids would not
  sort in creation order, and 30 queries order by id to mean "oldest first"; version 7 keeps that. The data copy must give every
  record a new id and rewrite every link (see below), and switching back to MongoDB after new records exist would not be clean.
- **The first migration.** `..._init` holds the final tables, the CHECK constraints and the case-insensitive department-name
  index, because nothing was deployed before the ids were changed. Later changes are new folders next to it.
- **Field names stay as they are** (camelCase). The API keeps returning `_id`.
- **Every MongoDB `Number` is a `Float`** (double precision), the lossless choice: it holds anything a Mongoose Number
  could, so the migration cannot fail on a decimal. Fields that are always whole numbers can be tightened later.
- **Every Mongoose `enum` is a Postgres enum** with exactly the same values (including the legacy job status `on_hold`).
  A value outside the list now fails in the database too, as it did in Mongoose. If production data contains a value
  that is not in a list, the migration will report it instead of copying it silently.
- **Tables for the 11 models; JSON for embedded structures** that are never searched inside: stages, questionnaires,
  screening criteria, scores, stage progress, settings values, audit old/new values.
- **Real columns for anything searched, sorted or updated atomically:** `disposition`, `rank`, `weightedTotal`,
  `finalDecision`, the background-screening fields (`screening*`), and the AI token counts and cost. The repositories
  present them again as the same nested objects the app uses today (`screeningJob`, `aiTokensUsed`).
- **Foreign keys only where the app guarantees the link** (Application to Candidate and Requisition, Interview to
  Application and Requisition, Scorecard to Requisition, RefreshToken to User, Requisition to Department as "set null").
  Audit entries, "created by" fields and the template and scorecard pointers on a job have none, because MongoDB let
  them outlive or point at things that no longer exist.
- **Indexes are exactly MongoDB's**, plus the unique ones on `legacyId` and `publicToken`. Extra ones that would help in Postgres
  are listed under "Later", so they are a deliberate step and not a silent difference.

## What Postgres does not do by itself (to be ported into the repositories or SQL)

1. **`trim`** on `Department.name`, `Department.description` and `Requisition.title`: Mongoose removed surrounding
   spaces on save. The Prisma repositories do the same.
2. **Rules inside JSON columns.** MongoDB validated every item of the embedded arrays; a JSON column accepts anything,
   so the repositories check these before saving: stages need `key`, `label`, a valid `stageType` and `inputType` (and
   defaults for `enabled`, `weight`, `passThreshold` 1 to 5); questionnaire items need a `question`; screening criteria need
   `criteria`; scorecard stages need `stageKey` and each attribute an `attributeId` and `name`; interview scores need an
   `attributeId`; stage progress status must be one of seven values.
3. **Defaults inside embedded objects** (for example `interviewAvailability` time defaults, `internshipDetails.paidStatus`)
   and the **read-time defaults** Mongoose added when loading: an application always had
   `initialScreening.overridden = false` and `screeningJob.attempts = 0`, even when nothing was stored.
4. **Number ranges, minimum length and the phone format** are CHECK constraints (added `NOT VALID`, so old rows cannot break
   the migration; validate them after). `extra-constraints.sql` documents them; they are part of the first migration.
5. **Hidden fields:** `User.passwordResetTokenHash` and `passwordResetExpiresAt` were hidden from queries by default.
   The repository does not select them unless asked.
6. **Expired refresh tokens** were deleted by a MongoDB TTL index. `refreshTokenRepository.removeExpired()` deletes rows past
   `expiresAt`; `services/retentionService.js` runs it at start-up and every 24 hours.
7. **Department names** also had a case-insensitive index; the first migration adds `lower(name)`.

## What the data copy does with the ids and links

`migrate.js` copies MongoDB into Postgres and never writes to MongoDB.

1. **New ids.** Every record gets the UUID its old MongoDB id maps to (`migrate/uuid.js`). The mapping is worked out from the old id
   alone, so copying the same data again gives the very same ids, and the verifier can check each one on its own. An ObjectId is
   12 bytes: 4 of time (seconds), then 8. The UUID is a version 7 one: the time (as milliseconds), the version, the first 12 bits
   of the 8 bytes, the variant, the next 52 bits, and 8 zero bits. Old ids sort among themselves as before, and every old id sorts
   before any id the app makes after the copy. An old id that is not a 24-character ObjectId cannot be mapped, and that record is
   skipped and reported.
2. **Links.** Every link between records is rewritten to the UUID of the record it pointed at, including ids kept inside JSON (a
   score's `overriddenBy`, a screening override). Parents are copied before children.
3. **Orphans.** A record whose required parent (an application's candidate) was skipped or does not exist is skipped and listed
   in `logs/migration-report.json`. A job opening's department that does not exist is emptied and reported.
4. **Dangling links with no foreign key** (an audit entry about a deleted user, a "created by" that was deleted) have no record to
   point at, so the link is emptied and counted in the report ("pointed at a user that does not exist; set to empty").
5. **Free-form JSON** (settings values, audit old/new values) cannot be rewritten safely; any record id found there is left
   as text and counted in the report ("not translated").
6. **`legacyId` and `publicToken`.** Job openings and interviews get their old id in `legacyId` and a random `publicToken`.
7. **Rows missing a value that now has a default or is required** (old documents): the same default Mongoose applied on load
   is applied, and anything required that is missing is reported and skipped.
8. **Dates, numbers and nested objects:** `screeningJob` and `aiTokensUsed` are split into columns; empty nested objects
   are dropped, as MongoDB did. All dates are stored as UTC.

## Copying the data, and proving the copy is exact

```
npm run migrate:postgres -- --reset   # reads MongoDB (read only), writes Postgres; --reset empties the tables first (local only)
npm run verify:postgres               # compares every record, field and link between the two
npm run test:migrate                  # runs both on deliberately awkward data in scratch databases
```

- `migrate.js` fills in the defaults Mongoose filled in when loading, and **does not copy anything silently that cannot be
  copied**: such a row is skipped and listed with its reason in the report.
- `verify.js` does not reuse the migration's rules. It works out what every value should be from the Mongoose models, and every id
  from the 24 characters of the old id with its own code (the 128 bits built as one big number; `npm run test:ids` checks that
  the two agree), and reads Postgres back as exact text. Skipped rows must be absent; every other record must be present under
  its UUID and identical; every link must point at the record it pointed at (or be empty when that record was not copied);
  `legacyId` must be the old id; every `publicToken` must be different; every id must be a version 7 UUID.
- `test:migrate` (`migrate/awkward-test.js`) builds a scratch MongoDB and PostgreSQL with bad enum values, missing required
  values, numbers stored as text, text with NUL characters, links to records that do not exist or were skipped, and ids inside JSON,
  copies them (twice, to check the ids are the same both times), runs the verifier, and checks what happened to each record.
- The verifier was tested by breaking a copy 15 ways (a candidate swapped, a legacy id lost, an audit link emptied, a wrong user
  inside a score, a deleted and an extra record, a record under a different id, an id that is not a version 7 UUID, ...); every break was caught, except one
  (two interviews sharing a token) which the database itself refuses.
- To test against another MongoDB (for example a copy of production), set `MIGRATE_MONGO_URI`; `MIGRATE_REPORT_PATH` moves
  the report file.

## Known limitation: Prisma rounds numbers that need 17 digits

Found by the verification: **Prisma rounds any decimal number that needs 17 significant digits down to 16**, in a plain
number column (on write and on read) and inside JSON (on write): `0.16666666666666666` (1/6) is stored as
`0.1666666666666667`. Writing the same value as raw JSON text is exact. Numbers with 15 digits or fewer are never affected.

- **The data copy is exact:** `migrate.js` writes through `jsonb_populate_recordset` as JSON text, not through Prisma.
- **Today's app mostly stays clear of it:** weights are rounded to 1/10000ths, scores to 2 decimals. In the current local
  data only one value is affected (an old audit entry that snapshotted a weight of 1/6); production may hold more such
  values from older versions, which is why the copy must be exact.
- **How the repositories deal with it:** values the app computes without rounding (for example the AI cost, which adds up
  costs) can need 17 digits, so the Postgres repositories write through raw SQL as JSON text and read back with
  `to_jsonb(t)::text`, which keeps every digit. A value read back is what was written, so code that compares a stored
  value with a recomputed one sees no difference in the last digit.

## Later (not part of the exact match)

Indexes that would speed up Postgres but MongoDB did not have: `candidates.resumeFilePublicId`,
`interviews.artifactFilePublicId`, `interviews (applicationId, stageKey)` (unique, only after checking the data),
`requisitions (status, closedAt)`, `applications.screeningStatus`; and case-insensitive uniqueness for `Candidate.email`
and `Department.name` only after checking the real data for duplicates. Removing `legacyId` once the log shows no old link is
used any more.

## Setting up a database

1. Set `DATABASE_URL`; run `npm run prisma -- migrate deploy` (applies every folder in `migrations/` in order) and
   `npm run prisma -- generate`.
2. `npm run migrate:postgres`, then `npm run verify:postgres` (it must say PASS), to copy and check the data.
3. Set `DB_PROVIDER=postgres` and restart.

Things to know when switching a database that has been in use:

- **Wait for the background queues to be empty first** (screening and email jobs in Redis hold old application ids). Clear
  Redis keys such as `application-confirmation:<id>` if a Postgres database is ever reset while Redis is kept; a kept key makes
  the confirmation email for a new application with the same number look like a duplicate.
- **Signed-in sessions survive:** an access token issued before the switch names the old user id, so the server answers 401 and
  the client refreshes the session with its refresh token (which was copied with its user). The log shows some "Authentication
  failed" lines at first.
- **Rollback:** setting `DB_PROVIDER=mongo` goes back to MongoDB, which still has everything it had, but records created on
  Postgres after the switch are not in it, and the ids differ between the two.

## Tests

```
npm run check:architecture    only models, repositories, config/db.js and prisma touch the database
npm run check:repositories    both versions of every repository offer the same functions (-- --strict fails if they differ)
npm run parity                every repository's scenarios on both databases, compared (scratch databases)
npm run parity:real           reads your real data through both versions of every repository and compares (read only)
npm run smoke:postgres        starts the real server on Postgres with a copy of your data and makes real requests
npm run journey:postgres      a whole working day on the real server, on top of the copied data: checks what was copied, then new
                              jobs, candidates, applications, interviews, scores, decisions, links, settings and users, a restart,
                              deleting, and the database's own integrity (no record pointing at nothing, tokens, ids)
npm run test:ids              what counts as an id, and which values are public links
npm run test:migrate          the data copy and the verifier on awkward data
```

Every one of them works on scratch databases or only reads; the servers started by `smoke:postgres` and `journey:postgres` have
no Redis, mail, Slack, AI, file storage or captcha access, and the credentials stored in the copied settings are deleted from the
scratch database first. The tests that use MongoDB as a source or create a scratch database there (`parity`, `parity:real`,
`smoke:postgres`, `journey:postgres`, `test:migrate`) refuse to run unless `MONGODB_URI` is a local MongoDB, so a live database
can never be used by a test. Only `migrate:postgres` and `verify:postgres` may read a live MongoDB (read only: the verifier switches
off Mongoose's automatic index creation first).
