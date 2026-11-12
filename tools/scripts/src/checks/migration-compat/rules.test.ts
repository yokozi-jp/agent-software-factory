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
  it("migrations ディレクトリの下のファイルを、追加、変更、削除に分けること", () => {
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

  it("変更と削除のファイルも分けること", () => {
    const diff = [`M\t${dir}2.sql`, `M\t${dir}1.sql`, `D\t${dir}9.sql`, `D\t${dir}8.sql`].join(
      "\n",
    );
    expect(classifyMigrations(diff)).toEqual({
      added: [],
      modified: [`${dir}1.sql`, `${dir}2.sql`],
      deleted: [`${dir}8.sql`, `${dir}9.sql`],
    });
  });

  it("migration の path であっても、タブのない行を無視すること", () => {
    expect(classifyMigrations(`${dir}1.sql\n`)).toEqual(none);
  });

  it("ほかのファイル、空行、変更のない diff を無視すること", () => {
    expect(
      classifyMigrations(`A\tapps/api/src/a.ts\nM\tpackages/db/src/infrastructure/migrate.ts\n\n`),
    ).toEqual(none);
    expect(classifyMigrations("")).toEqual(none);
  });
});

describe("decide", () => {
  it("base の migration が変更されたとき失敗すること", () => {
    const decision = decide({ ...none, modified: [`${dir}1.sql`] }, ready);
    expect(decision.kind).toBe("fail");
    expect(message(decision)).toContain(`${dir}1.sql (changed)`);
  });

  it("別の migration が足され、base に seed がなくても、base の migration が削除されたとき失敗すること", () => {
    const decision = decide(
      { added: [`${dir}2.sql`], modified: [], deleted: [`${dir}1.sql`] },
      { hasSeed: false, hasHarness: false },
    );
    expect(decision.kind).toBe("fail");
    expect(message(decision)).toContain(`${dir}1.sql (deleted)`);
  });

  it("migration が足されないとき通すこと", () => {
    const decision = decide(none, ready);
    expect(decision.kind).toBe("skip");
    expect(message(decision)).toContain("no migration");
  });

  it("base に seed の入口がないとき、notice を出して通すこと", () => {
    const decision = decide(
      { ...none, added: [`${dir}1.sql`] },
      { hasSeed: false, hasHarness: true },
    );
    expect(decision.kind).toBe("skip");
    expect(message(decision)).toContain(seedEntry);
  });

  it("base の harness がファイルを適用できないとき、notice を出して通すこと", () => {
    const decision = decide(
      { ...none, added: [`${dir}1.sql`] },
      { hasSeed: true, hasHarness: false },
    );
    expect(decision.kind).toBe("skip");
    expect(message(decision)).toContain(harnessEntry);
  });

  it("変更と削除のすべての migration を、1 つの一覧で失敗に挙げること", () => {
    expect(
      message(
        decide(
          { added: [], modified: [`${dir}1.sql`, `${dir}2.sql`], deleted: [`${dir}3.sql`] },
          ready,
        ),
      ),
    ).toContain(`${dir}1.sql (changed), ${dir}2.sql (changed), ${dir}3.sql (deleted).`);
  });

  it("足した migration でテストを実行すること", () => {
    expect(decide({ ...none, added: [`${dir}1.sql`, `${dir}2.sql`] }, ready)).toEqual({
      kind: "run",
      files: [`${dir}1.sql`, `${dir}2.sql`],
    });
  });
});

describe("report", () => {
  it("GitHub Actions では、失敗を ::error::、スキップを ::notice:: の annotation で書くこと", () => {
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

  it("失敗を stderr に、スキップを stdout に書くこと (GitHub Actions 以外)", () => {
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
