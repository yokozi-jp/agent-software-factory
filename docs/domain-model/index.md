# ドメインモデルの書き方

- [型の書き方](types.md)：`domain` の状態、遷移、値の型、構成で表す型、網羅、`satisfies` を書くとき
- [失敗の書き方](failures.md)：業務の規則の失敗を `Result` で返すとき、失敗の `_tag` を決めるとき、`throw` と zod と `Result` のどれを使うか迷うとき、失敗を HTTP の応答に変えるとき
- [application の Effect の書き方](application-effect.md)：`application` や `infrastructure` で Effect を使うとき、使ってよい機能を確かめるとき、Kysely を包むとき、入口で実行するとき、現在時刻 (`now`、`Clock`) の渡し方を確かめるとき
- [認可の書き方](authorization.md)：認可の方針の関数 `authorize` や許可の証 (`Permit`) を書くとき、遷移の関数が取る引数を決めるとき、認可の網羅のテストを書くとき、403 と 404 のどちらを返すか迷うとき
- [型述語の境界値のテスト](testing.md)：`domain` の型述語や遷移の関数のテストを書くとき
- [英語の識別子と用語集の対応表](glossary-mapping.md)：`domain` や `application` の識別子を決めるとき、`GLOSSARY.md` の言葉を英語にするとき
- [モジュールを足す手順](add-module.md)：サンプル機能のモジュールを足すとき、`moduleOrder`、`apps/api` への登録、migration、型の生成の足し忘れで repo-policy や `types.test.ts` が失敗したとき
