// The checks of the table of lint restrictions (./lint-restrictions.ts), each called on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import {
  connectionPassFixture,
  connectionStopFixture,
  consoleFixture,
  lintRestrictions,
  outboxFixture,
} from "./fixtures/passing-repo.ts";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { lintRestrictionsAgree } from "./lint-restrictions.ts";

describe("ADR 0050: the table of lint restrictions and its fixtures agree", () => {
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

  it("passes when every row has its line, and every line of the fixtures has its row", () => {
    expect(violations(repo())).toEqual([]);
  });

  describe("a row of the table", () => {
    it("asks for the line it stops, below the disable comment of its rule", () => {
      expect(failures({ [outbox]: undefined })).toEqual([sqsMissing]);
      expect(failures({ [outbox]: "export const other = 1;\n" })).toEqual([sqsMissing]);
    });

    it("does not count a disable comment that is not on the line above", () => {
      const apart = outboxFixture.replace("\nimport", "\n\nimport");
      expect(failures({ [outbox]: apart })).toEqual([
        sqsMissing,
        unlistedPass(outbox, 3, "outbox"),
      ]);
    });

    it("does not count a disable comment of another rule", () => {
      const other = outboxFixture.replace("no-restricted-imports", "no-restricted-globals");
      expect(failures({ [outbox]: other })).toEqual([
        sqsMissing,
        unlistedStop(outbox, 2, "no-restricted-globals", "outbox"),
      ]);
    });

    it("asks for the line it lets through, with no disable comment above it", () => {
      const missing = noPass(connectionTest, '"pg"', "テストは pool を作る", "docs/adr/0029");
      expect(failures({ [connectionTest]: undefined })).toEqual([missing]);
      expect(failures({ [connectionTest]: connectionStopFixture })).toEqual([
        missing,
        unlistedStop(connectionTest, 2, "no-restricted-imports", "connection"),
      ]);
    });

    it("reads the rule among the rules of the comment, before its reason", () => {
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

    it("reads a /* */ comment and an indented one", () => {
      const block = outboxFixture.replace(
        "// oxlint-disable-next-line no-restricted-imports -- fixture",
        "  /* oxlint-disable-next-line no-restricted-imports */",
      );
      expect(failures({ [outbox]: block })).toEqual([]);
    });

    it("does not tell a type import from a value import: a disable comment above a type import fails `vp check`", () => {
      const typeOnly = outboxFixture.replace('import "@x/sqs"', 'import type { X } from "@x/sqs"');
      expect(failures({ [outbox]: typeOnly })).toEqual([]);
    });

    it("asks every file of the row", () => {
      expect(failures({ [outbox]: undefined, [outboxTest]: undefined })).toEqual([
        sqsMissing,
        noStop(outboxTest, "no-restricted-imports", '"@x/sqs"', "Outbox を通す", "docs/adr/0029"),
      ]);
    });
  });

  describe("a line of a fixture of the table", () => {
    it("is refused when the table drops the row that stops it", () => {
      const dropped = table((copy) => {
        copy.console.rows.pop();
      });
      expect(failures({ [tablePath]: dropped })).toEqual([
        unlistedStop(consoleFile, 4, "no-restricted-properties", "console"),
      ]);
    });

    it("is refused when the table drops the row that lets it through", () => {
      const dropped = table((copy) => {
        copy.connection.rows.pop();
      });
      expect(failures({ [tablePath]: dropped })).toEqual([
        unlistedPass(connectionTest, 1, "connection"),
      ]);
    });

    it("is read in any file named after a key of the table, also one that no row names", () => {
      const other = "apps/api/src/routes/__fixtures__/connection.ts";
      expect(failures({ [other]: connectionStopFixture })).toEqual([
        unlistedStop(other, 2, "no-restricted-imports", "connection"),
      ]);
      expect(failures({ [other.replace(".ts", ".test.ts")]: connectionPassFixture })).toEqual([
        unlistedPass(other.replace(".ts", ".test.ts"), 1, "connection"),
      ]);
    });

    it("is not read in a file of another name, outside __fixtures__/, or in the fixtures of the checks", () => {
      expect(
        failures({
          "apps/api/src/__fixtures__/connections.ts": connectionStopFixture,
          "apps/api/src/connection.ts": connectionStopFixture,
          "apps/api/src/__fixtures__/connection.md": connectionStopFixture,
          "tools/scripts/src/checks/other/__fixtures__/connection.ts": connectionStopFixture,
        }),
      ).toEqual([]);
    });

    it("passes a line of a fixture that has no text of the restriction", () => {
      expect(
        failures({
          [connectionTest]: `${connectionPassFixture}export const x = 1;\n// a note on "pg"\n`,
        }),
      ).toEqual([]);
    });
  });

  describe("the values of a restriction", () => {
    it("asks each file that stops the restriction for a row of each value", () => {
      const added = table((copy) => {
        copy.outbox.values.push("@x/ses");
      });
      const missing = (file: string) =>
        `${tablePath} の outbox は \`@x/ses\` を止めるが、\`${file}\` に、それを書いて止める行が表にない。表と fixture に止める行を足す (${howTo})。`;
      expect(failures({ [tablePath]: added })).toEqual([missing(outbox), missing(outboxTest)]);
    });

    it("counts a value only as a whole name in the text of a row", () => {
      const longer = table((copy) => {
        copy.outbox.values = ["@x/sq"];
      });
      expect(failures({ [tablePath]: longer })).toHaveLength(2);
      const inProperty = table((copy) => {
        copy.console.values = ["globalThis"];
      });
      expect(failures({ [tablePath]: inProperty })).toEqual([]);
    });
  });

  describe("the message of a restriction", () => {
    const noMention = (key: string, mention: string) =>
      `${tablePath} の ${key} の message に \`${mention}\` がない。止められた人が、代わりに書くものと ADR を知るため (${howTo})。`;

    it("names what to write instead, and the ADR", () => {
      const without = table((copy) => {
        copy.outbox.message = "Do not send from here.";
      });
      expect(failures({ [tablePath]: without })).toEqual([
        noMention("outbox", "enqueueOutbox"),
        noMention("outbox", "docs/adr/0029"),
      ]);
    });

    it("is not asked of a restriction without a message", () => {
      const without = table((copy) => {
        copy.console.mentions = ["Logger"];
      });
      expect(failures({ [tablePath]: without })).toEqual([]);
    });
  });

  describe("the files of a row", () => {
    it("are named after the key, in a __fixtures__/ directory", () => {
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

  describe("the table itself", () => {
    it("is asked for", () => {
      expect(failures({ [tablePath]: undefined })).toEqual([
        `${tablePath} がない。lint で止める import と呼び出しと、その fixture の行を並べる表で、vite.config.ts と repo-policy が読む (${howTo})。`,
      ]);
    });

    it("is reported once when it is not JSON, and asks for nothing", () => {
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
    ])("refuses %s, and leaves the restriction out", (_, value, where, what) => {
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
    ])("refuses %s, and leaves the row out", (_, wrong, field, what) => {
      const value = { outbox: { ...lintRestrictions.outbox, rows: [row, wrong] } };
      expect(failures({ [tablePath]: JSON.stringify(value) })).toEqual([
        `${tablePath} の outbox.rows[1]${field} が${what}でない (${howTo})。`,
      ]);
    });

    it("refuses a table that is not an object", () => {
      expect(failures({ [tablePath]: "[]" })).toEqual([
        `${tablePath} の最上位がオブジェクトでない (${howTo})。`,
      ]);
    });
  });

  describe("the lines of a fixture", () => {
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
    ])("reads a disable comment with %s", (_, comment) => {
      expect(failures({ [outbox]: `${comment}\nimport "@x/sqs";\n` })).toEqual([]);
    });

    it("does not read an empty rule after a comma", () => {
      const comma =
        '// oxlint-disable-next-line no-restricted-imports, -- fixture\nimport "@x/sqs";\n';
      expect(failures({ [outbox]: comma })).toEqual([]);
    });

    it("does not read a disable comment after code", () => {
      const after =
        'const a = 1; // oxlint-disable-next-line no-restricted-imports\nimport "@x/sqs";\n';
      expect(failures({ [outbox]: after })).toEqual([
        sqsMissing,
        unlistedPass(outbox, 2, "outbox"),
      ]);
    });

    it("skips a line of blanks between the comment and the line", () => {
      const apart = outboxFixture.replace("\nimport", "\n  \nimport");
      expect(failures({ [outbox]: apart })).toEqual([
        sqsMissing,
        unlistedPass(outbox, 3, "outbox"),
      ]);
    });

    it("skips the comments, and reads a comment after code as code", () => {
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

    it("asks for a row of a line that lets through any text of the restriction", () => {
      const bare = `${consoleFixture}export const c: unknown = console;\n`;
      expect(failures({ [consoleFile]: bare })).toEqual([unlistedPass(consoleFile, 5, "console")]);
    });

    it("reads a fixture at the root, and not one with another extension", () => {
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
    ])("asks for a row of %s that is let through, even when no row has its text", (_, line) => {
      expect(failures({ [connectionTest]: `${connectionPassFixture}${line}\n` })).toEqual([
        unlistedPass(connectionTest, 2, "connection"),
      ]);
    });

    it.each([
      ["a constant that holds a text", 'export const a = "node:fs";'],
      ["a name that starts with import", 'const imported = from("node:fs");'],
      ["a call with from in its name", 'exportFrom("node:fs");'],
    ])("does not take %s for an import", (_, line) => {
      expect(failures({ [connectionTest]: `${connectionPassFixture}${line}\n` })).toEqual([]);
    });

    it("passes an import that a row lets through, though no other row has its text", () => {
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

    it("asks the values only of the files that stop them, not of those that let a line through", () => {
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
