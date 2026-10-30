import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  checkConventions,
  conventionChecks,
  conventionExceptions,
  type ConventionException,
} from "./convention-catalog.ts";
import { createTestDatabase, type TestDatabase } from "./testing/index.ts";

// docs/db の規約を、migration を流した DB のカタログで確かめる検査 (Issue #361、docs/db/convention-check.md)。
describe("checkConventions", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    // ロールの属性とメンバーシップはクラスタ全体のもので、複製した DB に閉じない。壊した検出力のテストの後に戻す。
    await db.superuser.query(
      `ALTER ROLE app_user NOSUPERUSER NOCREATEROLE NOCREATEDB;
       ALTER ROLE auth_service NOSUPERUSER NOCREATEROLE NOCREATEDB;
       REVOKE migrator FROM app_user`,
    );
    await db.close();
  });

  it("migration を流した DB では、問題がないこと", async () => {
    expect(await checkConventions(db.superuser)).toEqual([]);
  });

  // 規約を満たす表 claim.t_x を作る。規約を破る検査は、この表に 1 か所だけ手を入れて、その 1 件だけが出ることを確かめる。
  const createCompliantTable = async (d: TestDatabase) => {
    await d.migrator.query(
      `CREATE TABLE claim.t_x (LIKE claim.t_claim INCLUDING ALL);
       ALTER TABLE claim.t_x ENABLE ROW LEVEL SECURITY;
       ALTER TABLE claim.t_x FORCE ROW LEVEL SECURITY`,
    );
  };

  const failuresOf = async (d: TestDatabase, table: string) =>
    (await checkConventions(d.superuser)).filter(
      (failure) => failure.includes(table) && !failure.startsWith("外している検査"),
    );

  it("規約を満たす表を足しても、問題がないこと", async () => {
    await createCompliantTable(db);

    expect(await checkConventions(db.superuser)).toEqual([]);
  });

  // 検出力: わざと規約を破った DB で、検査が失敗を返すこと (#30)。DDL は表の所有者の migrator、GRANT などは superuser。
  const breakages: readonly {
    name: string;
    sql: string;
    as?: "superuser";
    table?: string;
    expected: string[];
  }[] = [
    {
      name: "表の名前が snake_case でない",
      sql: `ALTER TABLE claim.t_x RENAME TO "TBad"`,
      table: "TBad",
      expected: ["[naming] 表 claim.TBad が snake_case でない"],
    },
    {
      name: "カラムの名前が snake_case でない",
      sql: `ALTER TABLE claim.t_x ADD COLUMN "badName" text`,
      expected: ["[naming] カラム claim.t_x.badName が snake_case でない"],
    },
    {
      name: "予約語のカラム",
      sql: `ALTER TABLE claim.t_x ADD COLUMN "order" text`,
      expected: ["[reserved-word] カラム claim.t_x.order が予約語"],
    },
    {
      name: "予約語の表",
      sql: `ALTER TABLE claim.t_x RENAME TO "like"`,
      table: "like",
      expected: ["[reserved-word] 表 claim.like が予約語"],
    },
    {
      name: "共通カラムの欠け",
      sql: `ALTER TABLE claim.t_x DROP COLUMN updated_by`,
      expected: ["[common-columns] claim.t_x の updated_by がない"],
    },
    {
      name: "共通カラムの型の違い",
      sql: `ALTER TABLE claim.t_x ALTER COLUMN created_by TYPE text`,
      expected: ["[common-columns] claim.t_x の created_by の型が text。varchar にする"],
    },
    {
      name: "共通カラムの NOT NULL の欠け",
      sql: `ALTER TABLE claim.t_x ALTER COLUMN created_by DROP NOT NULL`,
      expected: ["[common-columns] claim.t_x の created_by が NOT NULL でない"],
    },
    {
      name: "NULL を許すはずの共通カラムの NOT NULL",
      sql: `ALTER TABLE claim.t_x ALTER COLUMN patched_at SET NOT NULL`,
      expected: ["[common-columns] claim.t_x の patched_at が NULL を許さない"],
    },
    {
      name: "lock_no の既定値の違い",
      sql: `ALTER TABLE claim.t_x ALTER COLUMN lock_no SET DEFAULT 0`,
      expected: ["[common-columns] claim.t_x の lock_no の既定値が 0。1 にする"],
    },
    {
      name: "lock_no の既定値の欠け",
      sql: `ALTER TABLE claim.t_x ALTER COLUMN lock_no DROP DEFAULT`,
      expected: ["[common-columns] claim.t_x の lock_no に既定値がない。1 にする"],
    },
    {
      name: "money 型",
      sql: `ALTER TABLE claim.t_x ADD COLUMN amount money`,
      expected: ["[column-types] claim.t_x.amount: money 型は使わず numeric にする"],
    },
    {
      name: "real 型",
      sql: `ALTER TABLE claim.t_x ADD COLUMN rate real`,
      expected: [
        "[column-types] claim.t_x.rate: real 型は使わず、浮動小数点が必要なら double precision にする",
      ],
    },
    {
      name: "money 型の配列",
      sql: `ALTER TABLE claim.t_x ADD COLUMN amounts money[]`,
      expected: ["[column-types] claim.t_x.amounts: money 型は使わず numeric にする"],
    },
    {
      name: "money 型のドメイン",
      sql: `CREATE DOMAIN claim.d_money AS money; ALTER TABLE claim.t_x ADD COLUMN amount claim.d_money`,
      expected: ["[column-types] claim.t_x.amount: money 型は使わず numeric にする"],
    },
    {
      name: "タイムゾーンなしの timestamp",
      sql: `ALTER TABLE claim.t_x ADD COLUMN applied_at timestamp`,
      expected: [
        "[column-types] claim.t_x.applied_at: タイムゾーンなしの timestamp は使わず timestamptz にする",
      ],
    },
    {
      name: "serial",
      sql: `ALTER TABLE claim.t_x ADD COLUMN seq serial`,
      expected: ["[column-types] claim.t_x.seq: serial は使わず bigint の IDENTITY にする"],
    },
    {
      name: "integer の IDENTITY",
      sql: `ALTER TABLE claim.t_x ADD COLUMN seq integer GENERATED ALWAYS AS IDENTITY`,
      expected: ["[column-types] claim.t_x.seq: IDENTITY 列は bigint にする (int4)"],
    },
    {
      name: "主キーの欠け",
      sql: `ALTER TABLE claim.t_x DROP CONSTRAINT t_x_pkey`,
      expected: ["[primary-key] claim.t_x に主キーがない"],
    },
    {
      name: "tenant_id で始まらない複合の主キー",
      sql: `ALTER TABLE claim.t_x DROP CONSTRAINT t_x_pkey, ADD PRIMARY KEY (claim_id, tenant_id)`,
      expected: [
        "[primary-key] claim.t_x の複合の主キー (claim_id, tenant_id) が tenant_id で始まらない",
      ],
    },
    {
      name: "外部キー",
      sql: `ALTER TABLE claim.t_x ADD CONSTRAINT fk_x
              FOREIGN KEY (tenant_id, claim_id) REFERENCES claim.t_claim (tenant_id, claim_id) NOT VALID`,
      expected: ["[foreign-key] claim.t_x に 外部キー制約 fk_x がある"],
    },
    {
      name: "CHECK 制約",
      sql: `ALTER TABLE claim.t_x ADD CONSTRAINT ck_x CHECK (lock_no > 0)`,
      expected: ["[check-constraint] claim.t_x に CHECK 制約 ck_x がある"],
    },
    {
      name: "UNIQUE 制約",
      sql: `ALTER TABLE claim.t_x ADD CONSTRAINT uk_x UNIQUE (created_by)`,
      expected: [
        "[unique-constraint] claim.t_x に UNIQUE 制約 uk_x がある。ユニークインデックスにする",
      ],
    },
    {
      name: "RLS の ENABLE の欠け",
      sql: `ALTER TABLE claim.t_x DISABLE ROW LEVEL SECURITY`,
      expected: ["[row-level-security] claim.t_x が RLS を ENABLE にしていない"],
    },
    {
      name: "RLS の FORCE の欠け",
      sql: `ALTER TABLE claim.t_x NO FORCE ROW LEVEL SECURITY`,
      expected: ["[row-level-security] claim.t_x が RLS を FORCE にしていない"],
    },
    {
      name: "app_user のスキーマへの CREATE",
      sql: `GRANT CREATE ON SCHEMA claim TO app_user`,
      as: "superuser",
      table: "app_user",
      expected: ["[privileges] app_user が claim スキーマに CREATE できる"],
    },
    {
      name: "auth_service の auth スキーマへの CREATE",
      sql: `GRANT CREATE ON SCHEMA auth TO auth_service`,
      as: "superuser",
      table: "auth_service",
      expected: ["[privileges] auth_service が auth スキーマに CREATE できる"],
    },
    {
      name: "app_user の CREATEROLE",
      sql: `ALTER ROLE app_user CREATEROLE`,
      as: "superuser",
      table: "CREATEROLE",
      expected: ["[privileges] app_user が CREATEROLE を持つ"],
    },
    {
      name: "auth_service の SUPERUSER",
      sql: `ALTER ROLE auth_service SUPERUSER`,
      as: "superuser",
      table: "SUPERUSER",
      expected: ["[privileges] auth_service が SUPERUSER を持つ"],
    },
    {
      name: "app_user が migrator の権限を継承する",
      sql: `GRANT migrator TO app_user`,
      as: "superuser",
      table: "継承",
      expected: ["[privileges] app_user が migrator の権限を継承している"],
    },
    {
      name: "app_user が関数を所有する",
      sql: `CREATE FUNCTION claim.f_x() RETURNS int LANGUAGE sql AS 'SELECT 1';
            ALTER FUNCTION claim.f_x() OWNER TO app_user`,
      as: "superuser",
      table: "f_x",
      expected: [
        "[privileges] app_user が claim.f_x を所有している (所有者は DDL を実行できる)",
        "[privileges] PUBLIC が 関数 claim.f_x の EXECUTE を持つ",
      ],
    },
    {
      name: "auth_service のデータベースへの CREATE",
      sql: `DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO auth_service', current_database()); END $$`,
      as: "superuser",
      table: "auth_service",
      expected: ["[privileges] auth_service がデータベースに CREATE できる"],
    },
    {
      name: "app_user が表を所有する",
      sql: `ALTER TABLE claim.t_x OWNER TO app_user`,
      as: "superuser",
      expected: [
        "[privileges] app_user が claim.t_x を所有している (所有者は DDL を実行できる)",
        "[privileges] app_user が claim.t_x_claim_id_seq を所有している (所有者は DDL を実行できる)",
      ],
    },
    {
      name: "PUBLIC への表の権限",
      sql: `GRANT SELECT ON claim.t_x TO PUBLIC`,
      as: "superuser",
      expected: ["[privileges] PUBLIC が 表 claim.t_x の SELECT を持つ"],
    },
    {
      name: "PUBLIC へのスキーマの CREATE",
      sql: `GRANT CREATE ON SCHEMA claim TO PUBLIC`,
      as: "superuser",
      table: "スキーマ claim",
      expected: ["[privileges] PUBLIC が スキーマ claim の CREATE を持つ"],
    },
    {
      name: "PUBLIC への関数の EXECUTE (既定)",
      sql: `CREATE FUNCTION claim.f_x() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
      table: "f_x",
      expected: ["[privileges] PUBLIC が 関数 claim.f_x の EXECUTE を持つ"],
    },
    {
      name: "PUBLIC へのデータベースの CREATE",
      sql: `DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO PUBLIC', current_database()); END $$`,
      as: "superuser",
      table: "PUBLIC が データベース",
      expected: ["[privileges] PUBLIC が データベース"],
    },
  ];

  it.each(breakages)("$name を見つけること", async ({ sql, as, table, expected }) => {
    await createCompliantTable(db);
    await (as === "superuser" ? db.superuser : db.migrator).query(sql);

    const failures = await failuresOf(db, table ?? "t_x");

    // 期待の文は先頭の部分だけで比べる (データベース名など、実行ごとに変わる部分を含む文のため)。
    expect(failures.map((failure, index) => failure.slice(0, expected[index]?.length))).toEqual(
      expected,
    );
  });

  it("ユニークインデックスと、REVOKE した関数は許すこと", async () => {
    await createCompliantTable(db);
    await db.migrator.query(
      `CREATE UNIQUE INDEX uk_t_x ON claim.t_x (tenant_id, created_by);
       CREATE FUNCTION claim.f_x() RETURNS int LANGUAGE sql AS 'SELECT 1';
       REVOKE ALL ON FUNCTION claim.f_x() FROM PUBLIC`,
    );

    expect(await checkConventions(db.superuser)).toEqual([]);
  });

  it("double precision は許すこと (規約が、浮動小数点が必要なときに使う型として挙げている)", async () => {
    await createCompliantTable(db);
    await db.migrator.query(`ALTER TABLE claim.t_x ADD COLUMN rate double precision`);

    expect(await checkConventions(db.superuser)).toEqual([]);
  });

  it("スキーマの名前が snake_case でないことを見つけること", async () => {
    await db.superuser.query(`CREATE SCHEMA "BadSchema"`);

    expect(await checkConventions(db.superuser)).toContain(
      "[naming] スキーマ BadSchema が snake_case でない",
    );
  });

  describe("例外", () => {
    const auth = conventionExceptions.filter((exception) => exception.scope === "auth");

    it("すべての検査の名前が、この検査にあること", () => {
      for (const exception of conventionExceptions) {
        expect([...conventionChecks, "all"]).toContain(exception.check);
      }
    });

    it("auth スキーマの例外を外すと、auth の表が規約に反すると返すこと", async () => {
      const withoutAuth = conventionExceptions.filter(
        (exception) => exception.scope !== "auth" && !exception.scope.startsWith("auth."),
      );

      const failures = await checkConventions(db.superuser, withoutAuth);

      expect(failures).toContain("[naming] カラム auth.user.emailVerified が snake_case でない");
      expect(failures).toContain("[common-columns] auth.session の created_at がない");
      expect(failures).toContain(
        "[foreign-key] auth.session に 外部キー制約 session_userId_fkey がある",
      );
      expect(failures).toContain("[reserved-word] 表 auth.user が予約語");
    });

    it("auth スキーマに、例外の外の規約違反があれば見つけること", async () => {
      await db.superuser.query(`GRANT CREATE ON SCHEMA auth TO app_user`);

      expect(await checkConventions(db.superuser)).toContain(
        "[privileges] app_user が auth スキーマに CREATE できる",
      );
    });

    it("auth に表を足すと、外部キーと一意制約の例外は当たらないこと", async () => {
      await db.migrator.query(
        `CREATE TABLE auth.new_table (id uuid PRIMARY KEY, email text UNIQUE)`,
      );

      expect(await checkConventions(db.superuser)).toContain(
        "[unique-constraint] auth.new_table に UNIQUE 制約 new_table_email_key がある。ユニークインデックスにする",
      );
    });

    it("対象のスキーマか表がない例外は効かず、その例外を失敗として返すこと", async () => {
      const exceptions: ConventionException[] = [
        ...conventionExceptions,
        { scope: "ghost", check: "all", reason: "消えたスキーマの例外" },
        { scope: "claim.t_ghost", check: "naming", reason: "消えた表の例外" },
      ];

      const failures = await checkConventions(db.superuser, exceptions);

      expect(failures).toContain("[exception] 例外 ghost の all の対象がない");
      expect(failures).toContain("[exception] 例外 claim.t_ghost の naming の対象がない");
    });

    it("表を指す例外が、その表だけを外すこと", async () => {
      await createCompliantTable(db);
      await db.migrator.query(
        `ALTER TABLE claim.t_x ADD COLUMN "badName" text;
         CREATE TABLE claim.t_y (LIKE claim.t_claim INCLUDING ALL);
         ALTER TABLE claim.t_y ENABLE ROW LEVEL SECURITY;
         ALTER TABLE claim.t_y FORCE ROW LEVEL SECURITY;
         ALTER TABLE claim.t_y ADD COLUMN "badName" text`,
      );
      const exceptions: ConventionException[] = [
        ...conventionExceptions,
        { scope: "claim.t_x", check: "naming", reason: "テストのための例外" },
      ];

      const failures = await checkConventions(db.superuser, exceptions);

      expect(failures.filter((failure) => failure.startsWith("[naming]"))).toEqual([
        "[naming] カラム claim.t_y.badName が snake_case でない",
      ]);
    });

    it("all の例外は、そのスキーマのすべての検査を外すこと", async () => {
      await db.migrator.query(`CREATE TABLE claim.t_bad (id serial)`);
      const exceptions: ConventionException[] = [
        ...conventionExceptions,
        { scope: "claim", check: "all", reason: "テストのための例外" },
      ];

      expect(await checkConventions(db.superuser, exceptions)).toEqual([]);
    });

    it("理由が空の例外は効かず、その例外を失敗として返すこと", async () => {
      await db.migrator.query(`CREATE TABLE claim.t_bad (id bigint PRIMARY KEY)`);
      const exceptions: ConventionException[] = [{ scope: "claim", check: "all", reason: " " }];

      const failures = await checkConventions(db.superuser, exceptions);

      expect(failures).toContain("[exception] 例外 claim の all に理由がない");
      expect(failures).toContain("[common-columns] claim.t_bad の created_at がない");
    });

    it("失敗には、外している検査と理由を付けること", async () => {
      await db.migrator.query(`CREATE TABLE claim.t_bad (id bigint PRIMARY KEY)`);

      const failures = await checkConventions(db.superuser);

      expect(failures).toContain(
        `外している検査: ${auth[0]?.scope} の ${auth[0]?.check} (理由: ${auth[0]?.reason})`,
      );
    });

    it("migrations スキーマの履歴の表が、すべての検査から外れていること", async () => {
      const failures = await checkConventions(db.superuser);

      expect(failures.filter((failure) => failure.includes("migrations"))).toEqual([]);
    });
  });
});
