// The table of lint restrictions (lint-restrictions.json, docs/adr/0050) agrees with its fixtures.
// The table lists, for each restriction, what vite.config.ts stops (the values and the message) and the lines of the
// fixtures that show it: a line that the rule stops, below `oxlint-disable-next-line <rule>`, and a line that it lets
// through, with no disable comment above. The disable comments fail `vp check` when they are unused
// (`reportUnusedDisableDirectives`), so the table and the fixtures together show that every value is stopped where it
// should be and let through where it should be. This check reads both ways: every row has its line, and every line of a
// fixture of the table has its row, so removing either fails.
import { Tree, isRecord, record, text } from "./tree.ts";

const tablePath = "lint-restrictions.json";
const howTo = 'docs/tooling/ci.md ("禁止の表")';

interface Row {
  readonly files: readonly string[];
  readonly rule: string;
  readonly text: string;
  readonly expect: "stop" | "pass";
  readonly reason: string;
}

interface Restriction {
  readonly adr: string;
  readonly values: readonly string[];
  readonly message?: string;
  readonly mentions: readonly string[];
}

type Fields = Record<string, unknown>;

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const shapeFailure = (where: string, what: string): string =>
  `${tablePath} の ${where} が${what}でない (${howTo})。`;

// A field of the table that does not have its shape, and what it should be.
interface Problem {
  readonly field: string;
  readonly expected: string;
}

const problem = (field: string, expected: string): Problem => ({ field, expected });

// The fields of a row that do not have their shape.
function rowProblems(row: Fields): Problem[] {
  const files = row.files;
  return [
    ...(isStrings(files) && files.length > 0 && files.every((file) => text(file) !== undefined)
      ? []
      : [problem("files", "空でない文字列の配列")]),
    ...["rule", "text", "reason"]
      .filter((field) => text(row[field]) === undefined)
      .map((field) => problem(field, "空でない文字列")),
    ...(row.expect === "stop" || row.expect === "pass"
      ? []
      : [problem("expect", '"stop" か "pass"')]),
  ];
}

// The fields of a restriction, other than its rows, that do not have their shape.
function restrictionProblems(restriction: Fields): Problem[] {
  return [
    ...(typeof restriction.adr === "string" ? [] : [problem("adr", "文字列")]),
    ...["values", "mentions"]
      .filter((field) => !isStrings(restriction[field]))
      .map((field) => problem(field, "文字列の配列")),
    ...(restriction.message === undefined || typeof restriction.message === "string"
      ? []
      : [problem("message", "文字列")]),
    ...(Array.isArray(restriction.rows) ? [] : [problem("rows", "配列")]),
  ];
}

// A type guard that reads the problems, not the value: rowProblems and restrictionProblems checked the fields of the
// value one by one, so a value with no problems has the shape `T`.
const passedShapeCheck = <T>(value: Fields, problems: readonly Problem[]): value is Fields & T =>
  problems.length === 0;

// A restriction of the table, under its key, with the rows that have their shape.
interface Entry {
  readonly key: string;
  readonly restriction: Restriction;
  readonly rows: readonly Row[];
}

interface Table {
  readonly entries: readonly Entry[];
  readonly failures: readonly string[];
}

// The restrictions and the rows of the table that have their shape, and a failure for each part that does not.
function readTable(table: unknown): Table {
  if (!isRecord(table))
    return {
      entries: [],
      failures: [`${tablePath} の最上位がオブジェクトでない (${howTo})。`],
    };
  const entries: Entry[] = [];
  const failures: string[] = [];
  for (const [key, value] of Object.entries(table)) {
    if (!isRecord(value)) {
      failures.push(shapeFailure(key, "オブジェクト"));
      continue;
    }
    const problems = restrictionProblems(value);
    failures.push(
      ...problems.map(({ field, expected }) => shapeFailure(`${key}.${field}`, expected)),
    );
    if (!passedShapeCheck<Restriction & { rows: unknown[] }>(value, problems)) continue;
    const rows: Row[] = [];
    for (const [index, row] of value.rows.entries()) {
      const where = `${key}.rows[${index}]`;
      if (!isRecord(row)) {
        failures.push(shapeFailure(where, "オブジェクト"));
        continue;
      }
      const wrong = rowProblems(row);
      failures.push(
        ...wrong.map(({ field, expected }) => shapeFailure(`${where}.${field}`, expected)),
      );
      if (passedShapeCheck<Row>(row, wrong)) rows.push(row);
    }
    entries.push({ key, restriction: value, rows });
  }
  return { entries, failures };
}

