import { PrismaClient } from "@prisma/client";

/** Prisma singleton (survives HMR in dev). Uses the pooled DATABASE_URL. */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
