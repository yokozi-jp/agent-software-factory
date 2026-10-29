import { RuleTester } from "vite-plus/lint/plugins-dev";
import { describe, it } from "vite-plus/test";

import plugin from "./tenant-sql-plugin.ts";

RuleTester.describe = describe;
RuleTester.it = it;

// Indexing `plugin.rules` gives `Rule | undefined` (noUncheckedIndexedAccess).
const rule = plugin.rules["no-session-setting"];
if (!rule) throw new Error("no-session-setting の規則がない");

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const error = [{ messageId: "sessionSetting" }];

tester.run("no-session-setting", rule, {
  valid: [
    // 普通の SQL。
    "const q = sql`SELECT id FROM auth.organization WHERE id = ${id}`;",
    "const q = sql`UPDATE claim.t_claim SET lock_no = lock_no + 1 WHERE claim_id = ${id}`;",
    // SET の列の名前に role を含むだけ。
    "const q = sql`UPDATE t SET role = ${role}`;",
    "const q = sql`UPDATE t SET role_name = ${role}`;",
    // sql のタグではない。
    "const q = other`SET LOCAL ROLE x`;",
    "const q = `set_config`;",
    "log('SET ROLE x');",
    // 値の読み取りは、設定の変更ではない。
    "const q = sql`SELECT current_setting('app.other', true)`;",
    // 引数が文字列でない sql.raw は、中身を調べられない。
    "const q = sql.raw(statement);",
    "const q = sql.id('claim');",
    "const q = sql();",
  ],
  invalid: [
    { code: "const q = sql`SET ROLE claim_module`;", errors: error },
    { code: "const q = sql`set local role ${sql.id(r)}`;", errors: error },
    { code: "const q = sql`SET SESSION ROLE x`;", errors: error },
    { code: "const q = sql`RESET ROLE`;", errors: error },
    { code: "const q = sql`SET SESSION AUTHORIZATION app_user`;", errors: error },
    { code: "const q = sql`SELECT set_config('x', ${v}, true)`;", errors: error },
    { code: "const q = sql`SELECT current_setting('app.current_tenant')`;", errors: error },
    // 改行や複数の空白をまたぐ。
    { code: "const q = sql`SET\n  LOCAL   ROLE x`;", errors: error },
    // 式で区切られた後ろの文字列にも効く。
    { code: "const q = sql`SELECT ${a}, set_config('x', ${v}, true)`;", errors: error },
    // 不正なエスケープ (cooked が null) があっても、元の文字列で調べる。
    { code: "const q = sql`\\unicode SET ROLE x`;", errors: error },
    // sql.raw と sql.lit の文字列。
    { code: "const q = sql.raw('SET ROLE x');", errors: error },
    { code: "const q = sql.raw(`set_config('x', 'y', true)`);", errors: error },
    { code: "const q = kysely.sql.raw('SET ROLE x');", errors: error },
    // 別の名前を付けて import した sql は追えないが、メンバー経由のタグは追う。
    { code: "const q = kysely.sql`SET ROLE x`;", errors: error },
  ],
});
