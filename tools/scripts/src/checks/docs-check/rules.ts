// The rules of docs-check that read the documents themselves (docs/knowledge/documentation-authoring.md).
// Pure functions over the documents of docs/ (path relative to docs/, with "/", to content); each returns
// one line per problem. cli.ts runs iwe, reads the files and git, and prints. links.ts has the link rules.
import { posix } from "node:path";
import { isObject, objects } from "../json.ts";
import { importedGuidelines, type Docs } from "./links.ts";

// Checked before the schema: a value like `description: javascript: の URL` is invalid YAML, and iwe answers
// with "type/title/description/tags is a required property" for the file. Only top-level `key: value`
// lines are read; a value that starts as a quoted, flow, block, anchor, alias, tag or comment is left to YAML.
export function frontmatterProblems(docs: Docs): string[] {
  const problems: string[] = [];
  for (const [file, text] of docs) {
    const [first, ...rest] = text.split("\n");
    if (first !== "---") continue;
    // Up to the closing ---, or to the end of a file whose frontmatter does not close.
    const close = rest.indexOf("---");
    (close < 0 ? rest : rest.slice(0, close)).forEach((line, i) => {
      const m = /^([A-Za-z_][\w-]*):\s+(.+)$/.exec(line);
      if (!m) return;
      const value = String(m[2]);
      if (/^["'[{|>&*!#]/.test(value) || !/:\s|\s#/.test(value)) return;
      problems.push(
        `${file}:${i + 2}: the value of ${String(m[1])} has a colon followed by a space, or a space and #, and is not quoted; wrap it in double quotes`,
      );
    });
  }
  return problems;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// Broken links and orphans from `iwe stats -f json`. Links leaving docs/ (starting with ../) point at
// repository files and are skipped.
export function statsProblems(statsJson: string): string[] {
  const stats: unknown = JSON.parse(statsJson);
  const s = isObject(stats) ? stats : {};
  const broken = objects(s.brokenLinks).filter((l) => !String(l.targetKey).startsWith("../"));
  return [
    ...broken.map((l) => `broken link: ${String(l.sourceKey)} -> ${String(l.targetKey)}`),
    ...list(s.orphans).map((o) => `orphan (link it from an index.md): ${String(o)}`),
  ];
}

// index.md link lines carry a "when to read" note: `- [title](file.md)：when to read`, with a non-empty
// note after the full-width colon (：). An agent can then decide from the index whether to open a file.
// Only bullet lines that contain a Markdown link; headings and frontmatter are left alone.
export function indexProblems(docs: Docs): string[] {
  const problems: string[] = [];
  for (const [file, text] of docs) {
    if (posix.basename(file) !== "index.md") continue;
    text.split("\n").forEach((line, i) => {
      const rest = /^\s*-\s+\[[^\]]+\]\([^)]+\)(.*)$/.exec(line)?.[1];
      if (rest === undefined) return;
      if (!rest.startsWith("：") || rest.slice(1).trim() === "") {
        problems.push(`${file}:${i + 1}: link line needs a "：when to read" note: ${line.trim()}`);
      }
    });
  }
  return problems;
}

// Links between documents name the .md file. GitHub resolves a relative link as written, so `](b)` is a
// 404. An `iwe create` run outside docs/ writes links without the suffix. Fenced code blocks and inline
// code are skipped.
export function extensionProblems(docs: Docs): string[] {
  const problems: string[] = [];
  for (const [file, text] of docs) {
    let fenced = false;
    text.split("\n").forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return;
      }
      if (fenced) return;
      for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = String(m[1]);
        if (/^([a-z][a-z0-9+.-]*:|#|<)/i.test(target)) continue;
        // The path before any #heading; never empty, since a target that starts with # left above.
        if (!/\.[A-Za-z0-9]+$/.test(String(target.split("#")[0]))) {
          problems.push(`${file}:${i + 1}: link to ${target} needs the file extension (.md)`);
        }
      }
    });
  }
  return problems;
}

// A document over 250 lines is a review trigger, not an error: a warning that leaves the status 0.
// Splitting to hit a line count can raise total tokens; split by responsibility, not by length.
// Lines are counted as `wc -l` does: newline characters.
export function lengthWarnings(docs: Docs): string[] {
  const warnings: string[] = [];
  for (const [file, text] of docs) {
    const lines = text.split("\n").length - 1;
    if (lines > 250) {
      warnings.push(
        `${file} is ${lines} lines (over 250): check it answers one question (its description); split by responsibility, not to hit a line count`,
      );
    }
  }
  return warnings;
}

// `staged` only (pre-commit): a staged change to an imported area (its about.md cites arch-guidelines in
// `sources`) stages that area's about.md too, which lists "原文からの変更点" (AGENTS.md). `staged` is the
// staged paths relative to docs/; only the staged set says what changed together.
export function stagedProblems(docs: Docs, staged: readonly string[]): string[] {
  const problems: string[] = [];
  for (const file of staged) {
    // A file at the top of docs/ has no area: "index.md/about.md" does not exist.
    const about = `${String(file.split("/")[0])}/about.md`;
    const aboutText = docs.get(about);
    if (aboutText === undefined || staged.includes(about)) continue;
    if (importedGuidelines(aboutText).length === 0) continue;
    problems.push(
      `${file} is in an imported guideline. Record the change under 原文からの変更点 in ${about} and stage it (AGENTS.md).`,
    );
  }
  return problems;
}
