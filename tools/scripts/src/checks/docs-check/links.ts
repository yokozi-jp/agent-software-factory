// Link checks inside docs/ that iwe stats does not do (docs/knowledge/documentation-authoring.md):
//   1. A relative link's #fragment must match a heading of the target (GitHub's slug rules).
//      Links within the same file are left to markdownlint (MD051).
//   2. Guidelines imported from future-architect/arch-guidelines live in docs/; link to the docs/
//      document, not the site. Only an area's about.md (the source and license page) links to the site.
//      An area counts as imported when its about.md cites it; guidelines that were not imported keep site links.
// Pure functions over the documents of docs/ (path relative to docs/, with "/", to content).
import { posix } from "node:path";

export type Docs = ReadonlyMap<string, string>;

const frontmatter = (text: string): string =>
  // Stryker disable next-line StringLiteral: equivalent, any text without the site's URL cites nothing.
  text.startsWith("---\n") ? text.slice(4, text.indexOf("\n---", 4)) : "";

const isAbout = (file: string): boolean => posix.basename(file) === "about.md";

// The source directories of arch-guidelines (forLog, forAWS ...) that an about.md cites in its frontmatter.
export function importedGuidelines(aboutText: string): string[] {
  return [...frontmatter(aboutText).matchAll(/arch-guidelines\/documents\/(for[A-Za-z]+)\//g)].map(
    (m) => String(m[1]),
  );
}

// The character of a fence line (` or ~), or undefined for any other line.
const fenceOf = (line: string): string | undefined =>
  /^\s*(?:`{3,}|~{3,})/.exec(line)?.[0].trimStart().charAt(0);

// GitHub heading anchors: lower case, drop punctuation, spaces to hyphens, -1, -2 ... for duplicates.
function slugs(text: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fence: string | undefined;
  for (const line of text.split("\n")) {
    const f = fenceOf(line);
    if (f !== undefined) {
      if (fence === undefined) fence = f;
      else if (f === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    // One whitespace after the #s: the rest is trimmed below.
    const m = /^#{1,6}\s(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = String(m[1])
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[`*_~]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
      .replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

const decodeFragment = (fragment: string): string => {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
};

export function linkProblems(docs: Docs): string[] {
  const imported = [
    ...new Set(
      [...docs].filter(([file]) => isAbout(file)).flatMap(([, text]) => importedGuidelines(text)),
    ),
  ];
  const site = new RegExp(
    `https://future-architect\\.github\\.io/arch-guidelines/documents/(${imported.join("|") || "(?!)"})/`,
  );
  const problems: string[] = [];
  for (const [file, text] of docs) {
    const lines = text.split("\n");
    // Frontmatter `sources` cites the site on purpose (the source of the document).
    const bodyStart = lines[0] === "---" ? lines.indexOf("---", 1) + 1 : 0;
    let fence: string | undefined;
    lines.forEach((line, i) => {
      if (i < bodyStart) return;
      const f = fenceOf(line.replace(/^(>\s?)+/, ""));
      if (f !== undefined) {
        if (fence === undefined) fence = f;
        else if (f === fence) fence = undefined;
        return;
      }
      if (fence !== undefined) return;
      // Inline code is not a link.
      for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g)) {
        const target = String(m[1]);
        if (!isAbout(file) && site.test(target)) {
          problems.push(
            `${file}:${i + 1}: links to the arch-guidelines site for a guideline imported into docs/; link to the docs/ document`,
          );
        }
        // A URL (its scheme, RFC 3986 section 3.1), or a heading of this file.
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
        const hash = target.indexOf("#");
        // Stryker disable next-line EqualityOperator: equivalent, a target that starts with # left above.
        if (hash < 0) continue;
        const rel = posix.normalize(
          posix.join(posix.dirname(file), decodeURI(target.slice(0, hash))),
        );
        // Outside docs/, not a document, or missing (iwe stats reports a broken link).
        const targetText = docs.get(rel);
        if (targetText === undefined) continue;
        const fragment = decodeFragment(target.slice(hash + 1));
        if (!slugs(targetText).has(fragment.toLowerCase()))
          problems.push(`${file}:${i + 1}: ${rel} has no heading for #${fragment}`);
      }
    });
  }
  return problems;
}