// The rules of an `oxlint-disable-next-line` comment that fills its line (`// ...` or `/* ... */`), before the
// ` --` of the reason or the end of the comment; undefined for any other line.
function disabledRules(line: string): string[] | undefined {
  const match = /^\s*(?:\/\/|\/\*)\s*oxlint-disable-next-line\s(.*)/.exec(line);
  if (match === null) return undefined;
  const [rules] = String(match[1]).split(/\s--|\*\//);
  return String(rules)
    .split(",")
    .map((rule) => rule.trim())
    .filter((rule) => rule !== "");
}

const isComment = (line: string): boolean => /^\s*(?:\/\/|\/\*|\*)/.test(line);

// The lines of code of a fixture, each with its number and the rules of the disable comment just above it
// (undefined when the line above is not one).
interface CodeLine {
  readonly number: number;
  readonly text: string;
  readonly disabled: readonly string[] | undefined;
}

function codeLines(source: string): CodeLine[] {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((line, index) =>
    line.trim() === "" || isComment(line)
      ? []
      : [{ number: index + 1, text: line, disabled: disabledRules(String(lines[index - 1])) }],
  );
}

// Whether the line is one that the row asks for: below the disable comment of its rule when it stops, with no
// disable comment above when it lets through. A type import is not told apart: a disable comment above one is
// unused, and fails `vp check`.
const matches = (row: Row, line: CodeLine): boolean =>
  line.text.includes(row.text) &&
  (row.expect === "stop"
    ? (line.disabled?.includes(row.rule) ?? false)
    : line.disabled === undefined);

const missingLine = (file: string, row: Row, adr: string): string => {
  const where =
    row.expect === "stop"
      ? `\`oxlint-disable-next-line ${row.rule}\` の次の行で`
      : "disable のコメントを前に置かずに";
  return `\`${file}\` に、${where} \`${row.text}\` を書いた行がない。${row.reason} (${adr})。`;
};

// A fixture of the table is named after its key: <dir>/__fixtures__/<key>.ts, or <key>.test.ts for the override of
// the tests. The fixtures of the checks themselves (tools/scripts/src/checks/) are the input of their tests.
const fixtureKey = (path: string): string | undefined =>
  path.startsWith("tools/scripts/src/checks/")
    ? undefined
    : /(?:^|\/)__fixtures__\/([^/]+?)(?:\.test)?\.tsx?$/.exec(path)?.[1];

// Whether `value` is in `text` as a whole name: not as a part of a longer name, so that no letter, digit, `_` or `-`
// is next to it.
const isNameCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[\w-]/.test(character);

function hasName(text: string, value: string): boolean {
  for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + 1))
    if (!isNameCharacter(text[at - 1]) && !isNameCharacter(text[at + value.length])) return true;
  return false;
}

