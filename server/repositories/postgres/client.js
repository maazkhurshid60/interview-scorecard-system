import prismaPkg from '@prisma/client';

/**
 * The one Prisma connection to PostgreSQL, shared by every Postgres repository. It reads DATABASE_URL from the
 * environment. Only used when DB_PROVIDER=postgres (it is loaded on demand, never when the app runs on MongoDB).
 */
const { PrismaClient } = prismaPkg;

export const prisma = new PrismaClient();

export async function connect() {
  await prisma.$connect();
}

export async function disconnect() {
  await prisma.$disconnect();
}
