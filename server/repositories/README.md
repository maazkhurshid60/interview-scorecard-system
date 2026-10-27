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
