import { RuleTester } from "vite-plus/lint/plugins-dev";
import { describe, it } from "vite-plus/test";

import plugin from "./i18n-plugin.ts";

RuleTester.describe = describe;
RuleTester.it = it;

// Indexing `plugin.rules` gives `Rule | undefined` (noUncheckedIndexedAccess).
const rule = plugin.rules["literal-key"];
if (!rule) throw new Error("literal-key の規則がない");

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx", ecmaFeatures: { jsx: true } } },
});

const error = [{ messageId: "nonLiteralKey" }];

tester.run("literal-key", rule, {
  valid: [
    // 文字列リテラルと、`${}` のないテンプレートリテラル。
    'const a = t("home.title");',
    "const a = t(`home.title`);",
    'const a = i18n.t("home.title");',
    'const a = i18next.t("home.title");',
    'const a = t("home.title", { count });',
    'const { t } = useTranslation(); t("home.title");',
    // 第 1 引数がない呼び出しは、キーを渡していない。
    "const a = t();",
    // `t` ではない関数。
    "const a = format(key);",
    "const a = other.t(key);",
    "const a = i18n.language(key);",
    "const a = i18n[name](key);",
    // 受け手が名前でない呼び出しは、i18n のオブジェクトかどうか分からない。
    "const a = getI18n().t(key);",
    "const a = (0, fn)(key);",
    // `t` という名前の別の値のメソッドや、useTranslation の外の別名。
    "const a = text(key);",
    "const { t: translate } = other(); translate(key);",
    "const { i18n } = useTranslation(); i18n.changeLanguage(language);",
    // 分割代入の形が違い、`t` を取り出していない。
    "const { i18n } = useTranslation(); const a = i18n.language;",
    "const [t] = useTranslation(); const a = 1;",
    "const { ...rest } = useTranslation(); const a = 1;",
    "const { [name]: t } = useTranslation(); const a = 1;",
    "const { t: [x] } = useTranslation(); const a = 1;",
    "const { t } = useTranslation;",
    "const { t } = i18n.useTranslation(); const a = 1;",
  ],
  invalid: [
    { code: "const a = t(key);", errors: error },
    { code: "const a = t(`home.${name}`);", errors: error },
    { code: 'const a = t("home." + name);', errors: error },
    { code: 'const a = t(cond ? "a" : "b");', errors: error },
    { code: 'const a = t(["a", "b"]);', errors: error },
    { code: "const a = t(...keys);", errors: error },
    { code: "const a = t(1);", errors: error },
    { code: "const a = i18n.t(key);", errors: error },
    { code: "const a = i18next.t(`x.${key}`);", errors: error },
    { code: 'const a = i18n["t"](key);', errors: error },
    // useTranslation が返す t を別の名前で受ける。
    { code: "const { t: translate } = useTranslation(); translate(key);", errors: error },
    {
      code: "const { t: translate = fallback } = useTranslation(); translate(key);",
      errors: error,
    },
    // 引数の `t` も `t` の名前で見る (スコープは見ない)。
    { code: "const f = (t) => t(key);", errors: error },
    // 同じ呼び出しの第 1 引数だけを見る。
    { code: 'const a = t(key, "default");', errors: error },
  ],
});
