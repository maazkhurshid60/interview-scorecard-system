# Going live: PostgreSQL and Redis

## Redis

Redis needs to be set up (the email and AI-screening queues run on it), and its address added to the environment:

```
REDIS_URL=redis://:PASSWORD@HOST:6379
```

## PostgreSQL migration

Add the PostgreSQL address to the environment, and keep the app on MongoDB until the switch:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
DB_PROVIDER=mongo
```

Then, from the `server/` folder:

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
