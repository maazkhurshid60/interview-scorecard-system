# Postgres + Prisma

`schema.prisma` is the PostgreSQL design for the 11 models in `server/models/`. The app uses it when `DB_PROVIDER=postgres`
is set in `.env`; MongoDB stays the default until production is switched. Changes to the schema go through
`npm run prisma -- migrate dev` (a new folder in `migrations/`), never by editing an applied migration.

## Why the move is mostly in one place

All queries live in `server/repositories/`. The Prisma version is a rewrite of those files with the **same function
names**, so controllers and services should not change. `npm run check:architecture` keeps it that way.

## Is the schema an exact match for MongoDB?

It is checked by an automatic comparison, not by eye. The Mongoose side is read out of the real model files (every
field's type, required flag, default, enum list and index); the Prisma side from Prisma's own parser. Every field must
have its counterpart with the same type, the same required/optional, the same default, the same enum values and the same
indexes, and Prisma may not have anything Mongoose does not. The comparison was itself tested by making 14 deliberate
mistakes in copies of the schema (wrong type, missing default, changed enum value, dropped or extra index, forgotten
field, ...); all 14 were caught. Last result: 347 checks, no mismatch.

## Decisions

- **Ids stay text.** Existing ObjectIds (24 hex characters) are copied unchanged, so links already emailed to candidates
  (the availability link contains an interview id) keep working. New rows get an id of the same shape, generated in the
  repository (`newId` in `repositories/postgres/helpers.js`: 4 bytes of time, 5 bytes unique to the server process, 3 bytes
  of counter, as MongoDB does, so ids sort by creation time and two servers cannot clash). The database does not generate
  ids. Auto-increment numbers were rejected: they would break those emailed links, need every link between records
  rewritten (the exact, verified copy would no longer apply), end the option of switching back to MongoDB, and make ids in
  URLs guessable. Moving to UUIDs (version 7 sorts by time like these) is possible later as its own planned migration, once
  MongoDB is retired.
- **Field names stay as they are** (camelCase). The API keeps returning `_id`; the Prisma repositories map `id` to `_id`
  until the React client is moved to `id`, as a separate step.
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
- **Indexes are exactly MongoDB's**, no more, no fewer. Extra ones that would help in Postgres are listed under
  "Later", so they are a deliberate step and not a silent difference.

## What Postgres does not do by itself (to be ported into the repositories or SQL)

1. **`trim`** on `Department.name`, `Department.description` and `Requisition.title`: Mongoose removed surrounding
   spaces on save. The Prisma repositories must do the same.
2. **Rules inside JSON columns.** MongoDB validated every item of the embedded arrays; a JSON column accepts anything,
   so the repositories must check these before saving (the comparison lists each one): stages need `key`, `label`, a
   valid `stageType` and `inputType` (and defaults for `enabled`, `weight`, `passThreshold` 1 to 5); questionnaire items
   need a `question`; screening criteria need `criteria`; scorecard stages need `stageKey` and each attribute an
   `attributeId` and `name`; interview scores need an `attributeId`; stage progress status must be one of seven values.
3. **Defaults inside embedded objects** (for example `interviewAvailability` time defaults, `internshipDetails.paidStatus`)
   and the **read-time defaults** Mongoose added when loading: an application always had
   `initialScreening.overridden = false` and `screeningJob.attempts = 0`, even when nothing was stored. The Prisma
   repositories must produce the same, or API answers change.
4. **Number ranges, minimum length and the phone format** are in `extra-constraints.sql` as CHECK constraints (added
   `NOT VALID`, so old rows cannot break the migration; validate them after).
5. **Hidden fields:** `User.passwordResetTokenHash` and `passwordResetExpiresAt` were hidden from queries by default.
   The repository must not select them unless asked.
6. **Expired refresh tokens** were deleted by a MongoDB TTL index. Add a small scheduled cleanup for rows past `expiresAt`.
7. **Department names** also had a case-insensitive index; `extra-constraints.sql` adds `lower(name)`.

## What the data migration has to handle

1. **Orphans.** MongoDB never enforced links, so production may hold, for example, an application whose candidate was
   deleted. The script must report these and decide: skip them, or keep them without the link.
2. **Dangling references with no foreign key** (audit entries about deleted users): copy as they are.
3. **Rows missing a value that now has a default or is required** (old documents): apply the same default Mongoose
   applied on load, and report anything required that is missing.
4. **Dates, numbers and nested objects:** `screeningJob` and `aiTokensUsed` are split into columns; empty nested objects
   are dropped, as MongoDB did. All dates are stored as UTC.
5. **Verification, record by record:** row counts per table, then every field of every record compared between MongoDB
   and Postgres, then the old-vs-new comparison scenarios rerun with the repositories on Prisma.

## Copying the data, and proving the copy is exact

```
npm run migrate:postgres -- --reset   # reads MongoDB (read only), writes Postgres; --reset empties the tables first (local only)
npm run verify:postgres               # compares every field of every record between the two
```

- `migrate.js` keeps ids, fills in the defaults Mongoose filled in when loading, and **does not copy anything silently
  that cannot be copied**: such a row is skipped and listed with its reason in `logs/migration-report.json`. A row whose
  parent was skipped or does not exist (an orphan) is skipped too, except a job's department, which is emptied and reported.
- `verify.js` does not reuse the migration's rules. It works out what every value should be from the Mongoose models and
  reads Postgres back as exact text. Skipped rows must be absent; every other record must be present and identical.
- Both were tested on deliberately awkward data (bad enum values, missing required fields, orphans, text where numbers
  belong) and the verifier was tested by corrupting the copy nine ways (a letter, a decimal, a value inside JSON, one
  millisecond, a 17th digit, an enum, a deleted row, an extra row); every corruption was caught.
- To test against another MongoDB (for example a copy of production), set `MIGRATE_MONGO_URI`.

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
and `Department.name` only after checking the real data for duplicates.

## Setting up a database

Set `DATABASE_URL`, run `npm run prisma -- migrate deploy` (applies every folder in `migrations/` in order), then
`npm run migrate:postgres` and `npm run verify:postgres` to copy and check the data, and set `DB_PROVIDER=postgres`.
The CHECK constraints and the case-insensitive department-name index that Prisma cannot express are already part of the
first migration; `extra-constraints.sql` documents them and the reasons.
