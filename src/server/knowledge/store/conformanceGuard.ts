/**
 * Safety guard for the destructive Postgres conformance run.
 *
 * `conformance.test.ts` calls `wipe … CASCADE` on EVERY knowledge table through the shared
 * `prisma` singleton — which is bound to `DATABASE_URL`. Pointed at a dev/corpus DB that is
 * data loss: it once wiped the ingested 918-chunk corpus. This guard makes that impossible — the
 * destructive run refuses unless the DB is clearly a throwaway test database (name contains
 * "test"), or the operator explicitly opts in. Pure + unit-tested so the protection can't rot.
 */

/** Extract the database name from a Postgres connection URL (`…/NAME?params` → `NAME`). */
export function databaseName(url: string): string {
  const withoutQuery = url.split("?")[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
}

/** A DB is safe to wipe only if its name marks it as a test DB. */
export function isTestDatabase(url: string): boolean {
  return /test/i.test(databaseName(url));
}

/**
 * Throw unless it is safe to run the destructive conformance suite against `url`.
 * `allowNonTest` (from `CONFORMANCE_ALLOW_NONTEST=1`) is the explicit, deliberate override.
 */
export function assertConformanceDbSafe(url: string | undefined, allowNonTest: boolean): void {
  if (allowNonTest) return;
  const name = databaseName(url ?? "");
  if (!name) {
    throw new Error(
      "RUN_DB_CONFORMANCE: DATABASE_URL is empty or unparseable — refusing to run the destructive " +
        "conformance suite (it wipes every knowledge table).",
    );
  }
  if (!/test/i.test(name)) {
    throw new Error(
      `RUN_DB_CONFORMANCE would wipe all knowledge tables in database "${name}", which is not a ` +
        `test DB. Conformance is destructive — it once wiped the ingested corpus. Point DATABASE_URL ` +
        `at a throwaway database whose name contains "test", or set CONFORMANCE_ALLOW_NONTEST=1 to ` +
        `override deliberately.`,
    );
  }
}