function restrictionFailures(tree: Tree, { key, restriction, rows }: Entry): string[] {
  const { adr } = restriction;
  const failures: string[] = [];
  const namedAfterKey = (file: string) => fixtureKey(file) === key;
  for (const file of [...new Set(rows.flatMap((row) => row.files))].filter(
    (file) => !namedAfterKey(file),
  ))
    failures.push(
      `${tablePath} の ${key} の行が \`${file}\` を挙げるが、fixture のファイルは __fixtures__/${key}.ts か __fixtures__/${key}.test.ts にする (${howTo})。`,
    );
  for (const row of rows)
    for (const file of row.files.filter(namedAfterKey))
      if (!codeLines(tree.read(file)).some((line) => matches(row, line)))
        failures.push(missingLine(file, row, adr));
  // Each file that stops the restriction has a row for each value it stops, so that a value added to the table
  // without a fixture fails.
  const stops = rows.filter((row) => row.expect === "stop");
  for (const value of restriction.values)
    for (const file of new Set(stops.flatMap((row) => row.files)))
      if (!stops.some((row) => row.files.includes(file) && hasName(row.text, value)))
        failures.push(
          `${tablePath} の ${key} は \`${value}\` を止めるが、\`${file}\` に、それを書いて止める行が表にない。表と fixture に止める行を足す (${howTo})。`,
        );
  // The message that Oxlint reports says what to write instead and names the ADR, so that an agent that is stopped
  // knows the way out.
  const { message } = restriction;
  if (message !== undefined)
    for (const mention of [...restriction.mentions, adr])
      if (!message.includes(mention))
        failures.push(
          `${tablePath} の ${key} の message に \`${mention}\` がない。止められた人が、代わりに書くものと ADR を知るため (${howTo})。`,
        );
  return failures;
}

// An import or a re-export: `import "x"`, `import ... from "x"`, `export ... from "x"`.
const isImport = (line: string): boolean =>
  /^\s*(?:import\s*["']|(?:import|export)\b.*\sfrom\s*["'])/.test(line);

// Every line of a fixture of the table that the rule stops has its row, and so does every line that is let through
// and is an import or has a text of the restriction: a row removed from the table fails here. An import counts even
// when its text is in no other row, so that a row of an import that is let through (`"node:child_process"`) cannot be
// removed alone.
function unlistedLines(tree: Tree, { key, rows: allRows }: Entry, file: string): string[] {
  const rows = allRows.filter((row) => row.files.includes(file));
  const failures: string[] = [];
  for (const line of codeLines(tree.read(file))) {
    for (const rule of line.disabled ?? [])
      if (!rows.some((row) => row.rule === rule && matches(row, line)))
        failures.push(
          `\`${file}\` の ${line.number} 行目は \`${rule}\` で止める行だが、${tablePath} の ${key} に、このファイルでこの行を止める行がない。表に行を足すか、fixture から行を消す (${howTo})。`,
        );
    if (
      line.disabled === undefined &&
      (isImport(line.text) || allRows.some((row) => line.text.includes(row.text))) &&
      !rows.some((row) => matches(row, line))
    )
      failures.push(
        `\`${file}\` の ${line.number} 行目は通す行 (前の行に disable のコメントがなく、import か ${key} の文字列を書いた行) だが、${tablePath} の ${key} に、このファイルでこの行を通す行がない。表に行を足すか、fixture から行を消す (${howTo})。`,
      );
  }
  return failures;
}

// The parsed table.
const parsedTable = (tree: Tree): unknown => tree.parsed("lint-restrictions.json");

// Whether the path is a fixture of the table: one named after a key. It shows one restriction, and is not a fixture of
// the overrides that lint-fixtures.ts asks of a directory.
export const isRestrictionFixture = (tree: Tree, path: string): boolean =>
  Object.keys(record(parsedTable(tree))).some((key) => key === fixtureKey(path));

export function lintRestrictionsAgree(tree: Tree): string[] {
  const table = parsedTable(tree);
  if (table === undefined)
    return tree.paths.includes(tablePath)
      ? []
      : [
          `${tablePath} がない。lint で止める import と呼び出しと、その fixture の行を並べる表で、vite.config.ts と repo-policy が読む (${howTo})。`,
        ];
  const { entries, failures } = readTable(table);
  return [
    ...failures,
    ...entries.flatMap((entry) => restrictionFailures(tree, entry)),
    ...tree.paths.flatMap((file) =>
      entries
        .filter(({ key }) => key === fixtureKey(file))
        .flatMap((entry) => unlistedLines(tree, entry, file)),
    ),
  ];
}
