import { describe, expect, it } from "vite-plus/test";
import {
  classifyMigrations,
  decide,
  type Decision,
  harnessEntry,
  report,
  seedEntry,
  type MigrationChanges,
} from "./rules.ts";

const dir = "packages/db/migrations/";
const ready = { hasSeed: true, hasHarness: true };
const message = (decision: Decision): string => ("message" in decision ? decision.message : "");
const none: MigrationChanges = { added: [], modified: [], deleted: [] };

describe("classifyMigrations", () => {
  it("sorts the files under the migrations directory into added, changed and deleted", () => {
    const diff = [
      `A\t${dir}2.sql`,
      `A\t${dir}1.sql`,
      `M\t${dir}0.sql`,
      `T\t${dir}00.sql`,
      `D\t${dir}9.sql`,
    ].join("\n");
    expect(classifyMigrations(diff)).toEqual({
      added: [`${dir}1.sql`, `${dir}2.sql`],
      modified: [`${dir}0.sql`, `${dir}00.sql`],
      deleted: [`${dir}9.sql`],
    });
  });

  it("ignores other files, blank lines and a diff with no change", () => {
    expect(classifyMigrations(`A\tapps/api/src/a.ts\nM\tpackages/db/src/migrate.ts\n\n`)).toEqual(
      none,
    );
    expect(classifyMigrations("")).toEqual(none);
  });
});

describe("decide", () => {
  it("fails when a migration of the base is changed", () => {
    const decision = decide({ ...none, modified: [`${dir}1.sql`] }, ready);
    expect(decision.kind).toBe("fail");
    expect(message(decision)).toContain(`${dir}1.sql (changed)`);
  });

  it("fails when a migration of the base is deleted, even if another is added and the base has no seed", () => {
    const decision = decide(
      { added: [`${dir}2.sql`], modified: [], deleted: [`${dir}1.sql`] },
      { hasSeed: false, hasHarness: false },
    );
    expect(decision.kind).toBe("fail");
    expect(message(decision)).toContain(`${dir}1.sql (deleted)`);
  });

  it("passes when no migration is added", () => {
    const decision = decide(none, ready);
    expect(decision.kind).toBe("skip");
    expect(message(decision)).toContain("no migration");
  });

  it("passes with a notice when the base has no seed entry", () => {
    const decision = decide(
      { ...none, added: [`${dir}1.sql`] },
      { hasSeed: false, hasHarness: true },
    );
    expect(decision.kind).toBe("skip");
    expect(message(decision)).toContain(seedEntry);
  });

  it("passes with a notice when the base's harness cannot apply the files", () => {
    const decision = decide(
      { ...none, added: [`${dir}1.sql`] },
      { hasSeed: true, hasHarness: false },
    );
    expect(decision.kind).toBe("skip");
    expect(message(decision)).toContain(harnessEntry);
  });

  it("runs the tests with the added migrations", () => {
    expect(decide({ ...none, added: [`${dir}1.sql`, `${dir}2.sql`] }, ready)).toEqual({
      kind: "run",
      files: [`${dir}1.sql`, `${dir}2.sql`],
    });
  });
});

describe("report", () => {
  it("writes an ::error:: annotation for a failure and a ::notice:: for a skip in GitHub Actions", () => {
    const env = { GITHUB_ACTIONS: "true" };
    expect(report({ kind: "fail", message: "a\nb 100%" }, env)).toEqual({
      stdout: "::error title=migration-compat::a%0Ab 100%25\n",
      stderr: "",
    });
    expect(report({ kind: "skip", message: "none" }, env)).toEqual({
      stdout: "::notice title=migration-compat::none\n",
      stderr: "",
    });
  });

  it("writes a failure to stderr and a skip to stdout elsewhere", () => {
    expect(report({ kind: "fail", message: "bad" }, {})).toEqual({
      stdout: "",
      stderr: "migration-compat: bad\n",
    });
    expect(report({ kind: "skip", message: "none" }, {})).toEqual({
      stdout: "migration-compat: skipped. none\n",
      stderr: "",
    });
  });
});
