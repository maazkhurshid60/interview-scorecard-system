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
  postgres/                     the PostgreSQL versions (Prisma), being written; client.js is the shared connection
```

Controllers and services import the same path (`../repositories/departmentRepository.js`) whichever database is in
use. The two versions must offer exactly the same functions: `npm run check:repositories` shows what each has and what
the Postgres side still lacks (`-- --strict` fails if they differ). `DB_PROVIDER` is set in the root `.env`; leave it as
`mongo` until the Postgres move is finished.

While the move is in progress, one repository at a time can be switched to Postgres to try it in the real app:

```
DB_PROVIDER_DEPARTMENT=postgres     (in .env; the names are DEPARTMENT, USER, SETTING, AUDIT_LOG, PIPELINE_TEMPLATE,
                                     REFRESH_TOKEN, CANDIDATE, APPLICATION, INTERVIEW, REQUISITION, SCORECARD)
```

The server then connects to both databases and logs which repository uses which. A mistyped name or value stops the
server at start-up. The two databases hold separate copies of the data, so run `npm run migrate:postgres -- --reset`
first to refresh the Postgres copy, and expect only the switched repository's screen to be reliable (for example, a job
opening still reads its department from MongoDB). Remove the line to go back to MongoDB.

## Writing a Postgres repository: the rules, and the proof

A Postgres repository must be indistinguishable from its MongoDB twin. `npm run parity -- <name>` proves it: it runs
the same calls on both versions (each on its own freshly seeded scratch database, never your real ones) and compares
every result, every error and the data left behind. The first one (department) found these, so every repository follows
them (the helpers are in `postgres/helpers.js`):

- **Same shape:** plain objects with `_id` as text; an empty optional value is left out, not `null`.
- **Same errors,** because `middleware/errorHandler.js` and the API answers depend on them: an invalid id is a
  `CastError` (`castId`), a taken unique value is a code 11000 duplicate error (`translateError`), a missing required
  value is a `ValidationError` with Mongoose's wording (`validationError`).
- **Same ids:** new ids look like ObjectIds (`newId`); only 24 hex characters are valid ids, in any letter case.
- **Same ordering:** MongoDB sorts text by bytes (`Zeta` before `alpha`); Postgres sorts by language rules. Use
  `compareBytes`.
- **Same searching:** Prisma's case-insensitive equals is a `LIKE`, so `%` and `_` act as wildcards. Wrap the text with
  `escapeLike`.
- **Same writes:** trim what the Mongoose model trimmed; write nothing (and keep `updatedAt`) when nothing changed.
- **Numbers and JSON:** Prisma rounds numbers that need 17 digits; see `../prisma/README.md`.

One known, harmless difference: a MongoDB document that never had a value for a field with a default (for example a
department with no `description`) is read by the app without that field, while its Postgres copy has the default. Records
the app writes always have it.

Two more, both about JSON values (settings, audit entries, template stages): PostgreSQL keeps the keys of an object in its
own order, not the order they were written in; and a value that was stored as an explicit `null` by the old data copy is
read as "no value" (the app treats both the same). Dates inside a JSON value come back as text, not as dates.

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
- Moving to Postgres + Prisma means rewriting these files with the same function names; controllers and services
  should not need to change.
