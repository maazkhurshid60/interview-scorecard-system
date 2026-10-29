# Repositories

All database access lives here. Nothing else in the server imports a Mongoose model or `mongoose` itself
(`npm run check:architecture` fails if something does).

```
routes -> controllers -> services -> repositories -> models
(URLs)    (HTTP only)    (workflows)  (all queries)   (schemas)
```

- **Controllers** read the request, validate, call a repository or service, and send the response.
- **Services** hold business workflows (scoring, background screening, email queue).
- **Repositories** are the only place that knows queries and the database. One file per model, named for what
  the app wants (`removeAndUnlinkJobs`, `claimForScreening`), not for how the database does it.
- **Models** are the Mongoose schemas. Only repositories import them.

## Two databases, one switch

```
repositories/
  departmentRepository.js ...   a thin front for each repository: loads the MongoDB or the PostgreSQL version
  provider.js                   reads DB_PROVIDER (mongo, the default, or postgres) and loads the right folder
  mongo/                        the MongoDB versions (Mongoose), plus plain.js, entity.js and ids.js
  postgres/                     the PostgreSQL versions (Prisma); client.js is the shared connection
```

Controllers and services import the same path (`../repositories/departmentRepository.js`) whichever database is in
use. The two versions must offer exactly the same functions: `npm run check:repositories` shows what each has and what
the Postgres side still lacks (`-- --strict` fails if they differ). `DB_PROVIDER` is set in the root `.env` and applies to
every repository at once; a value other than `mongo` or `postgres` stops the server at start-up. The two databases hold
separate copies of the data, so run `npm run migrate:postgres -- --reset` to copy MongoDB into Postgres before switching.
See `../prisma/README.md` for the design and the data copy.

## Ids

- **MongoDB:** an id is a 24-character ObjectId. **PostgreSQL:** an id is an auto-increment number (1, 2, 3, ...) made by the
  database, so a repository inserts without an id and reads the new one back.
- **What the rest of the app sees is the same on both:** plain objects whose ids (`_id`, `candidateId`, `userId`, ...) are
  **text** (`"7"` on Postgres). Controllers, services and the client therefore keep comparing ids as text. A repository accepts
  an id as text or as a number; on the way out `idOut` (`postgres/helpers.js`) turns the number into text.
- **What counts as an id** is a database detail, so it lives in `ids.js`: `isValidId`, `isValidIdString`, `normalizeId` and
  `isValidPublicRef`. On Postgres an id is a whole number from 1 to 2,147,483,647, as a number or as digits; anything else,
  including an old 24-character id, is a `CastError` (`castId`), which the API answers with a 400.
- **Ids inside JSON lists** (a stage progress entry) are not table ids: they keep the 24-character shape (`newSubdocId`).
- **Public links** (a job application link, an availability link) are not ids. They hold the record's random `publicToken`, or
  the old 24-character id of a link shared before the move (kept in `legacyId`); a plain number is refused because it could be
  guessed. Use `isValidPublicRef(ref)` to check the value from the URL and `requisitionRepo.findPublicView(ref)` /
  `requisitionRepo.findByPublicRef(ref)` / `interviewRepo.findByPublicRef(ref)` to find the record (on MongoDB they are plain id
  lookups). Records read from Postgres carry `publicToken`, which the client uses to build new links (`publicToken || _id`).

## Writing a Postgres repository: the rules, and the proof

A Postgres repository must be indistinguishable from its MongoDB twin, apart from the differences listed below.
`npm run parity -- <name>` proves it: it runs the same calls on both versions (each on its own freshly seeded scratch
database, never your real ones) and compares every result, every error and the data left behind. The harness
(`prisma/parity/harness.js`) translates the ids so the scenarios can stay written with 24-character ids: the record
`hex(n)` is stored in Postgres as the number `n`, ids handed to a Postgres repository become numbers and ids in its answers
become 24-character ids again. The first repository (department) found these, so every repository follows them (the helpers
are in `postgres/helpers.js`):

- **Same shape:** plain objects with `_id` as text; an empty optional value is left out, not `null`.
- **Same errors,** because `middleware/errorHandler.js` and the API answers depend on them: an invalid id is a
  `CastError` (`castId`), a taken unique value is a code 11000 duplicate error (`translateError`), a missing required
  value is a `ValidationError` with Mongoose's wording (`validationError`).
