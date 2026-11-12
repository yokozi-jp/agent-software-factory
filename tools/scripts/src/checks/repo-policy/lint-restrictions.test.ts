// The checks of the table of lint restrictions
// (./lint-restrictions.ts), each called alone on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import {
  connectionPassFixture,
  connectionStopFixture,
  consoleFixture,
  lintRestrictions,
  outboxFixture,
  passingRepo,
} from "./fixtures/passing-repo.ts";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { lintRestrictionsAgree } from "./lint-restrictions.ts";

describe("ADR 0050: lint の禁止の表とその fixture が一致すること", () => {
  const violations = failuresOf(lintRestrictionsAgree);
  type Table = typeof lintRestrictions;
  const tablePath = "lint-restrictions.json";
  const howTo = 'docs/tooling/ci.md ("禁止の表")';
  const outbox = "packages/module-fixtures/src/__fixtures__/outbox.ts";
  const outboxTest = "apps/api/src/__fixtures__/outbox.test.ts";
  const connectionTest = "apps/api/src/__fixtures__/connection.test.ts";
  const consoleFile = "packages/module-fixtures/src/__fixtures__/console.ts";
  // A copy of the table of the passing repository, changed by `change`.
  const table = (change: (copy: Table) => void): string => {
    const copy = structuredClone(lintRestrictions);
    change(copy);
    return JSON.stringify(copy);
  };
  const failures = (files: Record<string, string | undefined>) => violations(repo(files));
  const noStop = (file: string, rule: string, text: string, reason: string, adr: string) =>
    `\`${file}\` に、\`oxlint-disable-next-line ${rule}\` の次の行で \`${text}\` を書いた行がない。${reason} (${adr})。`;
  const noPass = (file: string, text: string, reason: string, adr: string) =>
    `\`${file}\` に、disable のコメントを前に置かずに \`${text}\` を書いた行がない。${reason} (${adr})。`;
  const unlistedStop = (file: string, line: number, rule: string, key: string) =>
    `\`${file}\` の ${line} 行目は \`${rule}\` で止める行だが、${tablePath} の ${key} に、このファイルでこの行を止める行がない。表に行を足すか、fixture から行を消す (${howTo})。`;
  const unlistedPass = (file: string, line: number, key: string) =>
    `\`${file}\` の ${line} 行目は通す行 (前の行に disable のコメントがなく、import か ${key} の文字列を書いた行) だが、${tablePath} の ${key} に、このファイルでこの行を通す行がない。表に行を足すか、fixture から行を消す (${howTo})。`;
  const sqsMissing = noStop(
    outbox,
    "no-restricted-imports",
    '"@x/sqs"',
    "Outbox を通す",
    "docs/adr/0029",
  );

  it("すべての行に対応する行があり、fixture のすべての行に対応する行があるとき通すこと", () => {
    expect(violations(repo())).toEqual([]);
  });

  describe("表の行", () => {
    it("止める行を、規則の disable コメントの下に求めること", () => {
      expect(failures({ [outbox]: undefined })).toEqual([sqsMissing]);
      expect(failures({ [outbox]: "export const other = 1;\n" })).toEqual([sqsMissing]);
    });

    it("1 行上にない disable コメントを数えないこと", () => {
      const apart = outboxFixture.replace("\nimport", "\n\nimport");
      expect(failures({ [outbox]: apart })).toEqual([
        sqsMissing,
        unlistedPass(outbox, 3, "outbox"),
      ]);
    });

    it("別の規則の disable コメントを数えないこと", () => {
      const other = outboxFixture.replace("no-restricted-imports", "no-restricted-globals");
      expect(failures({ [outbox]: other })).toEqual([
        sqsMissing,
        unlistedStop(outbox, 2, "no-restricted-globals", "outbox"),
      ]);
    });

    it("通す行を、上に disable コメントのない形で求めること", () => {
      const missing = noPass(connectionTest, '"pg"', "テストは pool を作る", "docs/adr/0029");
      expect(failures({ [connectionTest]: undefined })).toEqual([missing]);
      expect(failures({ [connectionTest]: connectionStopFixture })).toEqual([
        missing,
        unlistedStop(connectionTest, 2, "no-restricted-imports", "connection"),
      ]);
    });

    it("コメントの規則のうち、理由の前にある規則を読むこと", () => {
      const several = outboxFixture.replace(
        "no-restricted-imports -- fixture",
        "a/b, no-restricted-imports -- fixture: no-restricted-globals",
      );
      expect(failures({ [outbox]: several })).toEqual([unlistedStop(outbox, 2, "a/b", "outbox")]);
      const inReason = outboxFixture.replace(
        "no-restricted-imports -- fixture",
        "a/b -- no-restricted-imports",
      );
      expect(failures({ [outbox]: inReason })).toEqual([
        sqsMissing,
        unlistedStop(outbox, 2, "a/b", "outbox"),
      ]);
    });

    it("/* */ のコメントと、インデントされたコメントを読むこと", () => {
      const block = outboxFixture.replace(
        "// oxlint-disable-next-line no-restricted-imports -- fixture",
        "  /* oxlint-disable-next-line no-restricted-imports */",
      );
      expect(failures({ [outbox]: block })).toEqual([]);
    });

    it("type の import と値の import を区別しないこと: type の import の上の disable コメントは `vp check` で失敗する", () => {
      const typeOnly = outboxFixture.replace('import "@x/sqs"', 'import type { X } from "@x/sqs"');
      expect(failures({ [outbox]: typeOnly })).toEqual([]);
    });

    it("行のすべてのファイルを求めること", () => {
      expect(failures({ [outbox]: undefined, [outboxTest]: undefined })).toEqual([
        sqsMissing,
        noStop(outboxTest, "no-restricted-imports", '"@x/sqs"', "Outbox を通す", "docs/adr/0029"),
      ]);
    });
  });

  describe("表の fixture の行", () => {
    it("止める行を表が落とすと拒否されること", () => {
      const dropped = table((copy) => {
        copy.console.rows.pop();
      });
      expect(failures({ [tablePath]: dropped })).toEqual([
        unlistedStop(consoleFile, 4, "no-restricted-properties", "console"),
      ]);
    });

    it("通す行を表が落とすと拒否されること", () => {
      const dropped = table((copy) => {
        copy.connection.rows.pop();
      });
      expect(failures({ [tablePath]: dropped })).toEqual([
        unlistedPass(connectionTest, 1, "connection"),
      ]);
    });

    it("表のキーに因む名前のどのファイルでも読み、どの行も名指さないファイルでも読むこと", () => {
      const other = "apps/api/src/routes/__fixtures__/connection.ts";
      expect(failures({ [other]: connectionStopFixture })).toEqual([
        unlistedStop(other, 2, "no-restricted-imports", "connection"),
      ]);
      expect(failures({ [other.replace(".ts", ".test.ts")]: connectionPassFixture })).toEqual([
        unlistedPass(other.replace(".ts", ".test.ts"), 1, "connection"),
      ]);
    });

    it("別の名前のファイル、__fixtures__/ の外、検査の fixture の中では読まないこと", () => {
      expect(
        failures({
          "apps/api/src/__fixtures__/connections.ts": connectionStopFixture,
          "apps/api/src/connection.ts": connectionStopFixture,
          "apps/api/src/__fixtures__/connection.md": connectionStopFixture,
          "tools/scripts/src/checks/other/__fixtures__/connection.ts": connectionStopFixture,
        }),
      ).toEqual([]);
    });

    it("禁止のテキストがない fixture の行を通すこと", () => {
      expect(
        failures({
          [connectionTest]: `${connectionPassFixture}export const x = 1;\n// a note on "pg"\n`,
        }),
      ).toEqual([]);
    });
  });

  describe("禁止の値", () => {
    it("禁止を止める各ファイルに、各値の行を求めること", () => {
      const added = table((copy) => {
        copy.outbox.values.push("@x/ses");
      });
      const missing = (file: string) =>
        `${tablePath} の outbox は \`@x/ses\` を止めるが、\`${file}\` に、それを書いて止める行が表にない。表と fixture に止める行を足す (${howTo})。`;
      expect(failures({ [tablePath]: added })).toEqual([
        missing(outbox),
        missing("packages/module-fixtures/src/http/__fixtures__/outbox.ts"),
        missing(outboxTest),
      ]);
    });

    it("値を、行のテキストの中の完全な名前としてだけ数えること", () => {
      const longer = table((copy) => {
        copy.outbox.values = ["@x/sq"];
      });
      expect(failures({ [tablePath]: longer })).toHaveLength(3);
      const inProperty = table((copy) => {
        copy.console.values = ["globalThis"];
      });
      expect(failures({ [tablePath]: inProperty })).toEqual([]);
    });
  });

  describe("禁止のメッセージ", () => {
    const noMention = (key: string, mention: string) =>
      `${tablePath} の ${key} の message に \`${mention}\` がない。止められた人が、代わりに書くものと ADR を知るため (${howTo})。`;

    it("代わりに書くものと ADR を挙げること", () => {
      const without = table((copy) => {
        copy.outbox.message = "Do not send from here.";
      });
      expect(failures({ [tablePath]: without })).toEqual([
        noMention("outbox", "enqueueOutbox"),
        noMention("outbox", "docs/adr/0029"),
      ]);
    });

    it("メッセージのない禁止には求めないこと", () => {
      const without = table((copy) => {
        copy.console.mentions = ["Logger"];
      });
      expect(failures({ [tablePath]: without })).toEqual([]);
    });
  });

  describe("行のファイル", () => {
    it("キーに因んで __fixtures__/ ディレクトリに置くこと", () => {
      const renamed = table((copy) => {
        copy.connection.rows[0]?.files.push(
          "apps/api/src/__fixtures__/bypass.ts",
          "apps/api/src/connection.ts",
        );
      });
      const wrong = (file: string) =>
        `${tablePath} の connection の行が \`${file}\` を挙げるが、fixture のファイルは __fixtures__/connection.ts か __fixtures__/connection.test.ts にする (${howTo})。`;
      expect(failures({ [tablePath]: renamed })).toEqual([
        wrong("apps/api/src/__fixtures__/bypass.ts"),
        wrong("apps/api/src/connection.ts"),
      ]);
    });
  });

  describe("層ごとの行 (perLayer)", () => {
    const vite = passingRepo["vite.config.ts"] ?? "";
    // vite.config.ts of the passing repository with one more layer.
    const withApplication = vite.replace(
      '  http: ["domain"],',
      '  http: ["domain"],\n  application: ["domain"],',
    );
    const layerFile = (layer: string, key: string) =>
      `packages/module-fixtures/src/${layer}/__fixtures__/${key}.ts`;
    const application = layerFile("application", "outbox");
    const http = layerFile("http", "outbox");
    const noLayerRow = (layer: string, key: string) =>
      `vite.config.ts の layers に \`${layer}\` があるが、${tablePath} の ${key} に \`${layerFile(layer, key)}\` の行がなく、withoutLayers にもない。止める行か通す行を足す。置かないなら、withoutLayers に層の名前と置かない理由を書く (${howTo})。`;
    const unflagged = (what: string, key = "outbox") =>
      `${tablePath} の ${key} は ${what}が、perLayer が true でない。層ごとに求めるなら perLayer を true にする (${howTo})。`;
    const staleExcuse = (layer: string) =>
      `${tablePath} の outbox は withoutLayers に \`${layer}\` を挙げるが、vite.config.ts の layers にその層がない。消す (${howTo})。`;
    const rowAndExcuse = (layer: string) =>
      `${tablePath} の outbox は withoutLayers に \`${layer}\` を挙げるが、\`${layerFile(layer, "outbox")}\` の行もある。置くなら withoutLayers から消し、置かないなら行を消す (${howTo})。`;

    it("layers に足した層の行も理由もないとき、層と禁止の名前を挙げて拒否すること", () => {
      expect(failures({ "vite.config.ts": withApplication })).toEqual([
        noLayerRow("application", "outbox"),
      ]);
    });

    it("足した層の行と fixture があるとき通すこと", () => {
      const added = table((copy) => {
        copy.outbox.rows[0]?.files.push(application);
      });
      expect(
        failures({
          "vite.config.ts": withApplication,
          [tablePath]: added,
          [application]: outboxFixture,
        }),
      ).toEqual([]);
    });

    it("足した層を withoutLayers に挙げたとき通すこと", () => {
      const excused = table((copy) => {
        copy.outbox.withoutLayers.application = "x";
      });
      expect(failures({ "vite.config.ts": withApplication, [tablePath]: excused })).toEqual([]);
    });

    it("理由を消した層を拒否すること", () => {
      const dropped = table((copy) => {
        copy.outbox.withoutLayers = {};
      });
      expect(failures({ [tablePath]: dropped })).toEqual([noLayerRow("domain", "outbox")]);
    });

    it("行のファイルを消した層を拒否すること", () => {
      const dropped = table((copy) => {
        copy.outbox.rows[0]?.files.splice(1, 1);
      });
      expect(failures({ [tablePath]: dropped, [http]: undefined })).toEqual([
        noLayerRow("http", "outbox"),
      ]);
    });

    it("layers にない層を withoutLayers に挙げたとき拒否すること", () => {
      const stale = table((copy) => {
        copy.outbox.withoutLayers.removed = "x";
      });
      expect(failures({ [tablePath]: stale })).toEqual([staleExcuse("removed")]);
    });

    it("layers が読めないとき、層の行も理由も求めないこと", () => {
      expect(failures({ "vite.config.ts": "export default {};\n" })).toEqual([]);
    });

    it("行も理由もある層を拒否すること", () => {
      const both = table((copy) => {
        copy.outbox.withoutLayers.http = "x";
      });
      expect(failures({ [tablePath]: both })).toEqual([rowAndExcuse("http")]);
    });

    it("層の fixture の行があるのに perLayer がない禁止を拒否すること", () => {
      const unflag = table((copy) => {
        copy.outbox.perLayer = false;
      });
      expect(failures({ [tablePath]: unflag })).toEqual([
        unflagged(`層 \`http\` の fixture (\`${http}\`) の行を持つ`),
        unflagged("withoutLayers を持つ"),
      ]);
    });
  });

  describe("表そのもの", () => {
    it("求められること", () => {
      expect(failures({ [tablePath]: undefined })).toEqual([
        `${tablePath} がない。lint で止める import と呼び出しと、その fixture の行を並べる表で、vite.config.ts と repo-policy が読む (${howTo})。`,
      ]);
    });

    it("JSON でないとき 1 回だけ報告し、何も求めないこと", () => {
      expect(violations(repo({ [tablePath]: "{" }))).toEqual([
        expect.stringMatching(/^lint-restrictions\.json is not valid JSON/),
      ]);
    });

    it.each([
      ["a restriction that is not an object", { outbox: [] }, "outbox", "オブジェクト"],
      [
        "an adr that is not text",
        { outbox: { ...lintRestrictions.outbox, adr: 1 } },
        "outbox.adr",
        "文字列",
      ],
      [
        "values with one that is not text",
        { outbox: { ...lintRestrictions.outbox, values: ["@x/sqs", 1] } },
        "outbox.values",
        "文字列の配列",
      ],
      [
        "mentions that are missing",
        { outbox: { ...lintRestrictions.outbox, mentions: undefined } },
        "outbox.mentions",
        "文字列の配列",
      ],
      [
        "mentions that are one text",
        { outbox: { ...lintRestrictions.outbox, mentions: "enqueueOutbox" } },
        "outbox.mentions",
        "文字列の配列",
      ],
      [
        "a message that is not text",
        { outbox: { ...lintRestrictions.outbox, message: 1 } },
        "outbox.message",
        "文字列",
      ],
      [
        "rows that are not an array",
        { outbox: { ...lintRestrictions.outbox, rows: {} } },
        "outbox.rows",
        "配列",
      ],
      [
        "a perLayer that is not true or false",
        { outbox: { ...lintRestrictions.outbox, perLayer: "yes" } },
        "outbox.perLayer",
        "真偽値",
      ],
      [
        "a withoutLayers with a reason that is not text",
        { outbox: { ...lintRestrictions.outbox, withoutLayers: { domain: 1 } } },
        "outbox.withoutLayers",
        "層の名前と理由の文字列のオブジェクト",
      ],
      [
        "a withoutLayers with a blank reason",
        { outbox: { ...lintRestrictions.outbox, withoutLayers: { domain: " " } } },
        "outbox.withoutLayers",
        "層の名前と理由の文字列のオブジェクト",
      ],
    ])("%s を拒否し、その禁止を除くこと", (_, value, where, what) => {
      expect(failures({ [tablePath]: JSON.stringify(value) })).toEqual([
        `${tablePath} の ${where} が${what}でない (${howTo})。`,
      ]);
    });

    const [row] = lintRestrictions.outbox.rows;
    it.each([
      ["a row that is not an object", 1, "", "オブジェクト"],
      ["a row without files", { ...row, files: undefined }, ".files", "空でない文字列の配列"],
      ["a row with no file", { ...row, files: [] }, ".files", "空でない文字列の配列"],
      [
        "a row with a blank file",
        { ...row, files: [outbox, " "] },
        ".files",
        "空でない文字列の配列",
      ],
      ["a row with an empty text", { ...row, text: "" }, ".text", "空でない文字列"],
      ["a row without a rule", { ...row, rule: undefined }, ".rule", "空でない文字列"],
      ["a row with a blank reason", { ...row, reason: " " }, ".reason", "空でない文字列"],
      [
        "a row whose expect is neither stop nor pass",
        { ...row, expect: "allow" },
        ".expect",
        '"stop" か "pass"',
      ],
    ])("%s を拒否し、その行を除くこと", (_, wrong, field, what) => {
      const value = { outbox: { ...lintRestrictions.outbox, rows: [row, wrong] } };
      expect(failures({ [tablePath]: JSON.stringify(value) })).toEqual([
        `${tablePath} の outbox.rows[1]${field} が${what}でない (${howTo})。`,
      ]);
    });

    it("オブジェクトでない表を拒否すること", () => {
      expect(failures({ [tablePath]: "[]" })).toEqual([
        `${tablePath} の最上位がオブジェクトでない (${howTo})。`,
      ]);
    });
  });

  describe("fixture の行", () => {
    it.each([
      ["no space after //", "//oxlint-disable-next-line no-restricted-imports"],
      ["two spaces before the rule", "// oxlint-disable-next-line  no-restricted-imports"],
      [
        "a /* */ comment closed with no space",
        "/* oxlint-disable-next-line no-restricted-imports*/",
      ],
      ["a comment with a reason", "// oxlint-disable-next-line no-restricted-imports -- why"],
      [
        "a reason that is only the separator",
        "// oxlint-disable-next-line no-restricted-imports --",
      ],
    ])("%s のある disable コメントを読むこと", (_, comment) => {
      expect(failures({ [outbox]: `${comment}\nimport "@x/sqs";\n` })).toEqual([]);
    });

    it("カンマの後の空の規則を読まないこと", () => {
      const comma =
        '// oxlint-disable-next-line no-restricted-imports, -- fixture\nimport "@x/sqs";\n';
      expect(failures({ [outbox]: comma })).toEqual([]);
    });

    it("コードの後の disable コメントを読まないこと", () => {
      const after =
        'const a = 1; // oxlint-disable-next-line no-restricted-imports\nimport "@x/sqs";\n';
      expect(failures({ [outbox]: after })).toEqual([
        sqsMissing,
        unlistedPass(outbox, 2, "outbox"),
      ]);
    });

    it("コメントと行の間の空行を読み飛ばすこと", () => {
      const apart = outboxFixture.replace("\nimport", "\n  \nimport");
      expect(failures({ [outbox]: apart })).toEqual([
        sqsMissing,
        unlistedPass(outbox, 3, "outbox"),
      ]);
    });

    it("コメントを読み飛ばし、コードの後のコメントをコードとして読むこと", () => {
      const commented = [
        '// a note on "@x/sqs"',
        '  // an indented note on "@x/sqs"',
        "/*",
        ' * a block on "@x/sqs"',
        " */",
        "// oxlint-disable-next-line no-restricted-imports -- fixture",
        'import "@x/sqs"; // the client',
        "",
      ].join("\n");
      expect(failures({ [outbox]: commented })).toEqual([]);
    });

    it("禁止のどのテキストでも通す行に、行を求めること", () => {
      const bare = `${consoleFixture}export const c: unknown = console;\n`;
      expect(failures({ [consoleFile]: bare })).toEqual([unlistedPass(consoleFile, 5, "console")]);
    });

    it("ルートの fixture を読み、別の拡張子のものを読まないこと", () => {
      expect(
        failures({
          "__fixtures__/connection.ts": connectionStopFixture,
          "apps/api/src/__fixtures__/connection.ts.bak": connectionStopFixture,
        }),
      ).toEqual([
        unlistedStop("__fixtures__/connection.ts", 2, "no-restricted-imports", "connection"),
      ]);
    });

    it.each([
      ["an import of a module for its effects", 'import "node:fs";'],
      ["an import of names", 'import { a } from "node:fs";'],
      ["a type import", '  import type { A } from "node:fs";'],
      ["a re-export", 'export { a } from "node:fs";'],
      ["an import with no space before the path", 'import"node:fs";'],
      ["a re-export with no space before the path", 'export { a } from"node:fs";'],
    ])("どの行もそのテキストを持たなくても、通す %s の行を求めること", (_, line) => {
      expect(failures({ [connectionTest]: `${connectionPassFixture}${line}\n` })).toEqual([
        unlistedPass(connectionTest, 2, "connection"),
      ]);
    });

    it.each([
      ["a constant that holds a text", 'export const a = "node:fs";'],
      ["a name that starts with import", 'const imported = from("node:fs");'],
      ["a call with from in its name", 'exportFrom("node:fs");'],
      ["a dynamic import", 'import("node:fs");'],
      ["an import after other code", 'x import "node:fs";'],
      ["a from that no quote follows", "export const a = b from c;"],
    ])("%s を import と取り違えないこと", (_, line) => {
      expect(failures({ [connectionTest]: `${connectionPassFixture}${line}\n` })).toEqual([]);
    });

    it("ほかの行がそのテキストを持たなくても、行が通す import を通すこと", () => {
      const withRow = table((copy) => {
        copy.connection.rows.push({
          files: [connectionTest],
          rule: "no-restricted-imports",
          text: '"node:fs"',
          expect: "pass",
          reason: "x",
        });
      });
      expect(
        failures({
          [tablePath]: withRow,
          [connectionTest]: `${connectionPassFixture}import "node:fs";\n`,
        }),
      ).toEqual([]);
    });

    it("行を通すファイルではなく、止めるファイルの値だけを求めること", () => {
      const other = "apps/api/src/__fixtures__/connection.ts";
      const passOnly = table((copy) => {
        copy.connection.rows.push({
          files: [other],
          rule: "no-restricted-imports",
          text: "export const x",
          expect: "pass",
          reason: "x",
        });
      });
      expect(failures({ [tablePath]: passOnly, [other]: "export const x = 1;\n" })).toEqual([]);
    });
  });
});
