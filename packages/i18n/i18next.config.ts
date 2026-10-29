import { defineConfig } from "i18next-cli";

// キーの検査 (`i18next-cli status` と `status --unused`) の設定 (docs/adr/0044)。
// パスは、この package のディレクトリが cwd のときの相対パス。検出力の fixture は、同じ配置を fixture の中に作り、
// cwd を変えて同じ設定で流す (src/keys.test.ts)。
export default defineConfig({
  locales: ["ja", "en"],
  extract: {
    primaryLanguage: "ja",
    // 文言を使うコード。web の画面と、この package の中の文面の引き方。
    input: ["src/**/*.{ts,tsx}", "../../apps/web/src/**/*.{ts,tsx}"],
    // テストと fixture に書いた `t("…")` は、使われている印にしない。
    // 入力の glob が `../../` で package の外に出るので、除外の glob も同じ起点 (cwd) から書く。`**/` だけでは外に届かない。
    ignore: [
      "src/**/*.test.ts",
      "src/**/__fixtures__/**",
      "../../apps/web/src/**/*.test.ts",
      "../../apps/web/src/**/*.test.tsx",
      "../../apps/web/src/**/__fixtures__/**",
    ],
    output: "src/locales/{{language}}/{{namespace}}.json",
    defaultNS: "translation",
    // 検査だけに使う。`extract` でリソースを書き換える使い方はしない。
    removeUnusedKeys: false,
    // コメントの `t("…")` は使われている印にしない。
    extractFromComments: false,
  },
  // 直書きの文字列の検査 (`i18next-cli lint`)。web の画面だけを対象にして、ゲートには入れない (docs/adr/0044)。
  lint: {
    ignore: ["src/**"],
  },
});
