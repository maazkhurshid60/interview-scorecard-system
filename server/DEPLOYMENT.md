# Going live: PostgreSQL and Redis

## Environment variables to add

Redis needs to be set up first (the email and AI-screening queues run on it), then its address added:

```
BULLMQ_PREFIX=ownerstalent
REDIS_URL=redis://:PASSWORD@HOST:6379
```

Database and migration:

```
MONGODB_URI=<the live MongoDB address, already set>
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
DB_PROVIDER=mongo
```

`DB_PROVIDER` stays `mongo` until the switch (the last step below), then becomes `postgres`.

## PostgreSQL migration

From the `server/` folder:

1. Install the packages and build the Prisma client:
   ```
   npm ci
   npm run prisma -- generate
   ```
2. Create the tables (in a new, empty database):
   ```
   npm run prisma -- migrate deploy
   ```
3. Copy the data from MongoDB (MongoDB is only read, never changed):
   ```
   npm run migrate:postgres
   ```
4. Check the copy. The last line must say `PASS`:
   ```
   npm run verify:postgres
   ```
5. Switch: set `DB_PROVIDER=postgres` in the environment and restart the backend.

To go back, set `DB_PROVIDER=mongo` and restart.