- **Ids:** insert without an id and read it back (`RETURNING id`); compare ids in SQL with a cast (`$1::int`, `ANY($1::int[])`);
  sort ties by number, not as text (9 before 10); hand ids out with `idOut`.
- **Same ordering:** MongoDB sorts text by bytes (`Zeta` before `alpha`); Postgres sorts by language rules. Use
  `compareBytes`.
- **Same searching:** Prisma's case-insensitive equals is a `LIKE`, so `%` and `_` act as wildcards. Wrap the text with
  `escapeLike`.
- **Same writes:** trim what the Mongoose model trimmed; write nothing (and keep `updatedAt`) when nothing changed.
- **Numbers and JSON:** Prisma rounds numbers that need 17 digits; see `../prisma/README.md`.

Known differences (all by design, all handled in the comparison):

- A MongoDB document that never had a value for a field with a default (for example a department with no `description`) is
  read by the app without that field, while its Postgres copy has the default. Records the app writes always have it.
- JSON values (settings, audit entries, template stages): PostgreSQL keeps the keys of an object in its own order, and dates
  inside a JSON value come back as text, not as dates.
- Records that point at each other (a refresh token at its user, an application at its candidate and job opening): PostgreSQL
  enforces the link, so a record cannot point at something that does not exist, and deleting the parent deletes the records
  that point at it. MongoDB allowed both. Links the database does not enforce (an audit entry's job opening) can still name a
  record that is gone; the data copy empties such a link, because it cannot be a number.
- Ids: a bad id is described differently (`Cast to Number` instead of `Cast to ObjectId`), an id is a number, a refused insert
  uses up a number, and only Postgres records have a `publicToken`.

**Explicit nulls.** MongoDB told a field saved as `null` from one never set (the ranking sort and the audit screen depend on
it); an empty column cannot. Every table therefore has a `nullFields` column listing the fields saved as an explicit
`null`. The data copy fills it, every write keeps it up to date, and reads turn it back into `null`. A field whose default
is `null` (a disposition, a revoked-at date) needs no note.

The records engine (`postgres/records.js`, with the models described in `postgres/schemas.js`) does for candidates,
applications, interviews, job openings and scorecards what Mongoose did: defaults, checks with Mongoose's own wording, nested
groups and lists, and writing only what changed. Mongoose reports problems in a set order (what was not given first, last
field first; then what was given, in the order it was given), so the engine does too. A record is written without its id
and without columns the database fills in (`readOnly` in the model: the public token).

## Tests

```
npm run parity                 every scenario, MongoDB against PostgreSQL (scratch databases)
npm run parity -- candidate    one scenario
npm run parity:real            reads your real data through both versions and compares every answer (read only)
npm run smoke:postgres         the real server on Postgres with a copy of your data and real requests (no mail, queue or AI)
npm run journey:postgres       a whole working day on the real server on top of the copied data (new jobs, candidates, scoring, restart)
npm run test:ids               what counts as an id and as a public link on Postgres (needs no database)
```

## What comes back

Repositories return **plain objects**: ids are strings, there are no Mongoose documents, and `__v` is dropped
(`plain.js`). Field names are unchanged (`_id`), so the API and the client are unaffected.

## Records you change and save (`entity.js`)

Applications, interviews, job openings and scorecards are loaded, changed in memory, then saved:

```js
const interview = await interviewRepo.findById(id);
interview.status = 'approved';
await interviewRepo.save(interview);   // writes only what changed, then updates `interview`
```

The repository keeps a hidden snapshot of each record when it loads it. `save` compares against that snapshot and
writes only the fields that changed, which is what a Mongoose document does, so two requests changing different
fields of the same record do not overwrite each other. After saving, the object is brought up to date and can be
sent to the client.

## Things to know

- `ids.js` holds the id checks (`isValidId`), so controllers do not need to know what an id looks like.
- A filled-in related record (an application with its candidate: `findByIdWithCandidate`) stays filled in after `save`.
- An empty nested object (for example an interview with no `candidateAvailability`) is absent on a plain object,
  where a Mongoose document would give `{}`. Code that reads such a field should allow for `undefined`.
- Controllers and services should not need to know which database is in use; the only places that choose between an id and a
  public link are the four public endpoints (the job page, applying, and the two availability routes).
