import { base, en, Faker, ja } from "@faker-js/faker";
import type { Kysely } from "kysely";

/** The tenant that a module writes its rows for, and the user who applies in it. */
export interface SeedTenant {
  readonly tenantId: string;
  /** The user id that `*_by` takes, and who applied: a fixed value, so the tests and a person can name the user. */
  readonly applicantId: string;
}

/**
 * The two tenants (docs/adr/0011, 0036). The values are fixed literals: A is the tenant that the check for a second run
 * looks at, and B shows that the rows of one tenant do not show in the other.
 */
export const tenants: readonly [SeedTenant, SeedTenant] = [
  {
    tenantId: "11111111-1111-4111-8111-111111111111",
    applicantId: "aaaaaaaa-0000-4000-8000-000000000001",
  },
  {
    tenantId: "22222222-2222-4222-8222-222222222222",
    applicantId: "bbbbbbbb-0000-4000-8000-000000000001",
  },
];

/** The moment of every row: a fixed value, because `now()` would change the data on each run (docs/adr/0036). */
export const seededAt = "2026-01-05T09:00:00Z";

/** The program code and transaction id that the common columns take. */
export const seedProgram = "seed";

/**
 * A faker of its own, with a fixed seed and the same locales as `fakerJA`. Each caller makes one, so the values of one
 * module do not depend on which module called before (a shared `fakerJA` would need a `seed()` call before each use).
 * A new version of faker may give other values, so no test writes a value of the seed as an expectation (docs/adr/0036).
 */
export function createFaker(seed: number): Faker {
  return new Faker({ locale: [ja, en, base], seed });
}

/** The tables of a Kysely type: `Kysely<Tables>` gives `Tables`. */
export type TablesOf<Database> = Database extends Kysely<infer Tables> ? Tables : never;

/**
 * The map of a module: one writer for each table of its schema, for one tenant. The mapped type has a key for every
 * table, so a table that a migration adds without a seed fails `vp check` (docs/adr/0036).
 */
export type TableSeeds<Tables> = {
  [T in keyof Tables]: (db: Kysely<Tables>, tenant: SeedTenant) => Promise<void>;
};
